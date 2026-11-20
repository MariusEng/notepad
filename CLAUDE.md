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
- Highlighting and formatting for: txt, PowerShell, Perl, sh, cmd/bat, INI, YAML, JSON, SQL (ANSI, PostgreSQL, T-SQL), Markdown,
  JavaScript, HTML (preview ⇄ source with ⌘/, like Markdown), CSV and log (each column keeps its own colour).
- Really large files: never freeze; stream in with progress in the tab. Tabs can be dragged; split-view pairs stay
  together. Git supports branches (repos that refuse pushes to main/master). The repo sidebar can be hidden.
- Column (block) selection with the standard keys: Option/Alt+drag; ⇧⌥⌘+arrows on macOS, Shift+Alt+arrows
  (and Ctrl+Shift+Alt+arrows) on Windows/Linux (`editors/blockSelect.ts`; overrides CodeMirror's Shift+Alt+↑/↓
  copy-line on Windows/Linux).
- Encodings: UTF-8 by default; BOM sniffing (UTF-8/UTF-16); invalid UTF-8 without BOM falls back to Windows-1252
  with a notice. File → Encoding… / tab menu / status bar: Reopen with Encoding, Save with Encoding, UTF-8 BOM.
  Decoding in the frontend (TextDecoder, chunked), encoding in Rust (`encode_text`, encoding_rs; UTF-16 by hand;
  unmappable characters are refused, never replaced). `tab.encoding` is persisted; `tab.lossy` asks before saving.
- Find and replace (`editors/FindPanel.tsx`, CodeMirror `search({createPanel})` with a React panel): OS-default
  shortcuts via the native Edit → Find submenu (macOS ⌘F ⌥⌘F ⌘G ⇧⌘G ⌘E; Win/Linux Ctrl+F Ctrl+H F3 Shift+F3), match
  count, case/word/regex, find-in-selection scope (StateField, auto-on for multi-line/multi-range selections).
- CSV/log "Select Column" (`selectColumn` in columns.ts, `columnInfo` facet): Ctrl+Space (Excel) / Alt+double-click;
  whole column, several columns, or part of a column (selected lines); one range per line, capped at 200k lines.
- Save As… shows the type picker first (TypePicker `saveAs` mode), then the native dialog: macOS's save panel
  (rfd) has no file-type popup. HTML status bar button names the action: "Preview" in source, "Source" in preview.
- Help → Notepad Help (`src/help.md`, opens in a tab) and an About dialog listing open source components and that
  the app is built with Claude. Keep both up to date when features or dependencies change.
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

- Split view: `mainId` (left pane), `splitId` (right pane, null = no split) and `activeId` (focused pane's
  tab) in the tab store; invariant: activeId is mainId or splitId, and a tab is never in both panes.
  Editors register per tab id in `editors/handle.ts` (`activeEditor()` = the focused one); only the
  focused pane's editor autofocuses or reports to the status bar. The session saves mainId/splitId.

- Git (0.4.0): all Rust, no `git` binary. `gitops.rs` (libgit2; HTTPS only), `creds.rs` (app keychain via the
  `keyring` crate, then git2's credential-helper support = Git Credential Manager/osxkeychain), `oauth.rs`
  (device flow + PKCE loopback on 127.0.0.1:51789; the user registers their own OAuth app, no client id is built in),
  `provider.rs` (GitHub, GitLab, Forgejo/Gitea, Bitbucket, Azure DevOps), `git_cmds.rs` (Tauri commands; these
  modules have no Tauri dependency apart from the wrappers). Errors starting with `AUTH_REQUIRED:<host>` mean
  "ask for credentials". Frontend in `src/git/` (store, actions, Sidebar, Dialogs); the save path calls
  `git/actions.afterSave`. Saving auto-commits ONLY the saved file (in-memory index, other staged files untouched).
  Sync = fetch, fast-forward or in-memory merge (conflicts are never applied; local commits stay), push.
  Jobs run one at a time (queue). Settings keep accounts (no secrets), sidebar, autoCommit and repoRoot.
  `cargo test` (src-tauri) runs `git_tests.rs`: libgit2 against a local bare repo, plus providers/OAuth against a
  mock HTTP server. NOT verified against real providers: OAuth for Forgejo/Bitbucket/Azure, Azure Bearer-header git
  auth, Bitbucket app-password flows, and helper lookups on macOS/Windows.

- Big files (0.6.0): `backend.readText` reads in 16 MB raw-byte chunks (`file_stat` + `read_file_range`, no JSON);
  files > 4 MB open as a placeholder tab with `loading` progress (`actions.loadFileInto`), also on session restore
  and external reload. Cap 512 MB (whole text is in memory: CodeMirror + store). CodeEditor copies big docs
  (> 2 M chars) into the store only when typing pauses; call `flushEdits()` (editors/handle.ts) before reading
  `tab.content` (save, format, session write, toggles). Markdown > 1 MB opens in source view.
- Tab order: the split pair (mainId, splitId) is kept adjacent by `pairUp` in tabs/store.ts; the tab bar drags
  groups with pointer events (HTML5 DnD doesn't work while `dragDropEnabled` is on).
- CSV/log colouring (`editors/languages/columns.ts`) decorates only visible lines; `LanguageInfo.load(doc)` gets
  the initial text so it can detect the CSV delimiter / log columns. Colours are `--col-0..7`, `--log-*` tokens.
- Git branches: `list_branches`, `switch_branch` (safe checkout, refuses to overwrite local changes),
  `create_branch`, `move_to_new_branch` in gitops.rs. Sync fetches all branches (with prune). A refused push
  returns `PUSH_REJECTED:<branch>:<reason>` → dialog offering to move the commits to a new branch + pull request
  link (`pullRequestUrl` in git/types.ts; per-provider URL formats are untested against real servers).

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

## Status (2026-11-20, version 0.8.0)
Latest (0.8.0): find and replace panel (OS shortcuts, find in selection), CSV/log Select Column, Save As picks the type, HTML Preview/Source button. 0.7.0: column selection (mouse + keyboard), file encodings (open/reopen/save, BOM), help updated. 0.6.0: tab drag reordering with split pairs grouped, git branches (switch/create/remote, protected-branch → move to new branch + pull request), hideable sidebar, JavaScript + HTML (preview/source), CSV + log column colours, big-file streaming with progress, Help and About. None of 0.6.0 is checked by eye yet. 0.5.1: GitHub.com one-click device-code sign-in with the GitHub CLI public client id; 0.5.0: one-click browser sign-in for Forgejo/Gitea (built-in client id; the others need Notepad's own OAuth app ids filled into BUILTIN_OAUTH in src/git/types.ts); 0.4.0: git repositories (sidebar, commit+push on save, accounts via PAT/OAuth, create private repo, clone); 0.3.0: split view (two panes, right-click a tab → Open to the Right); 0.2.0: new file of type (⇧⌘N) and tab right-click File Type; tight Markdown padding, formatting bar under the tabs, SQL support (typechecked and built;
not yet checked by eye).

Done and pushed: scaffold, tabs, CodeMirror with all languages (custom batch mode), Milkdown
formatted Markdown with source toggle, minimal UI, hot exit/session restore, external-change
detection, Format Document, window-state restore, README, release build fix.

Verified: release build runs and shows its window; quit → session saved → restore works (tested
with seeded session files); formatters tested in Node; Rust unit tests pass.

Not yet verified by eye: overall look, Ctrl+Tab in WKWebView, Crepe dark-mode details,
narrow-window layout. The user is reviewing the UI.

Compiled on the Mac (0.7.0): `cargo test` passes 17 tests (incl. branches, encodings), `npm run typecheck` and `npm run build`
are clean. Not yet run with `npm run tauri dev` this session: check tab dragging, the branch menu, the HTML
preview, CSV/log colours, a big file (e.g. a 200 MB log), column selection, Reopen/Save with Encoding, the find panel, Ctrl+Space column select and Save As by eye.

Untested against real servers: browser sign-in on git.1011.no (Forgejo built-in client id
a4792ccc-144e-407e-86c9-5e7d8d9c3269, redirect http://127.0.0.1:51789), GitHub device flow with the GitHub CLI
client id 178c6fc778ccc68e1d6a, Bitbucket, Azure DevOps (Bearer auth for git), credential-helper lookups on
macOS/Windows. No in-app conflict resolution (conflicts are never applied).

Open decision: GitLab, Azure DevOps and Bitbucket have no shared client id, so they need a token or the user's
own OAuth app. To make them one-click, register a "Notepad" OAuth app on each (public client, redirect
http://127.0.0.1:51789, GitLab scope api) and put the ids in `BUILTIN_OAUTH` (src/git/types.ts). Bitbucket needs
a secret, so it stays token-based.

## Possible next steps
- Fix whatever the user reports from using the app.
- Code signing and notarisation for macOS; Windows/Linux builds (e.g. Forgejo Actions).
- Single-instance handling (opening a file while the app is running in another instance).
- Relative image paths in Markdown (needs Tauri's asset protocol).
- Find inside the formatted Markdown view (currently ⌘F switches to source).
- Recent files list.
