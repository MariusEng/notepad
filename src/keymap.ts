import { isMac } from "./lib/backend";
import { useTabs } from "./tabs/store";

/**
 * Tab-switching shortcuts. Everything else (New, Open, Save, Close, Find, Format, Toggle Source)
 * is a native menu accelerator, see src-tauri/src/lib.rs.
 *
 * Note: Cmd+Tab (macOS) and Alt+Tab (Windows/Linux) belong to the OS app switcher
 * and never reach the app, so Ctrl+Tab is used on every platform.
 */
export function installKeymap() {
  const handler = (e: KeyboardEvent) => {
    const { cycle, activateIndex } = useTabs.getState();
    const mod = isMac ? e.metaKey : e.ctrlKey;
    let handled = true;

    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") {
      cycle(e.shiftKey ? -1 : 1); // Ctrl+Tab / Ctrl+Shift+Tab
    } else if (mod && e.shiftKey && !e.altKey && (e.code === "BracketRight" || e.code === "BracketLeft")) {
      cycle(e.code === "BracketRight" ? 1 : -1); // ⌘⇧] / ⌘⇧[
    } else if (mod && e.altKey && !e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      cycle(e.key === "ArrowRight" ? 1 : -1); // ⌘⌥→ / ⌘⌥←
    } else if (!isMac && e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "PageDown" || e.key === "PageUp")) {
      cycle(e.key === "PageDown" ? 1 : -1); // Ctrl+PgDn / Ctrl+PgUp (Windows/Linux convention)
    } else if (mod && !e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
      const n = Number(e.code.slice(5));
      activateIndex(n === 9 ? -1 : n - 1); // ⌘1…⌘8 jump to tab, ⌘9 = last tab
    } else {
      handled = false;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  // Capture phase, so the editors never see these keys.
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}
