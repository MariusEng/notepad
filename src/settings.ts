import { create } from "zustand";
import { backend } from "./lib/backend";
import { setThemePref, type ThemePref } from "./theme/theme";
import type { Account } from "./git/types";
import type { MacroStep } from "./editors/macroBus";

interface SettingsData {
  theme: ThemePref;
  /** Fixed formatting bar under the tabs (greyed out unless a Markdown document is in formatted view). */
  formatBar: boolean;
  /** File tree of the open git repository. */
  sidebar: boolean;
  /** Saving a file in the open repository commits and pushes it. */
  autoCommit: boolean;
  /** The repository to reopen on launch. */
  repoRoot: string | null;
  /** The folder shown in the sidebar's folder browser (reopened on launch). */
  folderRoot: string | null;
  /** Share of the sidebar height used by the repository when both it and a folder are shown (0.15–0.85). */
  sidebarSplit: number;
  /** Git accounts (the secrets are in the OS keychain, not here). */
  accounts: Account[];
  /** Look for a new version at launch and once a day (updates.tsx). */
  autoUpdates: boolean;
  /** The last recorded macro (Edit → Macro → Play) and the ones saved with a name (editors/macro.tsx). */
  lastMacro: MacroStep[] | null;
  macros: { name: string; steps: MacroStep[] }[];
}

type GitPrefs = Pick<SettingsData, "sidebar" | "autoCommit" | "repoRoot" | "folderRoot" | "sidebarSplit" | "accounts" | "autoUpdates" | "lastMacro" | "macros">;

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
        repoRoot: s.repoRoot,
        folderRoot: s.folderRoot,
        sidebarSplit: s.sidebarSplit,
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
  repoRoot: null,
  folderRoot: null,
  sidebarSplit: 0.5,
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
    const data: Partial<GitPrefs> & { theme?: ThemePref; showFormatBar?: boolean } = raw ? JSON.parse(raw) : {};
    useSettings.setState({
      formatBar: data.showFormatBar ?? true,
      sidebar: data.sidebar ?? true,
      autoCommit: data.autoCommit ?? true,
      repoRoot: data.repoRoot ?? null,
      folderRoot: data.folderRoot ?? null,
      sidebarSplit: typeof data.sidebarSplit === "number" ? data.sidebarSplit : 0.5,
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
