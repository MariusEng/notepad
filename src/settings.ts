import { create } from "zustand";
import { backend } from "./lib/backend";
import { setThemePref, type ThemePref } from "./theme/theme";
import type { Account } from "./git/types";

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
  /** Git accounts (the secrets are in the OS keychain, not here). */
  accounts: Account[];
}

type GitPrefs = Pick<SettingsData, "sidebar" | "autoCommit" | "repoRoot" | "accounts">;

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
        accounts: s.accounts,
      }),
    )
    .catch(() => {});

export const useSettings = create<Settings>((set, get) => ({
  theme: "system",
  formatBar: true,
  sidebar: true,
  autoCommit: true,
  repoRoot: null,
  accounts: [],
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
      accounts: Array.isArray(data.accounts) ? data.accounts : [],
    });
    useSettings.getState().setTheme(data.theme ?? "system");
  } catch {
    /* defaults */
  }
}
