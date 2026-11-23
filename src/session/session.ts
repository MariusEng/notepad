import { LARGE_FILE_BYTES, backend } from "../lib/backend";
import { fromFile, loadFileInto, readEncodingOf } from "../actions";
import { flushEdits } from "../editors/handle";
import { LANGUAGES, type LanguageId } from "../editors/languages";
import { pairUp, useTabs, type Eol, type Tab } from "../tabs/store";

/**
 * "Hot exit": the app can be closed at any time without prompts.
 *
 *  - session.json lists the open tabs, the active tab, cursor and scroll positions.
 *  - Untitled tabs and tabs with unsaved edits have their text in buffers/<id>.txt,
 *    so nothing is lost and real files are only touched when you save.
 *  - Saved ~0.8 s after any change, and again when the window closes or the app quits.
 */

interface SessionTab {
  id: string;
  path: string | null;
  title: string;
  language: LanguageId;
  eol: Eol;
  bom: boolean;
  encoding?: string;
  dirty: boolean;
  mtime: number | null;
  mdSource: boolean;
  dataView?: boolean;
  preview?: boolean;
  kind?: "sqlite";
  query?: string;
  cursor: number;
  scroll: number;
  /** Text is stored in buffers/<id>.txt. */
  buffered: boolean;
}

interface Session {
  version: 1;
  activeId: string | null;
  /** Tabs in the left and right panes (right = split view). Older sessions only have activeId. */
  mainId?: string | null;
  splitId?: string | null;
  tabs: SessionTab[];
}

/** Tabs whose buffer file holds their current text (so it isn't rewritten), and tabs edited since. Only ids are
 *  kept: holding the last written text would keep a second copy of every edited document in memory. */
const onDisk = new Set<string>();
const changed = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();
let restored = false;

// (Unloaded tabs are clean file tabs, so they never need a buffer.)
const needsBuffer = (t: Tab) => t.dirty || (t.path === null && t.content !== "");

async function writeSession() {
  flushEdits();
  const { tabs, activeId, mainId, splitId } = useTabs.getState();
  const keep: string[] = [];
  for (const t of tabs) {
    if (!needsBuffer(t)) continue;
    keep.push(t.id);
    if (changed.has(t.id) || !onDisk.has(t.id)) {
      changed.delete(t.id); // an edit while writing marks it again
      try {
        await backend.writeBuffer(t.id, t.content);
        onDisk.add(t.id);
      } catch (e) {
        changed.add(t.id);
        throw e;
      }
    }
  }
  const session: Session = {
    version: 1,
    activeId,
    mainId,
    splitId,
    tabs: tabs.map((t) => ({
      id: t.id,
      path: t.path,
      title: t.title,
      language: t.language,
      eol: t.eol,
      bom: t.bom,
      encoding: t.encoding,
      dirty: t.dirty,
      mtime: t.mtime,
      mdSource: t.mdSource,
      dataView: t.dataView || undefined,
      preview: t.preview || undefined,
      kind: t.kind,
      query: t.query || undefined,
      cursor: t.cursor,
      scroll: t.scroll,
      buffered: keep.includes(t.id),
    })),
  };
  await backend.saveState("session", JSON.stringify(session));
  await backend.pruneBuffers(keep);
  for (const id of onDisk) if (!keep.includes(id)) onDisk.delete(id);
}

/** Writes the session now (waits for any write already in progress). */
export function saveSessionNow(): Promise<void> {
  clearTimeout(timer);
  saving = saving.then(writeSession).catch((e) => {
    console.error("session save failed", e);
  });
  return saving;
}

function scheduleSave() {
  clearTimeout(timer);
  // Big unsaved buffers are written less often (each write sends the whole text).
  const big = useTabs.getState().tabs.some((t) => needsBuffer(t) && t.content.length > 4_000_000);
  timer = setTimeout(saveSessionNow, big ? 5000 : 800);
}

/** Restores the previous session's tabs. Returns false if there was nothing to restore. */
/** Big clean files from the restored session, loaded once the window is up. */
const bigFiles: [string, string, string | null][] = [];

export async function restoreSession(): Promise<boolean> {
  let session: Session | null = null;
  try {
    const raw = await backend.loadState("session");
    session = raw ? (JSON.parse(raw) as Session) : null;
  } catch (e) {
    console.error("could not read session", e);
  }

  // Tabs the panes will show are read now; other clean files only when they are first shown (tabs/unload.ts).
  const shown = new Set([session?.mainId ?? session?.activeId, session?.splitId].filter(Boolean));
  const tabs: Tab[] = [];
  for (const s of session?.tabs ?? []) {
    const base: Tab = {
      ...s,
      language: s.language in LANGUAGES ? s.language : "plaintext",
      encoding: s.encoding ?? "utf-8",
      content: "",
      version: 0,
      external: undefined,
    };
    try {
      if (s.kind === "sqlite") {
        // A database: nothing to read now (DbView reads the schema). Gone: drop the tab.
        if (!s.path || (await backend.fileMtime(s.path)) === null) continue;
        tabs.push({ ...base, query: s.query ?? "" });
        continue;
      }
      if (s.buffered) {
        const text = await backend.readBuffer(s.id);
        if (text === null) continue;
        onDisk.add(s.id);
        base.content = text;
        // Unsaved edits to a real file: warn if the file moved on underneath us.
        if (s.path) {
          const mtime = await backend.fileMtime(s.path);
          if (mtime === null) base.external = "deleted";
          else if (s.mtime !== null && mtime > s.mtime) base.external = "modified";
        }
      } else if (s.path) {
        // Clean file tab: always load the current version from disk. Big files stream in after startup.
        if (!shown.has(s.id)) {
          if ((await backend.fileMtime(s.path)) === null) continue; // gone: nothing to lose, drop the tab
          tabs.push({ ...base, unloaded: true });
          continue;
        }
        if ((await backend.fileSize(s.path)) > LARGE_FILE_BYTES) {
          base.loading = { loaded: 0, total: 1 };
          bigFiles.push([s.id, s.path, readEncodingOf(base)]);
          tabs.push(base);
          continue;
        }
        const file = await backend.readFile(s.path, readEncodingOf(base));
        Object.assign(base, fromFile(file), { dirty: false });
      }
      // (Untitled, unbuffered tabs are empty; they restore as-is.)
      tabs.push(base);
    } catch {
      // A clean file that no longer exists: nothing to lose, so drop the tab.
    }
  }

  restored = true;
  if (!tabs.length) return false;
  const has = (id?: string | null) => !!id && tabs.some((t) => t.id === id);
  let splitId = has(session?.splitId) ? session!.splitId! : null;
  let mainId =
    [session?.mainId, session?.activeId].find((id) => has(id) && id !== splitId) ??
    tabs.find((t) => t.id !== splitId)?.id ??
    null;
  if (!mainId) {
    mainId = splitId; // only one tab: no split
    splitId = null;
  }
  const saved = session?.activeId;
  const activeId = saved && (saved === mainId || saved === splitId) ? saved : mainId;
  useTabs.setState({ tabs: pairUp(tabs, mainId, splitId), activeId, mainId, splitId });
  return true;
}

/** Streams in the big files of the restored session (call once the window is showing). */
export function loadRestoredBigFiles() {
  for (const [id, path, encoding] of bigFiles.splice(0)) void loadFileInto(id, path, encoding);
}

/** Start autosaving the session whenever tabs change. Call after restoreSession(). */
export function startSessionAutosave() {
  useTabs.subscribe((state, prev) => {
    if (state.tabs !== prev.tabs) {
      const before = new Map(prev.tabs.map((t) => [t.id, t.content]));
      for (const t of state.tabs) if (before.get(t.id) !== t.content) changed.add(t.id);
    }
    const moved =
      state.tabs !== prev.tabs ||
      state.activeId !== prev.activeId ||
      state.mainId !== prev.mainId ||
      state.splitId !== prev.splitId;
    if (restored && moved) scheduleSave();
  });
}

/**
 * Checks open files against the disk (called when the window regains focus).
 * Clean tabs reload silently; tabs with unsaved edits get a banner instead.
 */
export async function checkExternalChanges() {
  const { tabs, update, replaceContent } = useTabs.getState();
  for (const t of tabs) {
    // Unloaded tabs read the current file when they are shown again.
    if (!t.path || t.loading || t.unloaded || t.kind) continue; // (databases aren't text)
    const mtime = await backend.fileMtime(t.path).catch(() => null);
    if (mtime === null) {
      if (t.mtime === null) continue; // a new file from the command line that hasn't been saved yet
      if (t.external !== "deleted") update(t.id, { external: "deleted" });
      continue;
    }
    if (t.mtime !== null && mtime <= t.mtime) {
      if (t.external === "deleted") update(t.id, { external: undefined });
      continue;
    }
    if (!t.dirty) {
      try {
        if ((await backend.fileSize(t.path)) > LARGE_FILE_BYTES) {
          // e.g. a growing log file: stream the new version in, with progress.
          update(t.id, { loading: { loaded: 0, total: 1 } });
          void loadFileInto(t.id, t.path, readEncodingOf(t));
          continue;
        }
        const file = await backend.readFile(t.path, readEncodingOf(t));
        const { content, ...fields } = fromFile(file);
        if (content === t.content) update(t.id, { mtime: file.mtime, external: undefined });
        else replaceContent(t.id, content, { ...fields, external: undefined });
      } catch {
        /* unreadable right now; try again next time */
      }
    } else if (t.external !== "modified") {
      update(t.id, { external: "modified" });
    }
  }
}
