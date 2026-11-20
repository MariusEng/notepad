import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import helpText from "./help.md?raw";
import { LARGE_FILE_BYTES, backend, type FileData } from "./lib/backend";
import { ENCODINGS, bomFor, encodingName } from "./editors/encodings";
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
    encoding: "utf-8",
    dirty: false,
    mtime: null,
    mdSource: false,
    cursor: 0,
    scroll: 0,
    version: 0,
    ...partial,
  };
}

/** The tab fields that come from a file read from disk. */
export function fromFile(file: FileData) {
  const { content, eol } = splitEol(file.content);
  return { content, eol, bom: file.bom, mtime: file.mtime, encoding: file.encoding, lossy: file.lossy || undefined };
}

/** What to read a tab's file with: its encoding, or detection for plain UTF-8 (the file may have changed). */
export const readEncodingOf = (t: Pick<Tab, "encoding">) => (t.encoding === "utf-8" ? null : t.encoding);

function reportEncoding(file: FileData, name: string) {
  if (file.fallback)
    store().notify(`${name} isn't valid UTF-8, so it was opened as ${encodingName(file.encoding, false)}. Change it under File → Encoding.`);
  else if (file.lossy)
    store().notify(`Some bytes in ${name} aren't valid ${encodingName(file.encoding)} and show as �. Try another encoding (File → Encoding).`, "error");
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
      const fields = fromFile(file);
      const tab = baseTab({ path, title: fileName(path), language: detectLanguage(path, fields.content), ...fields });
      if (tab.language === "markdown" && fields.content.length > MD_FORMATTED_MAX) tab.mdSource = true;
      store().addTab(tab, { replaceId });
      reportEncoding(file, tab.title);
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
export async function loadFileInto(id: string, path: string, encoding: string | null = null) {
  const alive = () => store().tabs.some((t) => t.id === id && t.path === path);
  try {
    const file = await backend.readText(
      path,
      (loaded, total) => {
        if (!alive()) return false;
        store().update(id, { loading: { loaded, total } });
        return true;
      },
      encoding,
    );
    if (!file || !alive()) return;
    const { content, ...fields } = fromFile(file);
    const language = detectLanguage(path, content.slice(0, 20000));
    reportEncoding(file, fileName(path));
    store().replaceContent(id, content, {
      ...fields,
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
    if (tab.lossy) {
      const ok = await ask(
        `${tab.title} had bytes that aren't valid ${encodingName(tab.encoding)}; they show as � and will be saved that way. Save anyway?`,
        { title: "Save with replaced characters?", kind: "warning", okLabel: "Save", cancelLabel: "Cancel" },
      );
      if (!ok) return false;
    }
    const mtime = await backend.writeFile(tab.path, toDisk(tab), tab.bom, tab.encoding);
    // Only clear dirty if nothing was typed while the write was in flight.
    const now = store().tabs.find((t) => t.id === tab.id);
    store().update(tab.id, { mtime, external: undefined, lossy: undefined, dirty: now?.content !== tab.content });
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
    return loadFileInto(id, tab.path, readEncodingOf(tab));
  }
  try {
    const file = await backend.readFile(tab.path, readEncodingOf(tab));
    const { content, ...fields } = fromFile(file);
    store().replaceContent(id, content, { ...fields, dirty: false, external: undefined });
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

// ---------------------------------------------------------------- encodings

/** Reads the file again with another encoding (unsaved edits are discarded, after asking). */
export async function reopenWithEncoding(id: string, encoding: string) {
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab?.path || tab.loading) return;
  if (tab.dirty) {
    const ok = await ask(`Reopening ${tab.title} as ${encodingName(encoding)} discards your unsaved changes.`, {
      title: "Reopen with encoding",
      kind: "warning",
      okLabel: "Reopen",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
  }
  store().update(id, { loading: { loaded: 0, total: 1 } });
  await loadFileInto(id, tab.path, encoding);
}

/** Saves the file in another encoding (an untitled tab keeps it for when it is saved). */
export async function saveWithEncoding(id: string, encoding: string) {
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab || tab.loading) return;
  const before = { encoding: tab.encoding, bom: tab.bom, dirty: tab.dirty };
  store().update(id, { encoding, bom: bomFor(encoding, tab.bom), dirty: true });
  if (!tab.path) return;
  // If it can't be saved in that encoding (characters it doesn't have), keep the old one.
  if (!(await saveTab(id))) store().update(id, before);
}

export function toggleBom(id: string) {
  const tab = store().tabs.find((t) => t.id === id);
  if (tab && tab.encoding === "utf-8") store().update(id, { bom: !tab.bom, dirty: true });
}

/** File → Encoding, the tab menu and the status bar: reopen or save with an encoding. */
export function encodingMenuItems(tab: Tab) {
  return [
    {
      id: "enc-reopen",
      text: "Reopen with Encoding",
      enabled: !!tab.path,
      items: ENCODINGS.map((e) => ({
        id: `enc-reopen-${e.id}`,
        text: e.label,
        checked: e.id === tab.encoding,
        action: () => void reopenWithEncoding(tab.id, e.id),
      })),
    },
    {
      id: "enc-save",
      text: "Save with Encoding",
      items: ENCODINGS.map((e) => ({
        id: `enc-save-${e.id}`,
        text: e.label,
        checked: e.id === tab.encoding,
        action: () => void saveWithEncoding(tab.id, e.id),
      })),
    },
    {
      id: "enc-bom",
      text: "UTF-8 with BOM",
      checked: tab.encoding === "utf-8" && tab.bom,
      enabled: tab.encoding === "utf-8",
      action: () => toggleBom(tab.id),
    },
  ];
}

export async function showEncodingMenu(id = store().activeId) {
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab) return;
  const { Menu } = await import("@tauri-apps/api/menu");
  const menu = await Menu.new({ items: encodingMenuItems(tab) });
  await menu.popup();
}
