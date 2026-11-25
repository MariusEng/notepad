import { create } from "zustand";
import { backend } from "./lib/backend";
import { setThemePref, type ThemePref } from "./theme/theme";
import type { Account } from "./git/types";
import type { MacroStep } from "./editors/macroBus";

/** Default sidebar width (px). */
export const SIDEBAR_WIDTH = 220;

interface SettingsData {
  theme: ThemePref;
  /** Fixed formatting bar under the tabs (greyed out unless a Markdown document is in formatted view). */
  formatBar: boolean;
  /** File tree of the open git repository. */
  sidebar: boolean;
  /** Saving a file in the open repository commits and pushes it. */
  autoCommit: boolean;
  /** The repositories in the sidebar (reopened on launch). */
  repos: string[];
  /** The folders in the sidebar, below the repositories (reopened on launch). */
  folders: string[];
  /** Collapsed sidebar sections ("repo:<root>" / "folder:<root>"). */
  collapsed: string[];
  /** Sidebar width in pixels. */
  sidebarWidth: number;
  /** Git accounts (the secrets are in the OS keychain, not here). */
  accounts: Account[];
  /** Look for a new version at launch and once a day (updates.tsx). */
  autoUpdates: boolean;
  /** The last recorded macro (Edit → Macro → Play) and the ones saved with a name (editors/macro.tsx). */
  lastMacro: MacroStep[] | null;
  macros: { name: string; steps: MacroStep[] }[];
}

type GitPrefs = Pick<SettingsData, "sidebar" | "autoCommit" | "repos" | "folders" | "collapsed" | "sidebarWidth" | "accounts" | "autoUpdates" | "lastMacro" | "macros">;

interface Settings extends SettingsData {
  setTheme: (t: ThemePref) => void;
  toggleFormatBar: () => void;
  update: (patch: Partial<GitPrefs>) => void;
}

const persist = (s: SettingsData) =>
  backend
    .saveState(
      "settings",
      JSON.stringify({
        theme: s.theme,
        showFormatBar: s.formatBar,
        sidebar: s.sidebar,
        autoCommit: s.autoCommit,
        repos: s.repos,
        folders: s.folders,
        collapsed: s.collapsed,
        sidebarWidth: s.sidebarWidth,
        accounts: s.accounts,
        autoUpdates: s.autoUpdates,
        lastMacro: s.lastMacro,
        macros: s.macros,
      }),
    )
    .catch(() => {});

export const useSettings = create<Settings>((set, get) => ({
  theme: "system",
  formatBar: true,
  sidebar: true,
  autoCommit: true,
  repos: [],
  folders: [],
  collapsed: [],
  sidebarWidth: SIDEBAR_WIDTH,
  accounts: [],
  autoUpdates: true,
  lastMacro: null,
  macros: [],
  setTheme: (theme) => {
    set({ theme });
    setThemePref(theme);
    persist(get());
  },
  toggleFormatBar: () => {
    set({ formatBar: !get().formatBar });
    persist(get());
  },
  update: (patch) => {
    set(patch);
    persist(get());
  },
}));

export async function loadSettings() {
  try {
    const raw = await backend.loadState("settings");
    const data: Partial<GitPrefs> & { theme?: ThemePref; showFormatBar?: boolean; repoRoot?: string | null; folderRoot?: string | null } = raw ? JSON.parse(raw) : {};
    useSettings.setState({
      formatBar: data.showFormatBar ?? true,
      sidebar: data.sidebar ?? true,
      autoCommit: data.autoCommit ?? true,
      // Before 0.21.0 there was one of each (repoRoot, folderRoot).
      repos: Array.isArray(data.repos) ? data.repos : data.repoRoot ? [data.repoRoot] : [],
      folders: Array.isArray(data.folders) ? data.folders : data.folderRoot ? [data.folderRoot] : [],
      collapsed: Array.isArray(data.collapsed) ? data.collapsed : [],
      sidebarWidth: typeof data.sidebarWidth === "number" ? data.sidebarWidth : SIDEBAR_WIDTH,
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
      autoUpdates: data.autoUpdates ?? true,
      lastMacro: Array.isArray(data.lastMacro) ? data.lastMacro : null,
      macros: Array.isArray(data.macros) ? data.macros : [],
    });
    useSettings.getState().setTheme(data.theme ?? "system");
  } catch {
    /* defaults */
  }
}
