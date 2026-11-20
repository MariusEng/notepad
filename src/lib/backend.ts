import { invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  DeviceStart,
  DirEntry,
  NewRepo,
  ProviderCfg,
  RepoCreated,
  RepoInfo,
  SignIn,
  SyncResult,
} from "../git/types";

export interface FileData {
  content: string;
  /** The file started with a UTF-8 byte order mark; written back on save. */
  bom: boolean;
  mtime: number | null;
}

/** Files above this size are refused: the editor keeps the whole text in memory. */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
/** Files above this size load in the background with a progress bar. */
export const LARGE_FILE_BYTES = 4 * 1024 * 1024;
const CHUNK = 16 * 1024 * 1024;

export const formatSize = (n: number) =>
  n >= 1024 * 1024 * 1024
    ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
    : n >= 1024 * 1024
      ? `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`
      : `${Math.max(1, Math.round(n / 1024))} KB`;

/**
 * Reads a text file in chunks (raw bytes, decoded as UTF-8 with invalid bytes replaced).
 * `onProgress` returns false to cancel (then this resolves to null).
 */
async function readText(path: string, onProgress?: (loaded: number, total: number) => boolean): Promise<FileData | null> {
  const stat = await invoke<{ size: number; mtime: number | null }>("file_stat", { path });
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`the file is ${formatSize(stat.size)}; Notepad opens files up to ${formatSize(MAX_FILE_BYTES)}`);
  }
  const decoder = new TextDecoder("utf-8"); // drops a leading BOM by itself
  const parts: string[] = [];
  let bom = false;
  let offset = 0;
  for (;;) {
    const buf = new Uint8Array(await invoke<ArrayBuffer>("read_file_range", { path, offset, len: CHUNK }));
    if (offset === 0) bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    parts.push(decoder.decode(buf, { stream: true }));
    offset += buf.length;
    if (onProgress && !onProgress(offset, Math.max(stat.size, offset))) return null;
    // A short read is the end (a growing log file just gets read up to where it is now).
    if (buf.length < CHUNK || offset > MAX_FILE_BYTES) break;
  }
  parts.push(decoder.decode());
  return { content: parts.join(""), bom, mtime: stat.mtime };
}


export const backend = {
  readFile: async (path: string) => (await readText(path))!,
  readText,
  fileSize: async (path: string) => (await invoke<{ size: number }>("file_stat", { path })).size,
  writeFile: (path: string, content: string, bom: boolean) =>
    invoke<number | null>("write_file", { path, content, bom }),
  fileMtime: (path: string) => invoke<number | null>("file_mtime", { path }),
  loadState: (name: "session" | "settings") => invoke<string | null>("load_state", { name }),
  saveState: (name: "session" | "settings", json: string) => invoke<void>("save_state", { name, json }),
  writeBuffer: (id: string, content: string) => invoke<void>("write_buffer", { id, content }),
  readBuffer: (id: string) => invoke<string | null>("read_buffer", { id }),
  pruneBuffers: (keep: string[]) => invoke<void>("prune_buffers", { keep }),
  takePendingOpen: () => invoke<string[]>("take_pending_open"),
  quit: () => invoke<void>("quit_app"),
  formatExternal: (tool: "shfmt" | "perltidy" | "pwsh", input: string, indent = 2) =>
    invoke<string>("format_external", { tool, input, indent }),
};

export const git = {
  open: (path: string) => invoke<RepoInfo>("git_open", { path }),
  info: (root: string) => invoke<RepoInfo>("git_info", { root }),
  listDir: (root: string, rel: string) => invoke<DirEntry[]>("git_list_dir", { root, rel }),
  /** Commits one saved file; resolves to the commit message, or null if there was nothing to commit. */
  commitFile: (root: string, file: string, author: string | null) =>
    invoke<string | null>("git_commit_file", { root, file, author }),
  sync: (root: string) => invoke<SyncResult>("git_sync", { root }),
  clone: (url: string, dest: string) => invoke<RepoInfo>("git_clone", { url, dest }),
  branches: (root: string) => invoke<BranchInfo[]>("git_branches", { root }),
  switchBranch: (root: string, name: string) => invoke<RepoInfo>("git_switch_branch", { root, name }),
  createBranch: (root: string, name: string) => invoke<RepoInfo>("git_create_branch", { root, name }),
  /** Moves unpushed commits off a branch the server refuses, onto a new branch. */
  moveToBranch: (root: string, name: string) => invoke<RepoInfo>("git_move_to_branch", { root, name }),
  createRepo: (cfg: ProviderCfg, repo: NewRepo) => invoke<RepoCreated>("git_create_repo", { cfg, repo }),
  credSavePat: (host: string, username: string, token: string, provider: string) =>
    invoke<void>("cred_save_pat", { host, username, token, provider }),
  credDelete: (host: string) => invoke<void>("cred_delete", { host }),
  credExists: (host: string) => invoke<boolean>("cred_exists", { host }),
  oauthRedirectUri: () => invoke<string>("oauth_redirect_uri"),
  oauthDeviceStart: (cfg: ProviderCfg) => invoke<DeviceStart>("oauth_device_start", { cfg }),
  oauthDevicePoll: (cfg: ProviderCfg, deviceCode: string) => invoke<SignIn>("oauth_device_poll", { cfg, deviceCode }),
  oauthLogin: (cfg: ProviderCfg) => invoke<SignIn>("oauth_login", { cfg }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
};

export const isMac = navigator.userAgent.includes("Mac");
