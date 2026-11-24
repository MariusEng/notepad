import { create } from "zustand";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "./settings";
import { MANAGED } from "./edition";

/**
 * Updates: Help → Check for Updates…, and (unless turned off) a quiet check at launch and once a day. The app reads
 * latest.json from the newest GitHub release (tauri.conf.json → plugins.updater), checks the signature of the
 * download against the public key in tauri.conf.json, installs it and restarts. The session is saved first (hot exit),
 * so tabs and unsaved edits come back.
 *
 * macOS: an update downloaded by the app itself has no quarantine mark, so it opens without the "unverified
 * developer" prompt that a browser download gets.
 */

/** A newer version (Rust `update_check`, src-tauri/src/update.rs). */
interface UpdateInfo {
  version: string;
  currentVersion: string;
  body: string | null;
}

interface UpdateState {
  /** A newer version that was found (the dialog or the status bar button offers it). */
  update: UpdateInfo | null;
  current: string;
  /** "found": offer the update; "none": up to date; "error": the check failed; "managed": the organisation updates
   *  this edition (edition.ts). */
  dialog: null | "found" | "none" | "error" | "managed";
  error: string;
  /** While downloading: bytes so far and total (0 when the server doesn't say). */
  progress: { done: number; total: number } | null;
  installing: boolean;
}

export const useUpdates = create<UpdateState>(() => ({
  update: null,
  current: "",
  dialog: null,
  error: "",
  progress: null,
  installing: false,
}));

const set = useUpdates.setState;
let checking = false;

/** `manual`: from the Help menu, so the result is always shown; an automatic check only lights up the status bar. */
export async function checkForUpdates(manual: boolean) {
  if (MANAGED) {
    if (manual) set({ dialog: "managed" });
    return;
  }
  if (checking) return;
  checking = true;
  try {
    const [update, current] = await Promise.all([invoke<UpdateInfo | null>("update_check"), getVersion()]);
    set({ update, current });
    if (manual) set({ dialog: update ? "found" : "none" });
  } catch (e) {
    if (manual) set({ dialog: "error", error: String(e) });
    else console.warn("update check failed", e);
  } finally {
    checking = false;
  }
}

const DAY = 24 * 60 * 60 * 1000;

/** Launch: check after a short while (not during startup), then once a day while the app runs. */
export function startAutoUpdates() {
  if (MANAGED) return;
  const auto = () => useSettings.getState().autoUpdates && void checkForUpdates(false);
  setTimeout(auto, 15_000);
  setInterval(auto, DAY);
}

export const openUpdateDialog = () => set({ dialog: MANAGED ? "managed" : useUpdates.getState().update ? "found" : "none" });
const close = () => set({ dialog: null, error: "" });

async function install() {
  const { update } = useUpdates.getState();
  if (!update) return;
  set({ installing: true, progress: { done: 0, total: 0 }, error: "" });
  try {
    // Hot exit: everything is in session.json and buffers/ before the app is replaced (Windows' installer closes
    // the app right after the download).
    const { saveSessionNow } = await import("./session/session");
    await saveSessionNow();
    // Rust downloads, verifies, installs (on macOS inside the same Notepad.app, so a pinned Dock icon stays) and
    // restarts the app; progress arrives as events.
    const stop = await listen<{ done: number; total: number }>("update-progress", (e) => set({ progress: e.payload }));
    try {
      await invoke("update_install");
    } finally {
      stop();
    }
  } catch (e) {
    set({ installing: false, progress: null, dialog: "error", error: `The update couldn't be installed: ${e}` });
  }
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Help → Check for Updates… and the status bar button. */
export function UpdateDialog() {
  const { dialog, update, current, error, progress, installing } = useUpdates();
  const auto = useSettings((s) => s.autoUpdates);
  if (!dialog) return null;
  const autoBox = (
    <label className="check">
      <input type="checkbox" checked={auto} onChange={(e) => useSettings.getState().update({ autoUpdates: e.target.checked })} />
      Check for updates automatically
    </label>
  );
  return (
    <div className="picker-backdrop" onMouseDown={installing ? undefined : close}>
      <div
        className="dialog"
        role="dialog"
        aria-label="Software update"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !installing && close()}
      >
        {dialog === "found" && update ? (
          <>
            <h2>Notepad {update.version} is available</h2>
            <p className="note">
              You have {current || update.currentVersion}. Installing restarts Notepad; your tabs and unsaved changes come back.
            </p>
            {update.body && <div className="update-notes">{update.body}</div>}
            {autoBox}
            {progress && (
              <p className="note" role="status">
                {progress.total ? `Downloading… ${mb(progress.done)} of ${mb(progress.total)}` : `Downloading… ${mb(progress.done)}`}
              </p>
            )}
            <div className="dialog-actions">
              <span className="sb-spacer" />
              <button className="btn" disabled={installing} onClick={close}>
                Later
              </button>
              <button className="btn primary" disabled={installing} onClick={() => void install()} autoFocus>
                {installing ? "Installing…" : "Install and Restart"}
              </button>
            </div>
          </>
        ) : dialog === "managed" ? (
          <>
            <h2>Updates are managed by your organisation</h2>
            <p className="note">New versions of Notepad come from your organisation (for example through Company Portal), not from Notepad itself.</p>
            <div className="dialog-actions">
              <span className="sb-spacer" />
              <button className="btn primary" onClick={close} autoFocus>
                OK
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>{dialog === "none" ? "Notepad is up to date" : "Software update"}</h2>
            {dialog === "none" ? (
              <p className="note">You have the newest version{current ? ` (${current})` : ""}.</p>
            ) : (
              <p className="error">{error || "The check for updates failed."}</p>
            )}
            {autoBox}
            <div className="dialog-actions">
              <span className="sb-spacer" />
              <button className="btn primary" onClick={close} autoFocus>
                OK
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Status bar: shown only while a newer version is waiting. */
export function UpdateStatus() {
  const update = useUpdates((s) => s.update);
  if (!update) return null;
  return (
    <button className="sb-item sb-btn sb-update" title={`Notepad ${update.version} is available: click to install`} onClick={openUpdateDialog}>
      Update to {update.version}
    </button>
  );
}
