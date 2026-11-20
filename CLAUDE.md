# Notepad: project notes for Claude

Cross-platform notepad app. Tauri 2 (Rust) + React 19 + TypeScript + Vite. Markdown is the default
document type, edited in a formatted (WYSIWYG) editor and saved as plain `.md`. See README.md for
the features, shortcuts and file layout.

## User's requirements and decisions
- Minimal, modern UI with as little "stuff" as possible. Keep chrome quiet; don't add visible controls
  without a reason. The Markdown formatting bar sits under the tabs (`FormatBar.tsx`, hideable in
  the View menu) and is greyed out for non-Markdown files and Markdown source view; the floating
  selection toolbar and `/` menu also stay. Markdown has minimal padding (full width, 14px), like
  the code editor, so the block drag handle is hidden.
- Cmd+N creates a new `.md` tab; Cmd+Shift+N (`TypePicker.tsx`) asks for the type first. Right-click on a
  tab → File Type changes it (untitled tabs also get the new extension). Files are saved as real Markdown, never as rich text.
- Highlighting and formatting for: txt, PowerShell, Perl, sh, cmd/bat, INI, YAML, JSON, SQL (ANSI, PostgreSQL, T-SQL), Markdown.
- Hot exit: closing the app never prompts; tabs and unsaved edits are restored on launch.
- Tab switching is Ctrl+Tab on all platforms. The user asked for Cmd+Tab, but macOS reserves it for
  the app switcher and the app can't receive it; the user was told this.
- Light/dark theme follows the OS, with a manual override under View → Theme.
- Git: remote is git.1011.no (Forgejo), **always push over HTTPS**. Commit and push after each
  major change. Commit messages end with a Co-Authored-By line for Claude.
- **Bump the version with every change** (semver): minor (0.x.0) for new features or a batch of
  noticeable changes, major for big/breaking overhauls, patch (0.0.x) only for small fixes.
  Keep these in sync: `package.json`, `package-lock.json` (top two entries),
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (the `notepad` entry).
  Put the bump in the same commit as the change.

## Architecture in brief
- `src-tauri/src/lib.rs`: all Rust. File I/O (keeps BOM and permissions), `session.json` /
  `settings.json` / `buffers/*.txt` in the app-data dir, native menu (accelerators emit a `menu`
  event with the item id), quit flow (`ExitRequested` → frontend saves → `quit_app`), macOS
  file-open events, external formatters (fixed allow-list: shfmt, perltidy, pwsh). SQL is formatted in-process
  with sql-formatter.
- `src/main.tsx`: startup order (settings → keymap/listeners → restore session → render → show
  window) and the menu-id → action map.
- `src/actions.ts`: every user action (new/open/save/close/format/reload…).
- Editors are uncontrolled and remounted by `key` (`tab.id:version:…`). Bump `version` via
  `replaceContent` when text changes outside the editor.
- Milkdown re-serialises Markdown on load; `MarkdownEditor` compares against a baseline so opening a
  file doesn't mark it dirty. Keep that behaviour.
- All colours are CSS variables in `src/theme/tokens.css`; CodeMirror and Crepe both read them.

## Gotchas found so far
- The window starts hidden (`visible: false`) to avoid a theme flash. Never show it from
  `requestAnimationFrame`: WebKit doesn't run animation frames in hidden windows, so it stays
  invisible. There is also a 3 s Rust fallback that shows it.
- AppleScript `quit` doesn't reach the unbundled dev binary. To test the quit/session flow in
  dev, temporarily add a setup hook that emits `menu` → `quit` (don't commit it).
- Don't take full-screen screenshots to check the UI: they capture the user's whole desktop. Ask the
  user to look instead.
- macOS GUI apps don't inherit the shell PATH; `tool_path()` in lib.rs adds Homebrew paths for
  formatters.

## Commands
```sh
npm run tauri dev                      # dev with hot reload
npm run typecheck
cd src-tauri && cargo test
npx tauri build --bundles app,dmg      # release → src-tauri/target/release/bundle/
```
The user installs by copying `Notepad.app` to /Applications. Quit the running copy before
replacing it.

## Status (2026-11-20, version 0.2.0)
Latest (0.2.0): new file of type (⇧⌘N) and tab right-click File Type; tight Markdown padding, formatting bar under the tabs, SQL support (typechecked and built;
not yet checked by eye).

Done and pushed: scaffold, tabs, CodeMirror with all languages (custom batch mode), Milkdown
formatted Markdown with source toggle, minimal UI, hot exit/session restore, external-change
detection, Format Document, window-state restore, README, release build fix.

Verified: release build runs and shows its window; quit → session saved → restore works (tested
with seeded session files); formatters tested in Node; Rust unit tests pass.

Not yet verified by eye: overall look, Ctrl+Tab in WKWebView, Crepe dark-mode details,
narrow-window layout. The user is reviewing the UI.

## Possible next steps
- Fix whatever the user reports from using the app.
- Code signing and notarisation for macOS; Windows/Linux builds (e.g. Forgejo Actions).
- Single-instance handling (opening a file while the app is running in another instance).
- Relative image paths in Markdown (needs Tauri's asset protocol).
- Find inside the formatted Markdown view (currently ⌘F switches to source).
- Recent files list.
