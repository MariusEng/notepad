/**
 * The managed edition: built with VITE_NOTEPAD_MANAGED=1 and the config overlay src-tauri/tauri.managed.conf.json
 * (own app id, per-machine Windows installer, no update endpoint). The organisation installs and updates it (e.g.
 * through Company Portal), so the app never looks for updates itself.
 */
export const MANAGED = import.meta.env.VITE_NOTEPAD_MANAGED === "1";
