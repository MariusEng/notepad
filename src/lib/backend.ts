import { invoke } from "@tauri-apps/api/core";
import type {
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
  bom: boolean;
  mtime: number | null;
}

export const backend = {
  readFile: (path: string) => invoke<FileData>("read_file", { path }),
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
