import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePref = "system" | "light" | "dark";

const media = window.matchMedia("(prefers-color-scheme: dark)");
let current: ThemePref = "system";
const listeners = new Set<(resolved: "light" | "dark") => void>();

function readCachedPref(): ThemePref {
  try {
    const v = localStorage.getItem("theme-pref");
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

export function resolvedTheme(): "light" | "dark" {
  if (current === "system") return media.matches ? "dark" : "light";
  return current;
}

function paint() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  listeners.forEach((fn) => fn(t));
}

export function getThemePref(): ThemePref {
  return current;
}

/** Applies a preference to the page and to the native window chrome (title bar, menus). */
export function setThemePref(pref: ThemePref) {
  current = pref;
  try {
    // Cached for the inline script in index.html, which runs before any JS module.
    localStorage.setItem("theme-pref", pref);
  } catch {
    /* ignore */
  }
  paint();
  // null = follow the OS.
  getCurrentWindow()
    .setTheme(pref === "system" ? null : pref)
    .catch(() => {});
}

export function onThemeChange(fn: (resolved: "light" | "dark") => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme(pref?: ThemePref) {
  current = pref ?? readCachedPref();
  // Live-follow OS changes (macOS Auto appearance, GNOME/KDE colour scheme, Windows).
  media.addEventListener("change", () => {
    if (current === "system") paint();
  });
  setThemePref(current);
}
