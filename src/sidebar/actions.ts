import { ask, open as pickFolder } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { db, files, isMac } from "../lib/backend";
import { useSettings } from "../settings";
import { useTabs } from "../tabs/store";
import { useGit } from "../git/store";
import { afterDelete, closeRepo, joinPath, repoOf } from "../git/actions";
import { newTab, openFiles } from "../actions";
import type { GitPathInfo } from "../git/types";

export type Kind = "file" | "folder" | "database";

const notify = (text: string, kind: "info" | "error" = "info") => useTabs.getState().notify(text, kind);

/** Full path of `rel` ("" = the root itself) inside `root`. */
export const pathIn = (root: string, rel: string) => (rel ? joinPath(root, rel) : root);
export const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** Tells the trees (repository and folder) to reload what they show. */
export const refreshTrees = () => useGit.setState((s) => ({ treeVersion: s.treeVersion + 1 }));

// ---------------------------------------------------------------- folder browser

export async function openFolder() {
  const dirs = await pickFolder({ directory: true, multiple: true, title: "Open Folder" });
  if (!dirs?.length) return;
  const s = useSettings.getState();
  s.update({
    folders: [...new Set([...s.folders, ...dirs])],
    collapsed: s.collapsed.filter((c) => !dirs.some((d) => c === `folder:${d}`)),
    sidebar: true,
  });
}

export function closeFolder(root: string) {
  const s = useSettings.getState();
  s.update({ folders: s.folders.filter((f) => f !== root), collapsed: s.collapsed.filter((c) => c !== `folder:${root}`) });
}

export function toggleSection(key: string) {
  const s = useSettings.getState();
  s.update({ collapsed: s.collapsed.includes(key) ? s.collapsed.filter((c) => c !== key) : [...s.collapsed, key] });
}

/** On launch: forget folders that have been moved or deleted. */
export async function restoreFolders() {
  for (const root of useSettings.getState().folders) await files.listDir(root).catch(() => closeFolder(root));
}

const DB_FILE = /\.(sqlite3?|db3?)$/i;

/** New SQLite database. `db.create` replaces an existing file, so check first. */
async function createDatabase(dir: string, name: string): Promise<string> {
  if (!DB_FILE.test(name)) name += ".sqlite";
  if (/[\\/]/.test(name)) throw `"${name}" isn't a valid name`;
  const taken = (await files.listDir(dir)).some((e) => e.name.toLowerCase() === name.toLowerCase());
  if (taken) throw `${name} already exists`;
  const path = joinPath(dir, name);
  await db.create(path);
  return path;
}

/** Creates an empty file or folder in `dir`. Files open in a tab. Resolves to the new path, or null on failure. */
export async function createEntry(dir: string, name: string, kind: Kind): Promise<string | null> {
  try {
    const path = await (kind === "folder" ? files.createDir : kind === "database" ? createDatabase : files.createFile)(dir, name);
    refreshTrees();
    if (kind !== "folder") await openFiles([path]);
    return path;
  } catch (e) {
    notify(String(e), "error");
    return null;
  }
}

const under = (path: string, p: string) => {
  const a = p.replace(/\\/g, "/");
  const b = path.replace(/\\/g, "/");
  return a === b || a.startsWith(b + "/");
};

export const trashLabel = isMac ? "Move to Trash" : "Delete";

/**
 * Moves a file or folder to the Trash after asking. Open tabs of those files close (ones with unsaved edits stay
 * open and show that the file is gone). In an open repository the removal is committed and pushed.
 */
export async function deleteEntry(path: string, isDir: boolean) {
  const name = baseName(path);
  const repo = repoOf(path);
  const synced = !!repo && useSettings.getState().autoCommit;
  const what = isDir ? `the folder "${name}" and everything in it` : `"${name}"`;
  const bin = isMac ? "the Trash" : "the Recycle Bin";
  const detail = synced
    ? `The deletion is committed and pushed to ${repo!.name}, so it is gone from the server too (the history keeps it).`
    : `You can get it back from ${bin}.`;
  const ok = await ask(`${isMac ? "Move" : "Delete"} ${what}${isMac ? " to the Trash" : ""}?\n\n${detail}`, {
    title: trashLabel,
    kind: "warning",
    okLabel: trashLabel,
    cancelLabel: "Cancel",
  });
  if (!ok) return;
  try {
    await files.trash(path);
  } catch (e) {
    notify(String(e), "error");
    return;
  }
  const tabs = useTabs.getState();
  for (const t of tabs.tabs) {
    if (!t.path || !under(path, t.path)) continue;
    if (t.dirty) tabs.update(t.id, { external: "deleted" });
    else tabs.removeTab(t.id);
  }
  if (useTabs.getState().tabs.length === 0) newTab();
  for (const f of useSettings.getState().folders) if (under(path, f)) closeFolder(f);
  for (const r of useGit.getState().repos) if (under(path, r.root)) closeRepo(r.root);
  refreshTrees();
  afterDelete(path);
}

// ---------------------------------------------------------------- git marks on tabs

/** path → the git repository it is in (null: not in git, or ignored). Only for paths of open tabs. */
export const useGitMarks = create<{ marks: Record<string, GitPathInfo | null> }>(() => ({ marks: {} }));

let markRun = 0;
/** Looks up which of these files are in a git repository. Cheap (no network); run when tabs or the repo change. */
export async function refreshGitMarks(paths: string[]) {
  const run = ++markRun;
  const entries = await Promise.all(
    paths.map(async (p) => [p, await files.gitInfo(p).catch(() => null)] as const),
  );
  if (run === markRun) useGitMarks.setState({ marks: Object.fromEntries(entries) });
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** Tooltip for a file's git mark: says whether saving pushes it, and to keep secrets out. */
export function gitMarkText(mark: GitPathInfo): string {
  const open = useGit.getState().repos.some((r) => norm(r.root) === norm(mark.root));
  const syncs = open && useSettings.getState().autoCommit;
  const state = mark.tracked ? "" : " (not committed yet)";
  return syncs
    ? `In git: ${mark.name}${state}. Saving commits and pushes this file, so don't put secrets in it.`
    : `In git repository ${mark.name}${state}. It can be committed and pushed, so don't put secrets in it.`;
}
