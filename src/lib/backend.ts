import { invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  DeviceStart,
  DirEntry,
  GitPathInfo,
  NewRepo,
  ProviderCfg,
  RepoCreated,
  RepoInfo,
  SignIn,
  SyncResult,
} from "../git/types";

export interface FileData {
  content: string;
  /** The file started with a byte order mark; written back on save. */
  bom: boolean;
  mtime: number | null;
  /** WHATWG encoding name the text was decoded with. */
  encoding: string;
  /** Some bytes weren't valid in that encoding and were replaced with U+FFFD. */
  lossy: boolean;
  /** Not valid UTF-8 and no BOM: opened as Windows-1252 instead. */
  fallback: boolean;
}

/** Files above this size are refused: the editor keeps the whole text in memory. */
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
/** Files above this size load in the background with a progress bar. */
export const LARGE_FILE_BYTES = 4 * 1024 * 1024;
const CHUNK = 4 * 1024 * 1024;

export const formatSize = (n: number) =>
  n >= 1024 * 1024 * 1024
    ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
    : n >= 1024 * 1024
      ? `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`
      : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Decodes the whole file with one decoder. With `fatal`, invalid bytes throw (TypeError). */
async function decodeFile(
  path: string,
  size: number,
  encoding: string,
  fatal: boolean,
  onProgress?: (loaded: number, total: number) => boolean,
): Promise<string | null> {
  const decoder = new TextDecoder(encoding, { fatal }); // drops a leading BOM of this encoding by itself
  const parts: string[] = [];
  let offset = 0;
  for (;;) {
    const buf = new Uint8Array(await invoke<ArrayBuffer>("read_file_range", { path, offset, len: CHUNK }));
    parts.push(decoder.decode(buf, { stream: true }));
    offset += buf.length;
    if (onProgress && !onProgress(offset, Math.max(size, offset))) return null;
    // A short read is the end (a growing log file just gets read up to where it is now).
    if (buf.length < CHUNK || offset > MAX_FILE_BYTES) break;
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/**
 * Reads a text file in chunks (raw bytes, no JSON). `onProgress` returns false to cancel (resolves to null).
 * `encoding` null = detect: a BOM decides, otherwise UTF-8, or Windows-1252 if the bytes aren't valid UTF-8.
 * A chosen encoding is used as is; bytes that aren't valid in it become U+FFFD (`lossy`).
 */
async function readText(
  path: string,
  onProgress?: (loaded: number, total: number) => boolean,
  encoding: string | null = null,
): Promise<FileData | null> {
  const stat = await invoke<{ size: number; mtime: number | null }>("file_stat", { path });
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`the file is ${formatSize(stat.size)}; Notepad opens files up to ${formatSize(MAX_FILE_BYTES)}`);
  }
  const head = new Uint8Array(await invoke<ArrayBuffer>("read_file_range", { path, offset: 0, len: 3 }));
  const sniffed =
    head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf
      ? "utf-8"
      : head[0] === 0xff && head[1] === 0xfe
        ? "utf-16le"
        : head[0] === 0xfe && head[1] === 0xff
          ? "utf-16be"
          : null;
  const enc = encoding ?? sniffed ?? "utf-8";
  const base = { mtime: stat.mtime, bom: sniffed !== null && sniffed === enc, encoding: enc, lossy: false, fallback: false };
  try {
    const content = await decodeFile(path, stat.size, enc, true, onProgress);
    return content === null ? null : { ...base, content };
  } catch (e) {
    if (!(e instanceof TypeError)) throw e;
  }
  // Invalid bytes. Detecting: a file without BOM that isn't UTF-8 is most likely Windows-1252 (every byte is valid).
  if (encoding === null && sniffed === null) {
    const content = await decodeFile(path, stat.size, "windows-1252", false, onProgress);
    return content === null ? null : { ...base, content, encoding: "windows-1252", fallback: true };
  }
  const content = await decodeFile(path, stat.size, enc, false, onProgress);
  return content === null ? null : { ...base, content, lossy: true };
}

/** A file another program or the command line asked to open (`--preview`: in the preview tab). */
export interface OpenRequest {
  path: string;
  preview: boolean;
}

export const backend = {
  readFile: async (path: string, encoding: string | null = null) => (await readText(path, undefined, encoding))!,
  readText,
  fileSize: async (path: string) => (await invoke<{ size: number }>("file_stat", { path })).size,
  writeFile: (path: string, content: string, bom: boolean, encoding: string) =>
    invoke<number | null>("write_file", { path, content, bom, encoding }),
  fileMtime: (path: string) => invoke<number | null>("file_mtime", { path }),
  loadState: (name: "session" | "settings") => invoke<string | null>("load_state", { name }),
  saveState: (name: "session" | "settings", json: string) => invoke<void>("save_state", { name, json }),
  writeBuffer: (id: string, content: string) => invoke<void>("write_buffer", { id, content }),
  readBuffer: (id: string) => invoke<string | null>("read_buffer", { id }),
  pruneBuffers: (keep: string[]) => invoke<void>("prune_buffers", { keep }),
  takePendingOpen: () => invoke<OpenRequest[]>("take_pending_open"),
  quit: () => invoke<void>("quit_app"),
  /** macOS: puts the `notepad` command in /usr/local/bin (asks for an admin password if needed). Resolves to its path. */
  installCli: () => invoke<string>("install_cli"),
  formatExternal: (tool: "shfmt" | "perltidy" | "pwsh", input: string, indent = 2) =>
    invoke<string>("format_external", { tool, input, indent }),
};

/** Folder browser (any folder, no git needed). */
export const files = {
  listDir: (dir: string) => invoke<DirEntry[]>("fs_list_dir", { dir }),
  /** Creates an empty file / folder in `dir`; resolves to its full path. Fails if the name exists. */
  createFile: (dir: string, name: string) => invoke<string>("fs_create_file", { dir, name }),
  createDir: (dir: string, name: string) => invoke<string>("fs_create_dir", { dir, name }),
  /** Moves a file or folder to the Trash (Recycle Bin). */
  trash: (path: string) => invoke<void>("fs_trash", { path }),
  /** The git repository a path is in, or null (not in one, or ignored). */
  gitInfo: (path: string) => invoke<GitPathInfo | null>("git_path_info", { path }),
};

export const git = {
  open: (path: string) => invoke<RepoInfo>("git_open", { path }),
  info: (root: string) => invoke<RepoInfo>("git_info", { root }),
  listDir: (root: string, rel: string) => invoke<DirEntry[]>("git_list_dir", { root, rel }),
  /** Commits one saved file; resolves to the commit message, or null if there was nothing to commit. */
  commitFile: (root: string, file: string, author: string | null) =>
    invoke<string | null>("git_commit_file", { root, file, author }),
  /** Commits the removal of a deleted file or folder; null if nothing tracked was there. */
  commitRemoval: (root: string, path: string, author: string | null) =>
    invoke<string | null>("git_commit_removal", { root, path, author }),
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

// ---------------------------------------------------------------- SQLite

export interface DbColumn {
  name: string;
  declType: string;
  notNull: boolean;
  /** Position in the primary key (1-based); 0 = not part of it. */
  pk: number;
  default: string | null;
}
export interface DbTable {
  name: string;
  kind: "table" | "view";
  sql: string | null;
  columns: DbColumn[];
}
export interface DbSchema {
  tables: DbTable[];
  readOnly: boolean;
}
/** A cell: null, number, text, an integer too big for a JS number ({int}), or a blob (size + first bytes as hex). */
export type DbValue = null | number | string | { int: string } | { blob: number; hex: string };
export type DbStmtResult =
  | { kind: "rows"; sql: string; columns: string[]; rows: DbValue[][]; truncated: boolean; changes: number }
  | { kind: "done"; sql: string; changes: number };
export interface DbRunResult {
  results: DbStmtResult[];
  /** The statement that failed (the ones before it ran). */
  error: string | null;
  ms: number;
}

/** SQLite databases. Every call opens and closes its own connection (db.rs). */
export const db = {
  /** True if the file is an SQLite database (by its header). */
  probe: (path: string) => invoke<boolean>("db_probe", { path }),
  schema: (path: string) => invoke<DbSchema>("db_schema", { path }),
  run: (path: string, sql: string, maxRows: number, runId: string) =>
    invoke<DbRunResult>("db_run", { path, sql, maxRows, runId }),
  interrupt: (runId: string) => invoke<void>("db_interrupt", { runId }),
  /** Creates an empty database; an existing file there goes to the Trash. */
  create: (path: string) => invoke<void>("db_create", { path }),
  /** Writes a compact copy (VACUUM INTO); an existing file at `dest` goes to the Trash. */
  copy: (path: string, dest: string) => invoke<void>("db_copy", { path, dest }),
};
