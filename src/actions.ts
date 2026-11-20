import { message, open, save } from "@tauri-apps/plugin-dialog";
import helpText from "./help.md?raw";
import { LARGE_FILE_BYTES, backend } from "./lib/backend";
import { activeEditor, flushEdits } from "./editors/handle";
import { LANGUAGES, detectLanguage, fileName, hasRenderedView, type LanguageId } from "./editors/languages";
import { activeTab, newId, useTabs, type Eol, type Tab } from "./tabs/store";

const store = () => useTabs.getState();

function baseTab(partial: Partial<Tab> & Pick<Tab, "title" | "language">): Tab {
  return {
    id: newId(),
    path: null,
    content: "",
    eol: "\n",
    bom: false,
    dirty: false,
    mtime: null,
    mdSource: false,
    cursor: 0,
    scroll: 0,
    version: 0,
    ...partial,
  };
}

export function splitEol(text: string): { content: string; eol: Eol } {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  return { content: text.replace(/\r\n?/g, "\n"), eol: crlf > lf ? "\r\n" : "\n" };
}

const isPristine = (t: Tab) => t.path === null && !t.dirty && t.content === "";

/** "Untitled-3.sql": the number is the lowest one not used by an open untitled tab. */
function nextUntitledName(language: LanguageId): string {
  const used = new Set(
    store()
      .tabs.filter((t) => t.path === null)
      .map((t) => /^Untitled-(\d+)\./.exec(t.title)?.[1])
      .filter(Boolean)
      .map(Number),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `Untitled-${n}.${LANGUAGES[language].extensions[0]}`;
}

/** Cmd/Ctrl+N: a new, empty Markdown document. */
export function newTab(language: LanguageId = "markdown") {
  store().addTab(baseTab({ title: nextUntitledName(language), language, mdSource: language === "html" }));
}

/** Opens files (or shows the Open dialog). Already-open files are focused instead. */
export async function openFiles(paths?: string[]) {
  if (!paths) {
    const picked = await open({ multiple: true, directory: false, title: "Open" });
    if (!picked) return;
    paths = Array.isArray(picked) ? picked : [picked];
  }
  for (const path of paths) {
    const existing = store().tabs.find((t) => t.path === path);
    if (existing) {
      store().setActive(existing.id);
      continue;
    }
    try {
      const size = await backend.fileSize(path);
      // Opening a file into a fresh window replaces the empty "Untitled" tab.
      const cur = activeTab();
      const replaceId = cur && isPristine(cur) ? cur.id : undefined;
      if (size > LARGE_FILE_BYTES) {
        // Big file: the tab appears at once and shows progress while the text streams in.
        const tab = baseTab({ path, title: fileName(path), language: detectLanguage(path), loading: { loaded: 0, total: size } });
        store().addTab(tab, { replaceId });
        void loadFileInto(tab.id, path);
        continue;
      }
      const file = await backend.readFile(path);
      const { content, eol } = splitEol(file.content);
      const tab = baseTab({
        path,
        title: fileName(path),
        language: detectLanguage(path, content),
        content,
        eol,
        bom: file.bom,
        mtime: file.mtime,
      });
      if (tab.language === "markdown" && content.length > MD_FORMATTED_MAX) tab.mdSource = true;
      store().addTab(tab, { replaceId });
    } catch (e) {
      store().notify(`Could not open ${fileName(path)}: ${e}`, "error");
    }
  }
}

/** Markdown this big is shown as source: the formatted editor would be far too slow. */
const MD_FORMATTED_MAX = 1024 * 1024;

/**
 * Reads a file into an existing tab in chunks, showing progress in the tab (`loading`). Used for big files
 * when opening, restoring the session and reloading. Stops if the tab is closed meanwhile.
 */
export async function loadFileInto(id: string, path: string) {
  const alive = () => store().tabs.some((t) => t.id === id && t.path === path);
  try {
    const file = await backend.readText(path, (loaded, total) => {
      if (!alive()) return false;
      store().update(id, { loading: { loaded, total } });
      return true;
    });
    if (!file || !alive()) return;
    const { content, eol } = splitEol(file.content);
    const language = detectLanguage(path, content.slice(0, 20000));
    store().replaceContent(id, content, {
      eol,
      bom: file.bom,
      mtime: file.mtime,
      dirty: false,
      external: undefined,
      loading: undefined,
      language,
      ...(language === "markdown" && content.length > MD_FORMATTED_MAX ? { mdSource: true } : {}),
    });
  } catch (e) {
    if (!alive()) return;
    store().notify(`Could not open ${fileName(path)}: ${e}`, "error");
    store().removeTab(id);
    if (store().tabs.length === 0) newTab();
  }
}

const toDisk = (t: Tab) => (t.eol === "\r\n" ? t.content.replace(/\n/g, "\r\n") : t.content);

/** Saves the tab; untitled tabs go through Save As. Returns false if cancelled or failed. */
export async function saveTab(id = store().activeId): Promise<boolean> {
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab || tab.loading) return false;
  if (!tab.path) return saveTabAs(tab.id);
  try {
    const mtime = await backend.writeFile(tab.path, toDisk(tab), tab.bom);
    // Only clear dirty if nothing was typed while the write was in flight.
    const now = store().tabs.find((t) => t.id === tab.id);
    store().update(tab.id, { mtime, external: undefined, dirty: now?.content !== tab.content });
    // Files inside the open git repository are committed and pushed (see git/actions.ts).
    void import("./git/actions").then((g) => g.afterSave(tab.path!));
    return true;
  } catch (e) {
    store().notify(`Save failed: ${e}`, "error");
    return false;
  }
}

export async function saveTabAs(id = store().activeId): Promise<boolean> {
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab || tab.loading) return false;
  const lang = LANGUAGES[tab.language];
  const path = await save({
    title: "Save As",
    defaultPath: tab.path ?? tab.title,
    filters: [
      { name: lang.label, extensions: lang.extensions },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (!path) return false;
  const language: LanguageId = detectLanguage(path, tab.content);
  store().update(tab.id, { path, title: fileName(path), language });
  const ok = await saveTab(tab.id);
  // Remount the editor if the language changed (e.g. .md saved as .txt).
  if (ok && language !== tab.language) store().replaceContent(tab.id, store().tabs.find((t) => t.id === tab.id)!.content);
  return ok;
}

/** Asks Save / Don't Save / Cancel for a dirty tab. Returns true if it may be closed. */
async function confirmDiscard(tab: Tab): Promise<boolean> {
  store().setActive(tab.id);
  const answer = await message(`Do you want to save the changes you made to ${tab.title}?`, {
    title: "Unsaved changes",
    kind: "warning",
    buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
  });
  if (answer === "Yes" || answer === "Save") return saveTab(tab.id);
  return answer === "No" || answer === "Don't Save";
}

/** Closes a tab. There is always at least one tab, so closing the last opens a new one. */
export async function closeTab(id = store().activeId) {
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.dirty && !(await confirmDiscard(tab))) return;
  store().removeTab(tab.id);
  if (store().tabs.length === 0) newTab();
}

export async function closeOtherTabs(keepId: string, onlyRight = false) {
  const tabs = store().tabs;
  const keepIndex = tabs.findIndex((t) => t.id === keepId);
  for (const [i, t] of tabs.entries()) {
    if (t.id === keepId || (onlyRight && i < keepIndex)) continue;
    await closeTab(t.id);
  }
}

/** Reloads a tab from disk, discarding unsaved edits. */
export async function reloadTab(id: string) {
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab?.path) return;
  if ((await backend.fileSize(tab.path).catch(() => 0)) > LARGE_FILE_BYTES) {
    store().update(id, { loading: { loaded: 0, total: 1 } });
    return loadFileInto(id, tab.path);
  }
  try {
    const file = await backend.readFile(tab.path);
    const { content, eol } = splitEol(file.content);
    store().replaceContent(id, content, { eol, bom: file.bom, mtime: file.mtime, dirty: false, external: undefined });
  } catch (e) {
    store().notify(`Could not reload ${tab.title}: ${e}`, "error");
  }
}

/** Changes the file type. An untitled tab also gets the new extension ("Untitled-2.md" → "Untitled-2.sql"),
 *  so Save As suggests the right name. A saved file keeps its name and path. */
export function setLanguage(id: string, language: LanguageId) {
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab || tab.language === language) return;
  const patch: Partial<Tab> = { language };
  if (language === "html") patch.mdSource = true; // edit first; the preview is one ⌘/ away
  const untitled = tab.path === null && /^(Untitled-\d+)\.[^.]*$/.exec(tab.title);
  if (untitled) patch.title = `${untitled[1]}.${LANGUAGES[language].extensions[0]}`;
  store().replaceContent(id, tab.content, patch);
}

export function toggleEol(id: string) {
  const tab = store().tabs.find((t) => t.id === id);
  if (tab) store().update(id, { eol: tab.eol === "\n" ? "\r\n" : "\n", dirty: true });
}

/** Markdown: formatted editor ⇄ source. HTML: preview ⇄ source. (⌘/ · Ctrl+/) */
export function toggleSource(id = store().activeId) {
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (tab && hasRenderedView(tab.language)) store().update(tab.id, { mdSource: !tab.mdSource, scroll: 0 });
}

/** Format Document (⇧⌥F). In code editors it is a single undoable edit. */
export async function formatActive() {
  flushEdits();
  const tab = activeTab();
  if (!tab || tab.loading) return;
  const { formatText, FormatError } = await import("./editors/languages/format");
  try {
    const formatted = await formatText(tab.language, tab.content);
    if (formatted === tab.content) {
      store().notify("Already formatted");
      return;
    }
    if (!activeEditor()?.replaceAll(formatted)) store().replaceContent(tab.id, formatted, { dirty: true });
  } catch (e) {
    store().notify(e instanceof FormatError ? e.message : `Format failed: ${e}`, "error");
  }
}

/** Help → Notepad Help: the help text in its own tab (focused if it is already open). */
export function openHelp() {
  const title = "Notepad Help.md";
  const open = store().tabs.find((t) => t.path === null && t.title === title);
  if (open) return store().setActive(open.id);
  store().addTab(baseTab({ title, language: "markdown", content: helpText }));
}
