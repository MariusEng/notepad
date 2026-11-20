import { reloadTab } from "./actions";
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
      <button className="btn ghost" onClick={() => update(tab.id, { external: undefined })}>
        Keep my version
      </button>
    </div>
  );
}
