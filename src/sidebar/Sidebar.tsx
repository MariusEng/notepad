import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { files, git } from "../lib/backend";
import { SIDEBAR_WIDTH, useSettings } from "../settings";
import { useTabs } from "../tabs/store";
import { openFiles } from "../actions";
import { LANGUAGE_LIST } from "../editors/languages";
import { activateRepo, closeRepo, openRepoFolder, showBranchMenu, syncNow, toggleSidebar } from "../git/actions";
import { syncOf, useGit } from "../git/store";
import type { DirEntry, GitPathInfo, RepoInfo } from "../git/types";
import { baseName, closeFolder, createEntry, deleteEntry, openFolder, pathIn, toggleSection, trashLabel, type Kind } from "./actions";

/**
 * Left sidebar: a collapsible section per open git repository, then one per open folder, each a quiet file tree.
 * Click a file to open it, right-click for New File / New Folder, × closes the section.
 */
export function Sidebar() {
  const repos = useGit((s) => s.repos);
  const folders = useSettings((s) => s.folders);
  const visible = useSettings((s) => s.sidebar);
  const width = useSettings((s) => s.sidebarWidth);
  if ((!repos.length && !folders.length) || !visible) return null;
  return (
    <aside className="sidebar" style={{ width }} aria-label="Files">
      <div className="sb-top">
        <HideButton />
      </div>
      <div className="sb-scroll">
        {repos.map((r) => (
          <RepoSection key={r.root} repo={r} />
        ))}
        {folders.map((f) => (
          <FolderSection key={f} root={f} />
        ))}
      </div>
      <WidthHandle />
    </aside>
  );
}

/** Collapsible header + tree. The tree stays mounted while collapsed, so it keeps its open folders. */
function Section(props: {
  id: string;
  root: string;
  name: string;
  list: (rel: string) => Promise<DirEntry[]>;
  extra?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  /** Extra items for the header's right-click menu. */
  menu: { id: string; text: string; action: () => void }[];
}) {
  const { id, root, name, list, extra, closeLabel, onClose } = props;
  const open = useSettings((s) => !s.collapsed.includes(id));
  const menu = async () => {
    const start = (c: Creating) => {
      if (!open) toggleSection(id);
      starters.get(id)?.(c);
    };
    const m = await Menu.new({
      items: [
        ...newItems("", "", start),
        { item: "Separator" as const },
        ...props.menu,
        { id: "section-close", text: closeLabel, action: onClose },
      ],
    });
    await m.popup();
  };
  return (
    <section className="sb-section" aria-label={name}>
      <div
        className="sb-head"
        onContextMenu={(e) => {
          e.preventDefault();
          void menu();
        }}
      >
        <button className="sb-title" title={root} aria-expanded={open} onClick={() => toggleSection(id)}>
          <span className="sb-caret">{open ? "▾" : "▸"}</span>
          <span className="sb-repo">{name}</span>
        </button>
        {extra}
        <button className="sb-x sb-close" title={closeLabel} aria-label={`${closeLabel}: ${name}`} onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden>
            <path d="M4.5 4.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div hidden={!open}>
        <Tree id={id} root={root} list={list} />
      </div>
    </section>
  );
}

function RepoSection({ repo }: { repo: RepoInfo }) {
  const sync = useGit(syncOf(repo.root));
  const trouble = ["error", "conflict", "auth"].includes(sync.state);
  return (
    <Section
      id={`repo:${repo.root}`}
      root={repo.root}
      name={repo.name}
      list={(rel) => git.listDir(repo.root, rel)}
      closeLabel="Close Repository"
      onClose={() => closeRepo(repo.root)}
      menu={[
        { id: "section-sync", text: "Sync Now", action: () => void syncNow(false, repo.root) },
        { id: "section-open", text: "Open Another Repository…", action: () => void openRepoFolder() },
      ]}
      extra={
        <>
          {trouble && (
            <button className="sb-chip sb-warn" title={`${sync.message}\nClick to sync now`} onClick={() => void syncNow(false, repo.root)}>
              ⚠
            </button>
          )}
          <button
            className="sb-chip"
            title="Branches, pull request, sync"
            onClick={() => {
              activateRepo(repo.root);
              void showBranchMenu(repo.root);
            }}
          >
            {repo.branch ?? "(no branch)"}
          </button>
        </>
      }
    />
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

function FolderSection({ root }: { root: string }) {
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

  return (
    <Section
      id={`folder:${root}`}
      root={root}
      name={baseName(root)}
      list={(rel) => files.listDir(pathIn(root, rel))}
      closeLabel="Close Folder"
      onClose={() => closeFolder(root)}
      menu={[{ id: "section-open", text: "Open Another Folder…", action: () => void openFolder() }]}
      extra={
        mark && <GitGlyph title={`This folder is in git repository ${mark.name}: files you add can be committed and pushed, so don't put secrets in them.`} />
      }
    />
  );
}

/** Drag the sidebar's right edge to resize it; double-click for the default width. */
function WidthHandle() {
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const left = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().left;
    const move = (ev: MouseEvent) =>
      useSettings.setState({ sidebarWidth: Math.round(Math.max(140, Math.min(ev.clientX - left, window.innerWidth * 0.6))) });
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
      useSettings.getState().update({ sidebarWidth: useSettings.getState().sidebarWidth }); // persist once
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    document.body.classList.add("resizing");
  };
  return (
    <div
      className="sb-resize"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize"
      onMouseDown={onDown}
      onDoubleClick={() => useSettings.getState().update({ sidebarWidth: SIDEBAR_WIDTH })}
    />
  );
}

// ---------------------------------------------------------------- tree

interface Creating {
  /** Folder (relative to the tree's root, "" = root) that gets the new item. */
  dir: string;
  kind: Kind;
  /** The name the field starts with. */
  name: string;
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

/** "New File" from a section's header menu reaches its tree through this (by section id). */
const starters = new Map<string, (c: Creating) => void>();

/** New File (submenu: the type) and New Folder, for a right-click menu. */
function newItems(dir: string, where: string, start: (c: Creating) => void) {
  return [
    {
      id: "tree-new-file",
      text: `New File${where}`,
      items: [
        ...LANGUAGE_LIST.map((l) => ({
          id: `tree-new-${l.id}`,
          text: `${l.label} (.${l.extensions[0]})`,
          action: () => start({ dir, kind: "file", name: `Untitled.${l.extensions[0]}` }),
        })),
        { item: "Separator" as const },
        {
          id: "tree-new-sqlite",
          text: "SQLite Database (.sqlite)",
          action: () => start({ dir, kind: "database", name: "Untitled.sqlite" }),
        },
      ],
    },
    { id: "tree-new-dir", text: `New Folder${where}…`, action: () => start({ dir, kind: "folder", name: "New Folder" }) },
  ];
}

function Tree({ id, root, list }: { id: string; root: string; list: (rel: string) => Promise<DirEntry[]> }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [creating, setCreatingState] = useState<Creating | null>(null);

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
    starters.set(id, setCreating);
    return () => void starters.delete(id);
  }, [id]);

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
      ...newItems(dir, where, setCreating),
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
      {creating?.dir === rel && <NewItemRow key={creating.name} depth={depth} kind={creating.kind} initial={creating.name} />}
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
        // Files: a single click opens a preview (replaced by the next one), a double click keeps the tab open.
        onClick={() => (entry.isDir ? setOpen(rel, !open) : void openFiles([full], { preview: true }))}
        onDoubleClick={() => !entry.isDir && void openFiles([full], { pin: true })}
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
function NewItemRow({ depth, kind, initial }: { depth: number; kind: Kind; initial: string }) {
  const { root, creating, setCreating, setOpen } = useContext(Ctx);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    // Select the name without the extension, so typing keeps ".md".
    const dot = kind !== "folder" ? initial.lastIndexOf(".") : -1;
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
        aria-label={kind === "folder" ? "New folder name" : "New file name"}
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
