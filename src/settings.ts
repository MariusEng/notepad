import { create } from "zustand";
import { backend } from "./lib/backend";
import { setThemePref, type ThemePref } from "./theme/theme";

interface SettingsData {
  theme: ThemePref;
  /** Fixed formatting bar above Markdown documents (off = floating toolbar on selection only). */
  formatBar: boolean;
}

interface Settings extends SettingsData {
  setTheme: (t: ThemePref) => void;
  toggleFormatBar: () => void;
}

const persist = (s: SettingsData) =>
  backend.saveState("settings", JSON.stringify({ theme: s.theme, formatBar: s.formatBar })).catch(() => {});

export const useSettings = create<Settings>((set, get) => ({
  theme: "system",
  formatBar: false,
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
    const data: Partial<SettingsData> = raw ? JSON.parse(raw) : {};
    useSettings.setState({ formatBar: !!data.formatBar });
    useSettings.getState().setTheme(data.theme ?? "system");
  } catch {
    /* defaults */
  }
}
