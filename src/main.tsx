import { createRoot } from "react-dom/client";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import "./theme/tokens.css";
import "./styles.css";
import { App } from "./App";
import { initTheme } from "./theme/theme";
import { loadSettings, useSettings } from "./settings";
import { installKeymap } from "./keymap";
import { closeTab, newTab, openFiles, saveTab, saveTabAs, toggleMarkdownSource } from "./actions";
import { activeEditor } from "./editors/handle";
import { backend } from "./lib/backend";
import { useTabs } from "./tabs/store";
import type { ThemePref } from "./theme/theme";

initTheme(); // from the localStorage cache, before first render

async function quit() {
  await backend.quit();
}

const MENU: Record<string, () => unknown> = {
  new: newTab,
  open: () => openFiles(),
  save: () => saveTab(),
  save_as: () => saveTabAs(),
  close_tab: () => closeTab(),
  quit,
  find: () => activeEditor()?.find(),
  toggle_source: () => toggleMarkdownSource(),
  next_tab: () => useTabs.getState().cycle(1),
  prev_tab: () => useTabs.getState().cycle(-1),
  theme_system: () => useSettings.getState().setTheme("system"),
  theme_light: () => useSettings.getState().setTheme("light"),
  theme_dark: () => useSettings.getState().setTheme("dark"),
};

async function start() {
  const settings = await loadSettings();
  if (settings.theme) useSettings.getState().setTheme(settings.theme as ThemePref);
  else useSettings.setState({ theme: "system" });

  installKeymap();
  listen<string>("menu", (e) => MENU[e.payload]?.());

  // Files opened from Finder/Explorer, the command line, or dropped onto the window.
  listen("open-files", async () => openFiles(await backend.takePendingOpen()));
  getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type === "drop") openFiles(e.payload.paths);
  });

  const pending = await backend.takePendingOpen();
  if (pending.length) await openFiles(pending);
  if (useTabs.getState().tabs.length === 0) newTab();

  createRoot(document.getElementById("root")!).render(<App />);
  // The window starts hidden (tauri.conf.json) so it never shows unthemed content.
  requestAnimationFrame(() => getCurrentWindow().show());
}

start();
