import { create } from "zustand";
import { backend } from "./lib/backend";
import { setThemePref, type ThemePref } from "./theme/theme";

interface Settings {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
}

export const useSettings = create<Settings>((set, get) => ({
  theme: "system",
  setTheme: (theme) => {
    set({ theme });
    setThemePref(theme);
    backend.saveState("settings", JSON.stringify({ theme: get().theme })).catch(() => {});
  },
}));

export async function loadSettings(): Promise<{ theme?: ThemePref }> {
  try {
    const raw = await backend.loadState("settings");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
