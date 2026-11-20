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

/** Buffer text last written per tab id, so unchanged buffers are not rewritten. */
const written = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();
let restored = false;

const needsBuffer = (t: Tab) => t.dirty || (t.path === null && t.content !== "");

async function writeSession() {
  flushEdits();
  const { tabs, activeId, mainId, splitId } = useTabs.getState();
  const keep: string[] = [];
  for (const t of tabs) {
    if (!needsBuffer(t)) continue;
    keep.push(t.id);
    if (written.get(t.id) !== t.content) {
      await backend.writeBuffer(t.id, t.content);
      written.set(t.id, t.content);
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
      cursor: t.cursor,
      scroll: t.scroll,
      buffered: keep.includes(t.id),
    })),
  };
  await backend.saveState("session", JSON.stringify(session));
  await backend.pruneBuffers(keep);
  for (const id of written.keys()) if (!keep.includes(id)) written.delete(id);
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
      if (s.buffered) {
        const text = await backend.readBuffer(s.id);
        if (text === null) continue;
        written.set(s.id, text);
        base.content = text;
        // Unsaved edits to a real file: warn if the file moved on underneath us.
        if (s.path) {
          const mtime = await backend.fileMtime(s.path);
          if (mtime === null) base.external = "deleted";
          else if (s.mtime !== null && mtime > s.mtime) base.external = "modified";
        }
      } else if (s.path) {
        // Clean file tab: always load the current version from disk. Big files stream in after startup.
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
    const changed =
      state.tabs !== prev.tabs ||
      state.activeId !== prev.activeId ||
      state.mainId !== prev.mainId ||
      state.splitId !== prev.splitId;
    if (restored && changed) scheduleSave();
  });
}

/**
 * Checks open files against the disk (called when the window regains focus).
 * Clean tabs reload silently; tabs with unsaved edits get a banner instead.
 */
export async function checkExternalChanges() {
  const { tabs, update, replaceContent } = useTabs.getState();
  for (const t of tabs) {
    if (!t.path || t.loading) continue;
    const mtime = await backend.fileMtime(t.path).catch(() => null);
    if (mtime === null) {
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
