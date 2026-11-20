import { useEffect, useState } from "react";
import { git } from "../lib/backend";
import { useSettings } from "../settings";
import { useTabs } from "../tabs/store";
import { closeRepo, joinPath, openRepoFile } from "./actions";
import { useGit } from "./store";
import type { DirEntry } from "./types";

/** Quiet file tree for the open repository: click a file to open it in the editor. */
export function Sidebar() {
  const repo = useGit((s) => s.repo);
  const visible = useSettings((s) => s.sidebar);
  if (!repo || !visible) return null;
  return (
    <aside className="sidebar" aria-label="Repository">
      <div className="sb-head">
        <span className="sb-repo" title={repo.root}>
          {repo.name}
        </span>
        {repo.branch && <span className="sb-branch">{repo.branch}</span>}
        <button className="sb-x" title="Close repository" aria-label="Close repository" onClick={closeRepo}>
          ×
        </button>
      </div>
      <div className="sb-tree" role="tree">
        <Children root={repo.root} rel="" depth={0} />
      </div>
    </aside>
  );
}

function Children({ root, rel, depth }: { root: string; rel: string; depth: number }) {
  const version = useGit((s) => s.treeVersion);
  const [items, setItems] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    git
      .listDir(root, rel)
      .then((list) => live && setItems(list))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [root, rel, version]);

  if (!items) return null;
  return (
    <>
      {items.map((e) => (
        <Node key={e.name} root={root} rel={rel ? `${rel}/${e.name}` : e.name} entry={e} depth={depth} />
      ))}
    </>
  );
}

function Node({ root, rel, entry, depth }: { root: string; rel: string; entry: DirEntry; depth: number }) {
  const [open, setOpen] = useState(false);
  const activePath = useTabs((s) => s.tabs.find((t) => t.id === s.activeId)?.path ?? null);
  const full = joinPath(root, rel);
  const active = !entry.isDir && activePath === full;
  return (
    <>
      <div
        className={`sb-node${active ? " active" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        role="treeitem"
        aria-expanded={entry.isDir ? open : undefined}
        title={rel}
        onClick={() => (entry.isDir ? setOpen(!open) : void openRepoFile(root, rel))}
      >
        <span className="sb-caret">{entry.isDir ? (open ? "▾" : "▸") : ""}</span>
        <span className="sb-name">{entry.name}</span>
      </div>
      {entry.isDir && open && <Children root={root} rel={rel} depth={depth + 1} />}
    </>
  );
}
