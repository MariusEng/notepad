import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { create } from "zustand";
import { files } from "../lib/backend";
import { useSettings } from "../settings";
import { useTabs } from "../tabs/store";
import { useGit } from "../git/store";
import { joinPath } from "../git/actions";
import { openFiles } from "../actions";
import type { GitPathInfo } from "../git/types";

const notify = (text: string, kind: "info" | "error" = "info") => useTabs.getState().notify(text, kind);

/** Full path of `rel` ("" = the root itself) inside `root`. */
export const pathIn = (root: string, rel: string) => (rel ? joinPath(root, rel) : root);
export const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** Tells the trees (repository and folder) to reload what they show. */
export const refreshTrees = () => useGit.setState((s) => ({ treeVersion: s.treeVersion + 1 }));

// ---------------------------------------------------------------- folder browser

export async function openFolder() {
  const dir = await pickFolder({ directory: true, multiple: false, title: "Open Folder" });
  if (typeof dir === "string") useSettings.getState().update({ folderRoot: dir, sidebar: true });
}

export const closeFolder = () => useSettings.getState().update({ folderRoot: null });

/** On launch: forget the folder if it has been moved or deleted. */
export async function restoreFolder() {
  const root = useSettings.getState().folderRoot;
  if (root) await files.listDir(root).catch(() => closeFolder());
}

/** Creates an empty file or folder in `dir`. Files open in a tab. Resolves to the new path, or null on failure. */
export async function createEntry(dir: string, name: string, kind: "file" | "folder"): Promise<string | null> {
  try {
    const path = kind === "file" ? await files.createFile(dir, name) : await files.createDir(dir, name);
    refreshTrees();
    if (kind === "file") await openFiles([path]);
    return path;
  } catch (e) {
    notify(String(e), "error");
    return null;
  }
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
  const { repo } = useGit.getState();
  const syncs = !!repo && norm(repo.root) === norm(mark.root) && useSettings.getState().autoCommit;
  const state = mark.tracked ? "" : " (not committed yet)";
  return syncs
    ? `In git: ${mark.name}${state}. Saving commits and pushes this file, so don't put secrets in it.`
    : `In git repository ${mark.name}${state}. It can be committed and pushed, so don't put secrets in it.`;
}
