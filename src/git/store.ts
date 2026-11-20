import { create } from "zustand";
import type { RepoInfo } from "./types";

export type SyncState = "idle" | "syncing" | "synced" | "local" | "error" | "conflict" | "auth";

export type Dialog =
  | null
  | { kind: "accounts"; host?: string }
  | { kind: "newRepo" }
  | { kind: "clone" };

interface GitState {
  repo: RepoInfo | null;
  sync: { state: SyncState; message: string; conflicts: string[]; at: number };
  /** Bumped when files may have changed on disk (pull, merge), so the sidebar tree reloads. */
  treeVersion: number;
  dialog: Dialog;
}

export const useGit = create<GitState>(() => ({
  repo: null,
  sync: { state: "idle", message: "", conflicts: [], at: 0 },
  treeVersion: 0,
  dialog: null,
}));
