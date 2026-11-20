import { create } from "zustand";
import { backend } from "./lib/backend";
import { setThemePref, type ThemePref } from "./theme/theme";

interface SettingsData {
  theme: ThemePref;
  /** Fixed formatting bar under the tabs (greyed out unless a Markdown document is in formatted view). */
  formatBar: boolean;
}

interface Settings extends SettingsData {
  setTheme: (t: ThemePref) => void;
  toggleFormatBar: () => void;
}

const persist = (s: SettingsData) =>
  backend.saveState("settings", JSON.stringify({ theme: s.theme, showFormatBar: s.formatBar })).catch(() => {});

export const useSettings = create<Settings>((set, get) => ({
  theme: "system",
  formatBar: true,
  setTheme: (theme) => {
    set({ theme });
    setThemePref(theme);
    persist(get());
  },
  toggleFormatBar: () => {
    set({ formatBar: !get().formatBar });
    persist(get());
  },
}));

export async function loadSettings() {
  try {
    const raw = await backend.loadState("settings");
    const data: { theme?: ThemePref; showFormatBar?: boolean } = raw ? JSON.parse(raw) : {};
    useSettings.setState({ formatBar: data.showFormatBar ?? true });
    useSettings.getState().setTheme(data.theme ?? "system");
  } catch {
    /* defaults */
  }
}
