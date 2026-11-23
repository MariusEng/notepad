import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import helpText from "./help.md?raw";
import shortcutsText from "../SHORTCUTS.md?raw";
import { LARGE_FILE_BYTES, backend, db, type FileData } from "./lib/backend";
import { ENCODINGS, bomFor, encodingName } from "./editors/encodings";
import { activeEditor, flushEdits } from "./editors/handle";
import { LANGUAGES, LANGUAGE_LIST, detectLanguage, fileName, hasDataView, hasRenderedView, type LanguageId } from "./editors/languages";
import { activeTab, isDb, newId, useTabs, type Eol, type Tab } from "./tabs/store";
import { ensureLoaded } from "./tabs/unload";

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

/** Cmd/Ctrl+N: a new, empty Markdown document. `content` fills it (e.g. query results opened as CSV). */
export function newTab(language: LanguageId = "markdown", content = "") {
  store().addTab(baseTab({ title: nextUntitledName(language), language, mdSource: language === "html", content }));
}

// ---------------------------------------------------------------- SQLite

/** Extensions offered for databases in the save dialogs (opening goes by the file header, not the name). */
const DB_EXTENSIONS = ["sqlite", "sqlite3", "db", "db3", "s3db"];

/** A tab showing an SQLite database (db/DbView.tsx). */
const dbTab = (path: string, preview?: boolean) =>
  baseTab({ path, title: fileName(path), language: "sql", kind: "sqlite", query: "", preview });

/** File → New Database…: creates an empty SQLite database where the user chooses and opens it. */
export async function newDatabase() {
  const path = await save({
    title: "New Database",
    defaultPath: "Untitled.sqlite",
    filters: [{ name: "SQLite Database", extensions: DB_EXTENSIONS }],
  });
  if (!path) return;
  try {
    await db.create(path);
  } catch (e) {
    store().notify(`Could not create ${fileName(path)}: ${e}`, "error");
    return;
  }
  const open = store().tabs.find((t) => t.path === path);
  if (open && !open.dirty) {
    // It replaced a file that was open: show the new, empty database in that tab.
    store().replaceContent(open.id, "", { kind: "sqlite", language: "sql", query: open.query ?? "", mtime: null, external: undefined });
    store().setActive(open.id);
  } else await openFiles([path]);
}

/** Save As for a database: a compact copy (VACUUM INTO) that the tab then shows. */
async function saveDbAs(tab: Tab): Promise<boolean> {
  const dest = await save({
    title: "Save Database As",
    defaultPath: tab.path ?? tab.title,
    filters: [{ name: "SQLite Database", extensions: DB_EXTENSIONS }],
  });
  if (!dest || dest === tab.path) return false;
  try {
    await db.copy(tab.path!, dest);
  } catch (e) {
    store().notify(`Could not save ${fileName(dest)}: ${e}`, "error");
    return false;
  }
  store().replaceContent(tab.id, "", { path: dest, title: fileName(dest), preview: undefined });
  return true;
}

export interface OpenOptions {
  /** Single click in the sidebar: open as a preview tab that the next preview replaces. */
  preview?: boolean;
  /** Double click in the sidebar: keep the tab open (also turns an open preview tab into a normal one). */
  pin?: boolean;
  /** From the command line: a path that doesn't exist yet opens as an empty tab; saving creates the file. */
  create?: boolean;
}

/** Files being read right now, so a double click (which starts as a single click) doesn't open a file twice. */
const opening = new Map<string, Promise<void>>();

/** Opens files (or shows the Open dialog). Already-open files are focused instead. */
export async function openFiles(paths?: string[], opts: OpenOptions = {}) {
  if (!paths) {
    const picked = await open({ multiple: true, directory: false, title: "Open" });
    if (!picked) return;
    paths = Array.isArray(picked) ? picked : [picked];
  }
  for (const path of paths) {
    const running = opening.get(path);
    if (running) await running;
    const job = openOne(path, opts);
    opening.set(path, job);
    try {
      await job;
    } finally {
      if (opening.get(path) === job) opening.delete(path);
    }
  }
}

/** Makes a preview tab a normal one. */
export const keepTab = (id: string) => store().update(id, { preview: undefined });

async function openOne(path: string, opts: OpenOptions) {
  const existing = store().tabs.find((t) => t.path === path);
  if (existing) {
    store().setActive(existing.id);
    if (opts.pin && existing.preview) keepTab(existing.id);
    return;
  }
  try {
    const size = await backend.fileSize(path);
    const cur = activeTab();
    // A new preview replaces the current one (if it is still unchanged); otherwise opening a file into a fresh
    // window replaces the empty "Untitled" tab.
    const oldPreview = opts.preview ? store().tabs.find((t) => t.preview && !t.dirty) : undefined;
    const replaceId = oldPreview?.id ?? (cur && isPristine(cur) ? cur.id : undefined);
    const preview = opts.preview && !opts.pin ? true : undefined;
    if (opts.create && (await backend.fileMtime(path)) === null) {
      const tab = baseTab({ path, title: fileName(path), language: detectLanguage(path), mtime: null });
      if (tab.language === "html") tab.mdSource = true;
      store().addTab(tab, { replaceId });
      return;
    }
    // SQLite databases are recognised by their header, whatever they are called.
    if (await db.probe(path)) {
      store().addTab(dbTab(path, preview), { replaceId });
      return;
    }
    if (size > LARGE_FILE_BYTES) {
      // Big file: the tab appears at once and shows progress while the text streams in.
      const tab = baseTab({ path, title: fileName(path), language: detectLanguage(path), loading: { loaded: 0, total: size }, preview });
      store().addTab(tab, { replaceId });
      void loadFileInto(tab.id, path);
      return;
    }
    const file = await backend.readFile(path);
    const fields = fromFile(file);
    const tab = baseTab({ path, title: fileName(path), language: detectLanguage(path, fields.content), ...fields, preview });
    if (tab.language === "markdown" && fields.content.length > MD_FORMATTED_MAX) tab.mdSource = true;
    store().addTab(tab, { replaceId });
    reportEncoding(file, tab.title);
  } catch (e) {
    store().notify(`Could not open ${fileName(path)}: ${e}`, "error");
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
      unloaded: undefined,
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
  if (id) await ensureLoaded(id); // a hidden tab may have dropped its text: never write an empty file
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab || tab.loading) return false;
  if (isDb(tab)) return true; // every statement is written to the database when it runs
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

/**
 * Save As. `language` is the file type chosen first (Save As… shows the type picker); the dialog then suggests
 * the name with that type's extension. Typing another known extension in the dialog wins.
 */
export async function saveTabAs(id = store().activeId, language?: LanguageId): Promise<boolean> {
  if (id) await ensureLoaded(id);
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab || tab.loading) return false;
  if (isDb(tab)) return saveDbAs(tab);
  const chosen = language ?? tab.language;
  const lang = LANGUAGES[chosen];
  const ext = lang.extensions[0];
  // "notes.txt" saved as Markdown → suggest "notes.md" (an extension of the chosen type is kept).
  const current = tab.path ?? tab.title;
  const dot = fileName(current).lastIndexOf(".");
  const curExt = dot > 0 ? fileName(current).slice(dot + 1).toLowerCase() : "";
  const suggested = lang.extensions.includes(curExt) ? current : (dot > 0 ? current.slice(0, current.length - (fileName(current).length - dot)) : current) + "." + ext;
  const path = await save({
    title: `Save As ${lang.label}`,
    defaultPath: suggested,
    filters: [
      { name: lang.label, extensions: lang.extensions },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (!path) return false;
  const typed = detectLanguage(path, tab.content);
  const byExt = LANGUAGE_LIST.some((l) => l.extensions.includes(fileName(path).split(".").pop()!.toLowerCase()));
  const newLanguage: LanguageId = byExt ? typed : chosen;
  store().update(tab.id, { path, title: fileName(path), language: newLanguage, ...(newLanguage === "html" && tab.language !== "html" ? { mdSource: true } : {}) });
  const ok = await saveTab(tab.id);
  // Remount the editor if the language changed (e.g. .md saved as .txt).
  if (ok && newLanguage !== tab.language) store().replaceContent(tab.id, store().tabs.find((t) => t.id === tab.id)!.content);
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
  if (isDb(tab)) return store().replaceContent(id, "", { external: undefined }); // remount: reads the schema again
  if ((await backend.fileSize(tab.path).catch(() => 0)) > LARGE_FILE_BYTES) {
    store().update(id, { loading: { loaded: 0, total: 1 } });
    return loadFileInto(id, tab.path, readEncodingOf(tab));
  }
  try {
    const file = await backend.readFile(tab.path, readEncodingOf(tab));
    const { content, ...fields } = fromFile(file);
    store().replaceContent(id, content, { ...fields, dirty: false, external: undefined, unloaded: undefined });
  } catch (e) {
    store().notify(`Could not reload ${tab.title}: ${e}`, "error");
  }
}

/** Changes the file type. An untitled tab also gets the new extension ("Untitled-2.md" → "Untitled-2.sql"),
 *  so Save As suggests the right name. A saved file keeps its name and path. */
export async function setLanguage(id: string, language: LanguageId) {
  await ensureLoaded(id);
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab || isDb(tab) || tab.language === language) return;
  const patch: Partial<Tab> = { language };
  if (language === "html") patch.mdSource = true; // edit first; the preview is one ⌘/ away
  const untitled = tab.path === null && /^(Untitled-\d+)\.[^.]*$/.exec(tab.title);
  if (untitled) patch.title = `${untitled[1]}.${LANGUAGES[language].extensions[0]}`;
  store().replaceContent(id, tab.content, patch);
}

export async function toggleEol(id: string) {
  await ensureLoaded(id);
  const tab = store().tabs.find((t) => t.id === id);
  if (tab && !isDb(tab)) store().update(id, { eol: tab.eol === "\n" ? "\r\n" : "\n", dirty: true });
}

/** Markdown: formatted editor ⇄ source. HTML: preview ⇄ source. JSON, XML: source ⇄ tree view. (⌘/ · Ctrl+/) */
export function toggleSource(id = store().activeId) {
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab) return;
  if (hasRenderedView(tab.language)) store().update(tab.id, { mdSource: !tab.mdSource, scroll: 0 });
  else if (hasDataView(tab.language)) store().update(tab.id, { dataView: !tab.dataView });
}

/** Format Document (⇧⌥F). In code editors it is a single undoable edit. */
export async function formatActive() {
  const id = activeTab()?.id;
  if (id) await ensureLoaded(id);
  flushEdits();
  const tab = activeTab();
  if (!tab || tab.loading) return;
  const { formatText, FormatError } = await import("./editors/languages/format");
  if (isDb(tab)) {
    // A database: format the SQL in its query editor.
    try {
      const formatted = await formatText("sql", tab.query ?? "");
      if (formatted !== (tab.query ?? "")) activeEditor()?.replaceAll(formatted);
    } catch (e) {
      store().notify(e instanceof FormatError ? e.message : `Format failed: ${e}`, "error");
    }
    return;
  }
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
export const openHelp = () => openDoc("Notepad Help.md", helpText);

/** Help → Keyboard Shortcuts: SHORTCUTS.md (the one list of all shortcuts) in its own tab. */
export const openShortcuts = () => openDoc("Keyboard Shortcuts.md", shortcutsText);

function openDoc(title: string, content: string) {
  const open = store().tabs.find((t) => t.path === null && t.title === title);
  if (open) return store().setActive(open.id);
  store().addTab(baseTab({ title, language: "markdown", content }));
}

// ---------------------------------------------------------------- encodings

/** Reads the file again with another encoding (unsaved edits are discarded, after asking). */
export async function reopenWithEncoding(id: string, encoding: string) {
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab?.path || tab.loading || isDb(tab)) return;
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
  await ensureLoaded(id);
  flushEdits();
  const tab = store().tabs.find((t) => t.id === id);
  if (!tab || tab.loading || isDb(tab)) return;
  const before = { encoding: tab.encoding, bom: tab.bom, dirty: tab.dirty };
  store().update(id, { encoding, bom: bomFor(encoding, tab.bom), dirty: true });
  if (!tab.path) return;
  // If it can't be saved in that encoding (characters it doesn't have), keep the old one.
  if (!(await saveTab(id))) store().update(id, before);
}

export async function toggleBom(id: string) {
  await ensureLoaded(id);
  const tab = store().tabs.find((t) => t.id === id);
  if (tab && !isDb(tab) && tab.encoding === "utf-8") store().update(id, { bom: !tab.bom, dirty: true });
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
  if (!tab || isDb(tab)) return;
  const { Menu } = await import("@tauri-apps/api/menu");
  const menu = await Menu.new({ items: encodingMenuItems(tab) });
  await menu.popup();
}
