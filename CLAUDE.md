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
- Tab order: the split pair (mainId, splitId) is kept together at the RIGHT END of the strip by `pairUp` in
  tabs/store.ts (user's request; sticky at the right edge when tabs overflow, not draggable). The tab bar drags
  other tabs with pointer events (HTML5 DnD doesn't work while `dragDropEnabled` is on).
- CSV/log colouring (`editors/languages/columns.ts`) decorates only visible lines; `LanguageInfo.load(doc)` gets
  the initial text so it can detect the CSV delimiter / log columns. Colours are `--col-0..7`, `--log-*` tokens.
- Git branches: `list_branches`, `switch_branch` (safe checkout, refuses to overwrite local changes),
  `create_branch`, `move_to_new_branch` in gitops.rs. Sync fetches all branches (with prune). A refused push
  returns `PUSH_REJECTED:<branch>:<reason>` → dialog offering to move the commits to a new branch + pull request
  link (`pullRequestUrl` in git/types.ts; per-provider URL formats are untested against real servers).

- Sidebar (0.9.0): `src/sidebar/` (Sidebar.tsx, actions.ts). Repository tree on top, folder browser below
  (`settings.folderRoot`, File → Open Folder… ⌥⌘O), height shared by `settings.sidebarSplit`. Right-click → New File…/
  New Folder… with an inline name field (`files.rs`: `create_file`/`create_dir` refuse existing names and separators).
  New files are not committed until saved. Tabs whose file is in a git repo (not ignored) show an orange git mark
  (`--git` token; `git_path_info` via `Repository::discover`, refreshed on tab paths / treeVersion / repo changes),
  so users keep secrets out of synced files. The folder header shows the mark too.

- Delete (0.10.0): right-click → Move to Trash… (`trash` crate, `fs_trash`); `gitops::commit_removal` commits every
  tracked file under the deleted path (only those) and `git/actions.afterDelete` pushes. Clean tabs of deleted files
  close, dirty ones get `external: "deleted"`.
- Memory (0.10.0): `tabs/unload.ts` drops the text of clean file tabs no pane shows (≥ 64 KB, after 20 s;
  `tab.unloaded`, content "") and rereads on show. Anything that uses a possibly hidden tab's text must
  `await ensureLoaded(id)` first (saveTab, saveTabAs, setLanguage, toggleEol/Bom, saveWithEncoding, format) or it
  would write an empty file. Session restore leaves background clean tabs unloaded. session.ts tracks changed
  buffers by id (no copy of the text). Read chunks are 4 MB. Measuring (release build, isolated `HOME=` scratch
  dir, `footprint -p`): empty 93 MB WebContent + 33 MB Rust; 3×30 MB background tabs 172→81 MB; freed text stays
  in WebKit's footprint until memory pressure (`notifyutil -p org.WebKit.lowMemory` showed it drop to 74 MB).

- Single instance (0.11.0): `tauri-plugin-single-instance`, RELEASE BUILDS ONLY (`#[cfg(not(debug_assertions))]`) so
  `tauri dev` can run next to the installed app. A second launch passes its file arguments (`files_from_args`,
  resolved against the second launch's cwd) into `PendingOpen` + `open-files`. Note: a release binary started
  with another `HOME=` (memory measuring) still hands off to an installed Notepad that is running; quit it first.
- Markdown images (0.11.0): Crepe `ImageBlock.proxyDomURL` → `editors/imagePaths.ts` resolves the address against
  the tab's path → `allow_image` (lib.rs; absolute, existing, image extension only) adds that one file to the asset
  protocol scope (empty in tauri.conf.json; Cargo feature `protocol-asset`) → `convertFileSrc`. HTML preview
  (srcdoc) still can't show relative images.

- Releases (0.12.0): `.forgejo/workflows/release.yml` on push to main / tag `v*` / manual; job `release` (needs linux +
  windows, push events only) publishes `v<package.json version>` if no such release exists (notes = commit titles
  since the previous v* tag). After it is green run `scripts/release-mac.sh` on the Mac to add the .dmg.
  Build jobs: both on a Linux `docker` runner
  in `node:20-bookworm`: Linux deb/rpm/AppImage, Windows NSIS cross-compiled with cargo-xwin (experimental in
  Tauri), since 0.12.5 on servai (macos label, host mode) instead of the Linux runner. Runner `server` (labels docker, ubuntu-latest) exists. Run #1: Linux OK (~11 min); Windows compiled but
  makensis failed on bookworm (NSIS 3.08 lacks Win\RestartManager.nsh) → Windows job uses node:20-trixie (NSIS 3.11).
  This Forgejo has no API for job logs, so each job tees its output to /tmp/ci.log and always uploads it to the
  draft release "CI logs" (no tag): `scripts/ci-log.sh list`, `scripts/ci-log.sh get run3-windows-failure.log`
  (token from the git credential helper). Logs from run #3 on. macOS is built on the Mac
  and attached with `scripts/forgejo-release.sh <tag> <files>` (creates the release if missing, replaces assets).
  deling.1011.no (0.12.2): `scripts/deling-publish.sh <tag> <readme> <files…>` → POST /api/releases, slug
  `notepad`, Bearer token (CI secret DELING_TOKEN; Mac: env or keychain item `deling-api-token`). The API is
  LAN/Tailscale-only (this Mac reaches it: 401 without token). Same slug REPLACES the release as a whole, so the
  CI publishes all files at once (0.12.3: macos job on the user's Mac runner "servai", label `macos`, host mode,
  incremental target/); release-mac.sh is the manual fallback and republishes all Forgejo release assets + dmg. Missing token
  → message, exit 0. Default `international=false` (downloads only from Norway).
  The user chose NOT to code-sign or notarise macOS (no Apple Developer account); builds are ad-hoc/linker-signed.

## Gotchas found so far
- Windows Credential Manager: max 2560 bytes per entry (keyring stores UTF-16 → 1280 units). creds.rs splits a
  longer secret (OAuth access + refresh token) into `host#1..N` entries with `parts:N` in the main entry; short
  secrets and old entries stay one plain JSON entry (0.12.6, after the user's Windows sign-in failed).
- Windows/WebView2 eats browser shortcuts (Ctrl+N/Ctrl+Shift+N = new window, F5/Ctrl+R reload, Ctrl+P) before the
  native menu sees them. lib.rs setup turns them off (`SetAreBrowserAcceleratorKeysEnabled(false)` via
  `with_webview`, webview2-com/windows crates, cfg(windows), only compiled in CI), and keymap.ts also handles
  Ctrl+N / Ctrl+Shift+N in the page; `runMenu` (main.tsx) drops a repeat of those two within 400 ms. If another
  Ctrl shortcut fails only on Windows, suspect the same thing.
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

## Status (2026-11-22, version 0.12.6)
Latest (0.12.6): Windows keychain split for long sign-ins; Forgejo provider has no prefilled server (was
git.1011.no). VERIFIED on Windows by the user (0.12.6): browser sign-in to git.1011.no saves, and
Ctrl+N / Ctrl+Shift+N work. 0.12.5: Windows job moved to the Mac runner servai (cross-compile with Homebrew nsis/llvm/lld + cargo-xwin;
servai built macOS in 1.5 min vs ~10 min per job on `server`). 0.12.4: macos job installs rustup for the runner user (`forgejo-runner` on servai had no cargo). 0.12.3: macOS built by CI on a Mac runner; release waits for all three. 0.12.2: releases also published on deling.1011.no/notepad (needs the DELING_TOKEN secret). 0.12.1: Ctrl+N / Ctrl+Shift+N on Windows (WebView2 browser keys off + page fallback; not yet tried on
Windows). 0.12.0 (first release on git.1011.no, all platforms): automatic release on a green push to main; scripts/release-mac.sh. 0.11.3: build logs readable via scripts/ci-log.sh. 0.11.2: Windows job on Debian trixie for a newer NSIS. 0.11.1: release workflow for Linux/Windows on Forgejo Actions (untested until the runner exists). 0.11.0: single instance (release builds), relative images in formatted Markdown. Checked: a second release
launch with a relative file argument exits at once and the running app opens the file. Not yet checked by eye: an
image showing. 0.10.0: Move to Trash from the sidebar (commits + pushes in the repo), hidden tabs free their text,
background tabs load lazily on launch, 4 MB read chunks. 0.9.0: folder browser in the sidebar (below the repository), right-click New File/New Folder in both trees,
git mark on tabs for files in a git repository (not checked by eye yet). 0.8.1: split-view pair moves to the right end of the tab bar and stays there. 0.8.0: find and replace panel (OS shortcuts, find in selection), CSV/log Select Column, Save As picks the type, HTML Preview/Source button. 0.7.0: column selection (mouse + keyboard), file encodings (open/reopen/save, BOM), help updated. 0.6.0: tab drag reordering with split pairs grouped, git branches (switch/create/remote, protected-branch → move to new branch + pull request), hideable sidebar, JavaScript + HTML (preview/source), CSV + log column colours, big-file streaming with progress, Help and About. None of 0.6.0 is checked by eye yet. 0.5.1: GitHub.com one-click device-code sign-in with the GitHub CLI public client id; 0.5.0: one-click browser sign-in for Forgejo/Gitea (built-in client id; the others need Notepad's own OAuth app ids filled into BUILTIN_OAUTH in src/git/types.ts); 0.4.0: git repositories (sidebar, commit+push on save, accounts via PAT/OAuth, create private repo, clone); 0.3.0: split view (two panes, right-click a tab → Open to the Right); 0.2.0: new file of type (⇧⌘N) and tab right-click File Type; tight Markdown padding, formatting bar under the tabs, SQL support (typechecked and built;
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
- More memory ideas (not done): after editing a big document (> 2 M chars) the store holds a flattened copy while
  CodeMirror's lines still pin the original string (≈ 2× the file); keeping no store copy for mounted big docs would
  need every `tab.content` reader to go through the editor. Dirty/untitled background tabs could also be unloaded
  (their text is in buffers/), but `needsBuffer` must then not prune them.
- Faster CI (user said hold off, 2026-11-22): prebuilt build images in git.1011.no's container registry (deps, Rust,
  cargo-xwin, xwin SDK) + caching cargo registry/target; jobs take ~10–11 min now, about half of it setup.
- Find inside the formatted Markdown view (currently ⌘F switches to source).
- Recent files list.
