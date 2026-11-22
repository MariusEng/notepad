import { createContext, useContext, useEffect, useRef, useState, type RefObject } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { files, git } from "../lib/backend";
import { useSettings } from "../settings";
import { useTabs } from "../tabs/store";
import { openFiles } from "../actions";
import { showBranchMenu, toggleSidebar } from "../git/actions";
import { useGit } from "../git/store";
import type { DirEntry, GitPathInfo } from "../git/types";
import { baseName, closeFolder, createEntry, deleteEntry, openFolder, pathIn, trashLabel } from "./actions";

/**
 * Left sidebar: the open git repository on top, the open folder below (either can be absent). Both are quiet file
 * trees: click a file to open it, right-click for New File / New Folder.
 */
export function Sidebar() {
  const repo = useGit((s) => s.repo);
  const folder = useSettings((s) => s.folderRoot);
  const visible = useSettings((s) => s.sidebar);
  const ratio = useSettings((s) => s.sidebarSplit);
  const aside = useRef<HTMLElement>(null);
  if ((!repo && !folder) || !visible) return null;
  const both = !!repo && !!folder;
  return (
    <aside className="sidebar" ref={aside} aria-label="Files">
      {repo && (
        <section className="sb-section" style={both ? { flex: `${ratio} 1 0` } : undefined} aria-label="Repository">
          <div className="sb-head">
            <button className="sb-title" title={`${repo.root}\nBranches, pull request, close repository`} onClick={() => void showBranchMenu()}>
              <span className="sb-repo">{repo.name}</span>
              <span className="sb-branch">{repo.branch ?? "(no branch)"} ▾</span>
            </button>
            <HideButton />
          </div>
          <Tree root={repo.root} list={(rel) => git.listDir(repo.root, rel)} />
        </section>
      )}
      {both && <SectionDivider container={aside} />}
      {folder && (
        <section className="sb-section" style={both ? { flex: `${1 - ratio} 1 0` } : undefined} aria-label="Folder">
          <FolderHead root={folder} hide={!repo} />
          <Tree root={folder} list={(rel) => files.listDir(pathIn(folder, rel))} />
        </section>
      )}
    </aside>
  );
}

function HideButton() {
  return (
    <button className="sb-x" title="Hide sidebar (⇧⌘E · Ctrl+Shift+E)" aria-label="Hide sidebar" onClick={toggleSidebar}>
      <svg viewBox="0 0 16 16" aria-hidden>
        <rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6 3v10" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    </button>
  );
}

/** Small git glyph used to mark things that end up in a git repository (tabs, the folder header). */
export function GitGlyph({ title }: { title: string }) {
  return (
    <span className="git-mark" title={title} aria-label={title} role="img">
      <svg viewBox="0 0 16 16" aria-hidden>
        <circle cx="5" cy="3.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="5" cy="12.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="11.5" cy="5.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 5.1v5.8M11.5 7.1c0 2.4-2.2 3-5.2 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </span>
  );
}

function FolderHead({ root, hide }: { root: string; hide: boolean }) {
  const version = useGit((s) => s.treeVersion);
  const [mark, setMark] = useState<GitPathInfo | null>(null);
  useEffect(() => {
    let live = true;
    files
      .gitInfo(root)
      .then((m) => live && setMark(m))
      .catch(() => live && setMark(null));
    return () => {
      live = false;
    };
  }, [root, version]);

  const menu = async () => {
    const m = await Menu.new({
      items: [
        { id: "folder-new-file", text: "New File…", action: () => startCreate(root, "", "file") },
        { id: "folder-new-dir", text: "New Folder…", action: () => startCreate(root, "", "folder") },
        { item: "Separator" as const },
        { id: "folder-open", text: "Open Another Folder…", action: () => void openFolder() },
        { id: "folder-close", text: "Close Folder", action: closeFolder },
      ],
    });
    await m.popup();
  };

  return (
    <div className="sb-head">
      <button className="sb-title" title={`${root}\nNew file or folder, open another folder, close`} onClick={() => void menu()}>
        <span className="sb-repo">{baseName(root)}</span>
        {mark && <GitGlyph title={`This folder is in git repository ${mark.name}: files you add can be committed and pushed, so don't put secrets in them.`} />}
        <span className="sb-branch">▾</span>
      </button>
      {hide && <HideButton />}
    </div>
  );
}

/** Drag to share the sidebar's height between the repository and the folder; double-click for half and half. */
function SectionDivider({ container }: { container: RefObject<HTMLElement | null> }) {
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = container.current?.getBoundingClientRect();
    if (!rect) return;
    const set = (r: number) => useSettings.setState({ sidebarSplit: Math.min(0.85, Math.max(0.15, r)) });
    const move = (ev: MouseEvent) => set((ev.clientY - rect.top) / rect.height);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing-v");
      useSettings.getState().update({ sidebarSplit: useSettings.getState().sidebarSplit }); // persist once
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.classList.add("resizing-v");
  };
  return (
    <div
      className="sb-divider"
      role="separator"
      aria-orientation="horizontal"
      onMouseDown={onDown}
      onDoubleClick={() => useSettings.getState().update({ sidebarSplit: 0.5 })}
    />
  );
}

// ---------------------------------------------------------------- tree

type Kind = "file" | "folder";
interface Creating {
  /** Folder (relative to the tree's root, "" = root) that gets the new item. */
  dir: string;
  kind: Kind;
}

interface TreeCtx {
  root: string;
  list: (rel: string) => Promise<DirEntry[]>;
  expanded: Set<string>;
  setOpen: (rel: string, open: boolean) => void;
  creating: Creating | null;
  setCreating: (c: Creating | null) => void;
}
const Ctx = createContext<TreeCtx>(null!);

/** "New File…" from outside a tree (the folder header menu) reaches the tree with this root. */
const starters = new Map<string, (dir: string, kind: Kind) => void>();
const startCreate = (root: string, dir: string, kind: Kind) => starters.get(root)?.(dir, kind);

function Tree({ root, list }: { root: string; list: (rel: string) => Promise<DirEntry[]> }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creating, setCreatingState] = useState<Creating | null>(null);

  // Opening another folder starts collapsed.
  useEffect(() => {
    setExpanded(new Set());
    setCreatingState(null);
  }, [root]);

  const setOpen = (rel: string, open: boolean) =>
    setExpanded((s) => {
      if (s.has(rel) === open) return s;
      const next = new Set(s);
      if (open) next.add(rel);
      else next.delete(rel);
      return next;
    });

  const setCreating = (c: Creating | null) => {
    if (c?.dir) setOpen(c.dir, true); // the input row appears inside that folder
    setCreatingState(c);
  };

  useEffect(() => {
    starters.set(root, (dir, kind) => setCreating({ dir, kind }));
    return () => void starters.delete(root);
  }, [root]);

  return (
    <Ctx.Provider value={{ root, list, expanded, setOpen, creating, setCreating }}>
      <div
        className="sb-tree"
        role="tree"
        onContextMenu={(e) => {
          // Right-click on empty space: create at the top level.
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          void entryMenu(root, "", null, setCreating);
        }}
      >
        <Children rel="" depth={0} />
      </div>
    </Ctx.Provider>
  );
}

/** Right-click menu for a tree item (`entry` null = the tree's background). */
async function entryMenu(root: string, rel: string, entry: DirEntry | null, setCreating: (c: Creating) => void) {
  const isDir = !entry || entry.isDir;
  const dir = isDir ? rel : rel.split("/").slice(0, -1).join("/");
  const where = dir ? ` in ${dir.split("/").pop()}` : "";
  const full = pathIn(root, rel);
  const menu = await Menu.new({
    items: [
      ...(entry && !entry.isDir
        ? [
            { id: "tree-open", text: "Open", action: () => void openFiles([full]) },
            { item: "Separator" as const },
          ]
        : []),
      { id: "tree-new-file", text: `New File${where}…`, action: () => setCreating({ dir, kind: "file" }) },
      { id: "tree-new-dir", text: `New Folder${where}…`, action: () => setCreating({ dir, kind: "folder" }) },
      ...(entry
        ? [
            { item: "Separator" as const },
            { id: "tree-copy-path", text: "Copy Path", action: () => void navigator.clipboard.writeText(full).catch(() => {}) },
            { item: "Separator" as const },
            { id: "tree-delete", text: `${trashLabel}…`, action: () => void deleteEntry(full, entry.isDir) },
          ]
        : []),
    ],
  });
  await menu.popup();
}

function Children({ rel, depth }: { rel: string; depth: number }) {
  const { root, list, creating } = useContext(Ctx);
  const version = useGit((s) => s.treeVersion);
  const [items, setItems] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    list(rel)
      .then((l) => live && setItems(l))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
    // `list` is a new function each render; root + rel identify what it lists.
  }, [root, rel, version]);

  return (
    <>
      {creating?.dir === rel && <NewItemRow depth={depth} kind={creating.kind} />}
      {items?.map((e) => (
        <Node key={e.name} rel={rel ? `${rel}/${e.name}` : e.name} entry={e} depth={depth} />
      ))}
    </>
  );
}

function Node({ rel, entry, depth }: { rel: string; entry: DirEntry; depth: number }) {
  const { root, expanded, setOpen, setCreating } = useContext(Ctx);
  const open = expanded.has(rel);
  const full = pathIn(root, rel);
  const active = useTabs((s) => !entry.isDir && s.tabs.find((t) => t.id === s.activeId)?.path === full);
  return (
    <>
      <div
        className={`sb-node${active ? " active" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        role="treeitem"
        aria-expanded={entry.isDir ? open : undefined}
        title={rel}
        onClick={() => (entry.isDir ? setOpen(rel, !open) : void openFiles([full]))}
        onContextMenu={(e) => {
          e.preventDefault();
          void entryMenu(root, rel, entry, setCreating);
        }}
      >
        <span className="sb-caret">{entry.isDir ? (open ? "▾" : "▸") : ""}</span>
        <span className="sb-name">{entry.name}</span>
      </div>
      {entry.isDir && open && <Children rel={rel} depth={depth + 1} />}
    </>
  );
}

/** Inline name field for a new file or folder: Enter creates it, Escape (or clicking elsewhere) cancels. */
function NewItemRow({ depth, kind }: { depth: number; kind: Kind }) {
  const { root, creating, setCreating, setOpen } = useContext(Ctx);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const initial = kind === "file" ? "Untitled.md" : "New Folder";

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    // Select the name without the extension, so typing keeps ".md".
    const dot = kind === "file" ? initial.lastIndexOf(".") : -1;
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [kind]);

  const submit = async () => {
    const name = input.current?.value.trim() ?? "";
    if (!name || !creating || busy.current) return;
    busy.current = true;
    const made = await createEntry(pathIn(root, creating.dir), name, kind);
    busy.current = false;
    if (!made) {
      input.current?.focus(); // keep the field so the name can be fixed
      return;
    }
    setCreating(null);
    if (kind === "folder") setOpen(creating.dir ? `${creating.dir}/${name}` : name, true);
  };

  return (
    <div className="sb-node sb-new" style={{ paddingLeft: 8 + depth * 12 }}>
      <span className="sb-caret">{kind === "folder" ? "▸" : ""}</span>
      <input
        ref={input}
        className="sb-input"
        defaultValue={initial}
        aria-label={kind === "file" ? "New file name" : "New folder name"}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") void submit();
          else if (e.key === "Escape") setCreating(null);
        }}
        onBlur={() => !busy.current && setCreating(null)}
      />
    </div>
  );
}
