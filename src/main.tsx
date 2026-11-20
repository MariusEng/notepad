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
import {
  closeTab,
  formatActive,
  newTab,
  openFiles,
  openHelp,
  saveTab,
  showEncodingMenu,
  toggleSource,
} from "./actions";
import { openAbout } from "./About";
import { openSaveAsPicker, openTypePicker } from "./TypePicker";
import {
  openDialog,
  openRepoFolder,
  restoreRepo,
  showBranchMenu,
  syncNow,
  syncOnFocus,
  toggleAutoCommit,
  toggleSidebar,
} from "./git/actions";
import { activeEditor } from "./editors/handle";
import { backend } from "./lib/backend";
import { useTabs } from "./tabs/store";
import {
  checkExternalChanges,
  loadRestoredBigFiles,
  restoreSession,
  saveSessionNow,
  startSessionAutosave,
} from "./session/session";

initTheme(); // from the localStorage cache, before first render

/** Hot exit: no "save changes?" prompts, everything is restored on next launch. */
async function quit() {
  await saveSessionNow();
  await backend.quit();
}

const MENU: Record<string, () => unknown> = {
  new: () => newTab(),
  new_of_type: openTypePicker,
  open: () => openFiles(),
  save: () => saveTab(),
  save_as: () => openSaveAsPicker(),
  close_tab: () => closeTab(),
  quit,
  find: () => activeEditor()?.find(),
  find_replace: () => activeEditor()?.find(true),
  find_next: () => activeEditor()?.findNext?.(1),
  find_prev: () => activeEditor()?.findNext?.(-1),
  find_selection: () => activeEditor()?.useSelectionForFind?.(),
  select_column: () => {
    const ed = activeEditor();
    if (!ed?.selectColumn?.()) useTabs.getState().notify("Select Column works in CSV and log files (with columns).");
  },
  format: formatActive,
  open_repo: openRepoFolder,
  new_repo: () => openDialog({ kind: "newRepo" }),
  clone_repo: () => openDialog({ kind: "clone" }),
  git_accounts: () => openDialog({ kind: "accounts" }),
  sync_repo: () => syncNow(),
  switch_branch: () => showBranchMenu(),
  new_branch: () => openDialog({ kind: "newBranch" }),
  help: openHelp,
  encoding: () => showEncodingMenu(),
  about: openAbout,
  toggle_sidebar: toggleSidebar,
  toggle_autocommit: toggleAutoCommit,
  close_split: () => useTabs.getState().closeSplit(),
  toggle_source: () => toggleSource(),
  next_tab: () => useTabs.getState().cycle(1),
  prev_tab: () => useTabs.getState().cycle(-1),
  theme_system: () => useSettings.getState().setTheme("system"),
  theme_light: () => useSettings.getState().setTheme("light"),
  theme_dark: () => useSettings.getState().setTheme("dark"),
  toggle_format_bar: () => useSettings.getState().toggleFormatBar(),
};

async function start() {
  await loadSettings();

  installKeymap();
  listen<string>("menu", (e) => MENU[e.payload]?.());

  // Files opened from Finder/Explorer, the command line, or dropped onto the window.
  listen("open-files", async () => openFiles(await backend.takePendingOpen()));
  getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type === "drop") openFiles(e.payload.paths);
  });

  await restoreSession();
  startSessionAutosave();
  void restoreRepo();

  const win = getCurrentWindow();
  // Closing the window quits the app; save the session first (the handler is awaited).
  win.onCloseRequested(async () => {
    await saveSessionNow();
  });
  // Pick up edits made by other programs when you come back to the app.
  win.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      checkExternalChanges();
      syncOnFocus();
    }
  });

  const pending = await backend.takePendingOpen();
  if (pending.length) await openFiles(pending);
  if (useTabs.getState().tabs.length === 0) newTab();

  createRoot(document.getElementById("root")!).render(<App />);
  loadRestoredBigFiles();
}

// The window starts hidden (tauri.conf.json) so it never shows unthemed content.
// Show it directly once started (not via requestAnimationFrame: WebKit doesn't run
// animation frames for hidden windows), and also if startup fails part-way.
start()
  .catch((e) => console.error("startup failed", e))
  .finally(() => {
    getCurrentWindow().show().catch(() => {});
    getCurrentWindow().setFocus().catch(() => {});
  });
