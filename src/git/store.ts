import { create } from "zustand";
import type { RepoInfo } from "./types";

export type SyncState = "idle" | "syncing" | "synced" | "local" | "error" | "conflict" | "auth";

export type Dialog =
  | null
  | { kind: "accounts"; host?: string }
  | { kind: "newRepo" }
  | { kind: "clone" }
  | { kind: "newBranch"; root?: string }
  /** The server refused a push to `branch` (protected main/master): offer to move the commits to a new branch. */
  | { kind: "pushRejected"; root: string; branch: string; reason: string };

export interface Sync {
  state: SyncState;
  message: string;
  conflicts: string[];
  at: number;
}

interface GitState {
  /** The open repositories, in sidebar order. */
  repos: RepoInfo[];
  /** The current one (status bar, git menu commands): the repository of the active tab, else the last used. */
  activeRoot: string | null;
  /** Sync state per repository root. */
  syncs: Record<string, Sync>;
  /** Bumped when files may have changed on disk (pull, merge), so the sidebar tree reloads. */
  treeVersion: number;
  dialog: Dialog;
}

export const useGit = create<GitState>(() => ({
  repos: [],
  activeRoot: null,
  syncs: {},
  treeVersion: 0,
  dialog: null,
}));

export const IDLE: Sync = { state: "idle", message: "", conflicts: [], at: 0 };
/** Selectors for useGit. */
export const currentRepo = (s: GitState) => s.repos.find((r) => r.root === s.activeRoot) ?? s.repos[0] ?? null;
export const syncOf = (root: string | undefined) => (s: GitState) => (root && s.syncs[root]) || IDLE;
