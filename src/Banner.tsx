import { reloadTab } from "./actions";
import { backend } from "./lib/backend";
import { useTabs, type Tab } from "./tabs/store";

/** Shown when the open file changed or disappeared on disk. */
export function Banner({ tab }: { tab: Tab }) {
  const update = useTabs((s) => s.update);
  if (!tab.external) return null;
  return (
    <div className="banner" role="alert">
      {tab.external === "deleted" ? (
        <span>This file was deleted or moved on disk. Save to recreate it.</span>
      ) : (
        <span>This file was changed on disk, and you have unsaved changes here.</span>
      )}
      <span className="sb-spacer" />
      {tab.external === "modified" && (
        <button className="btn" onClick={() => reloadTab(tab.id)}>
          Reload from disk
        </button>
      )}
      <button
        className="btn ghost"
        onClick={async () => {
          // Accept the current disk state as the baseline, so the warning doesn't return.
          const mtime = tab.path ? await backend.fileMtime(tab.path).catch(() => null) : null;
          update(tab.id, { external: undefined, mtime: mtime ?? tab.mtime });
        }}
      >
        Keep my version
      </button>
    </div>
  );
}
