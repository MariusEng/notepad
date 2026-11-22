import { LARGE_FILE_BYTES, backend } from "../lib/backend";
import { fromFile, readEncodingOf } from "../actions";
import { useTabs, type Tab } from "./store";

/**
 * Keeps memory low: a clean file tab that no pane shows drops its text after a while and reads it back from disk
 * when it is shown again (clean = the file on disk is exactly the text, so nothing can be lost). Tabs with unsaved
 * edits and untitled tabs always keep their text.
 *
 * Anything that needs an unloaded tab's text (save, change type, encodings…) awaits `ensureLoaded` first.
 */

/** How long a tab stays loaded after it was last shown. */
const UNLOAD_AFTER_MS = 20_000;
/** Smaller texts cost less than reloading them is worth. */
const MIN_CHARS = 64 * 1024;

const store = () => useTabs.getState();
const visible = (id: string) => {
  const { mainId, splitId } = store();
  return id === mainId || id === splitId;
};

const canUnload = (t: Tab) =>
  !!t.path && !t.dirty && !t.loading && !t.unloaded && !t.external && t.content.length >= MIN_CHARS && !visible(t.id);

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, Promise<void>>();

function unload(id: string) {
  timers.delete(id);
  const t = store().tabs.find((x) => x.id === id);
  if (!t || !canUnload(t)) return;
  store().update(id, { content: "", unloaded: true });
  // React keeps the previous render's props until the next render; when the app is idle that is the tab list
  // that still has this text. One more (empty) update lets it go.
  setTimeout(() => useTabs.setState((s) => ({ tabs: [...s.tabs] })), 0);
}

/** Reads an unloaded tab's text back from disk (once, however often it is asked for). */
export function ensureLoaded(id: string): Promise<void> {
  const t = store().tabs.find((x) => x.id === id);
  if (!t?.unloaded || !t.path) return Promise.resolve();
  const running = inFlight.get(id);
  if (running) return running;
  const path = t.path;
  const job = (async () => {
    const alive = () => store().tabs.some((x) => x.id === id && x.path === path && x.unloaded);
    try {
      const size = await backend.fileSize(path);
      const big = size > LARGE_FILE_BYTES;
      if (big) store().update(id, { loading: { loaded: 0, total: size } });
      const file = await backend.readText(
        path,
        big
          ? (loaded, total) => {
              if (!alive()) return false;
              store().update(id, { loading: { loaded, total } });
              return true;
            }
          : undefined,
        readEncodingOf(t),
      );
      if (!file || !alive()) return;
      const { content, ...fields } = fromFile(file);
      // The language, view and cursor stay as they were; only the text (and what the file says about it) is new.
      store().replaceContent(id, content, { ...fields, unloaded: undefined, loading: undefined, dirty: false });
    } catch {
      // Gone or unreadable: show the tab empty with the "deleted" banner. Nothing unsaved was in it.
      if (alive()) store().update(id, { unloaded: undefined, loading: undefined, external: "deleted" });
    } finally {
      inFlight.delete(id);
    }
  })();
  inFlight.set(id, job);
  return job;
}

/** Loads the tabs the panes show and schedules unloading for the others. */
function reconcile() {
  for (const t of store().tabs) {
    if (visible(t.id)) {
      clearTimeout(timers.get(t.id));
      timers.delete(t.id);
      if (t.unloaded) void ensureLoaded(t.id);
    } else if (canUnload(t) && !timers.has(t.id)) {
      timers.set(t.id, setTimeout(() => unload(t.id), UNLOAD_AFTER_MS));
    }
  }
  for (const id of timers.keys()) {
    if (!store().tabs.some((t) => t.id === id)) {
      clearTimeout(timers.get(id));
      timers.delete(id);
    }
  }
}

/** Call once at startup, after the session has been restored. */
export function startUnloading() {
  useTabs.subscribe((s, prev) => {
    if (s.tabs !== prev.tabs || s.mainId !== prev.mainId || s.splitId !== prev.splitId) reconcile();
  });
  reconcile();
}
