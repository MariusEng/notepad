import { message, open, save } from "@tauri-apps/plugin-dialog";
import { backend } from "./lib/backend";
import { LANGUAGES, detectLanguage, fileName, type LanguageId } from "./editors/languages";
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

function nextUntitledName(): string {
  const used = new Set(
    store()
      .tabs.map((t) => /^Untitled-(\d+)\.md$/.exec(t.title)?.[1])
      .filter(Boolean)
      .map(Number),
  );
  let n = 1;
  while (used.has(n)) n++;
  return `Untitled-${n}.md`;
}

/** Cmd/Ctrl+N: a new, empty Markdown document. */
export function newTab() {
  store().addTab(baseTab({ title: nextUntitledName(), language: "markdown" }));
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
      // Opening a file into a fresh window replaces the empty "Untitled" tab.
      const cur = activeTab();
      store().addTab(tab, { replaceId: cur && isPristine(cur) ? cur.id : undefined });
    } catch (e) {
      store().notify(`Could not open ${fileName(path)}: ${e}`, "error");
    }
  }
}

const toDisk = (t: Tab) => (t.eol === "\r\n" ? t.content.replace(/\n/g, "\r\n") : t.content);

/** Saves the tab; untitled tabs go through Save As. Returns false if cancelled or failed. */
export async function saveTab(id = store().activeId): Promise<boolean> {
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab) return false;
  if (!tab.path) return saveTabAs(tab.id);
  try {
    const mtime = await backend.writeFile(tab.path, toDisk(tab), tab.bom);
    // Only clear dirty if nothing was typed while the write was in flight.
    const now = store().tabs.find((t) => t.id === tab.id);
    store().update(tab.id, { mtime, external: undefined, dirty: now?.content !== tab.content });
    return true;
  } catch (e) {
    store().notify(`Save failed: ${e}`, "error");
    return false;
  }
}

export async function saveTabAs(id = store().activeId): Promise<boolean> {
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab) return false;
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
  try {
    const file = await backend.readFile(tab.path);
    const { content, eol } = splitEol(file.content);
    store().replaceContent(id, content, { eol, bom: file.bom, mtime: file.mtime, dirty: false, external: undefined });
  } catch (e) {
    store().notify(`Could not reload ${tab.title}: ${e}`, "error");
  }
}

export function setLanguage(id: string, language: LanguageId) {
  const tab = store().tabs.find((t) => t.id === id);
  if (tab && tab.language !== language) store().replaceContent(id, tab.content, { language });
}

export function toggleEol(id: string) {
  const tab = store().tabs.find((t) => t.id === id);
  if (tab) store().update(id, { eol: tab.eol === "\n" ? "\r\n" : "\n", dirty: true });
}

export function toggleMarkdownSource(id = store().activeId) {
  const tab = store().tabs.find((t) => t.id === id);
  if (tab?.language === "markdown") store().update(tab.id, { mdSource: !tab.mdSource, scroll: 0 });
}
