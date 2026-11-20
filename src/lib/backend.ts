import { invoke } from "@tauri-apps/api/core";

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

export const isMac = navigator.userAgent.includes("Mac");
