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
- Highlighting and formatting for: txt, PowerShell, Perl, sh, cmd/bat, INI, YAML, JSON, XML, SQL (ANSI, PostgreSQL, T-SQL), Markdown,
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
  Search modes like Notepad++ (0.18.0): Normal (literal), Extended (`\n` button: \n \r \t \0 \\ \xNN \uNNNN in Find AND
  Replace), Regex (.*). The typed text + mode live in `findTextField`; CodeMirror's SearchQuery holds the unescaped
  text (literal:true except regex), so the fields keep showing "\t". search({literal:true}) for CM-made queries.
- CSV/log "Select Column" (`selectColumn` in columns.ts, `columnInfo` facet): Ctrl+Space (Excel) / Alt+double-click;
  whole column, several columns, or part of a column (selected lines); one range per line, capped at 200k lines.
- Save As… shows the type picker first (TypePicker `saveAs` mode), then the native dialog: macOS's save panel
  (rfd) has no file-type popup. HTML status bar button names the action: "Preview" in source, "Source" in preview.
- Help → Keyboard Shortcuts opens `SHORTCUTS.md` (repo root, the ONE complete list for macOS and Windows/Linux; the
  README links to it). Update it whenever a shortcut is added or changed.
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
- **Add the version to `CHANGELOG.md`** in the same commit (newest first, `## X.Y.Z — date`, user-facing main
  changes; build-only patches can be skipped or one line). Releases use it: the Forgejo release notes are that
  version's section and the deling.1011.no/notepad page shows the whole changelog (`scripts/release-notes.sh`).

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

- JSON/XML (0.13.0): `editors/languages/validate.ts` = pure checkers (`checkJson(text, build)` also builds the tree
  with exact number text; `validateXml` = well-formedness: matching tags, quoting, entities, one root…), used by
  the CodeMirror linter (`LanguageInfo.validate`, CodeEditor), the status bar (`editors/validation.ts` store,
  `revealProblem`) and the formatters (errors with line/column). Engines' JSON.parse messages differ (JSC has no
  position), so never rely on them. formatJson prints from the tree (no JSON.parse rounding); JSONC with comments
  → Prettier "json" parser (keeps comments). XML format = @prettier/plugin-xml, whitespace "preserve" ("ignore"
  rewraps text values). Tree view = `editors/DataView.tsx`, `tab.dataView` (⌘/ for JSON/XML), XML via DOMParser.
  Gotcha: the Bash tool turns `\uXXXX` in commands into the character; write such escapes from parts.

- Mac runner jobs (0.13.1): job-level CARGO_TARGET_DIR=/Users/forgejo-runner/.cache/notepad-ci/target-{macos,windows}
  (a job's workdir is new every run, so src-tauri/target never persisted); bundles are copied from there.

- Preview tabs (0.14.0, user request): sidebar single click → `openFiles([p], {preview:true})` replaces the existing
  clean preview tab (`tab.preview`, italic); double click → `{pin:true}`; tab-bar double-click → `keepTab`. Store
  `edit`/`update` with `dirty` clear `preview`. `opening` map in actions.ts serialises opens of the same path so the
  clicks of a double click never open a file twice. Other ways of opening (File → Open, drop, Finder) are normal tabs.

- SQLite (0.15.0, user request: light query interface, create databases and tables): `src-tauri/src/db.rs` (rusqlite,
  bundled SQLite; ONE CONNECTION PER CALL, so no lock is held between runs and `BEGIN…COMMIT` only spans one run;
  `db_run` runs every statement via `Batch`, ≤ 1000 rows each, ints beyond 2^53 as `{int}`, blobs as `{blob,hex}`;
  `db_interrupt(runId)` stops a run; `db_create` / `db_copy` (VACUUM INTO) trash an existing target, the save dialog
  already asked). A database tab is `tab.kind === "sqlite"` (`isDb`), language "sql", `content` always "",
  `tab.query` = editor text (kept in session.json). openOne detects it by the 16-byte header (`db_probe`), not by
  extension (Thumbs.db etc. stay text). Every text action guards against db tabs (save = no-op, Save As = copy,
  setLanguage/encodings/EOL ignored, external-change check and unload skip them, session restore doesn't read
  them). UI `src/db/` (DbView: table list, CodeMirror SQLite + schema completion, results grid; NewTable dialog;
  sql.ts quoting/CSV/CREATE TABLE). File → New Database… and the ⇧⌘N picker's "SQLite Database" entry.

- Command line (0.16.0, user request "notepad filename.txt"): macOS menu Notepad → Install Command Line Tool… →
  `cli.rs` installs a sh script at /usr/local/bin/notepad (direct `install`, else osascript admin prompt; refuses to
  overwrite a file without its "Installed by Notepad" mark). The script makes paths absolute and runs
  `open -n -b no.1011.notepad --args …`; the new instance hands off via the single-instance plugin. `files_from_args`
  also keeps paths that don't exist yet (folder must exist); pending opens use `openFiles(…, {create:true})` → empty
  clean tab with that path and mtime null (checkExternalChanges skips mtime-null tabs). Windows: not done, and
  `notepad` there is Microsoft's notepad.exe (System32 comes first on PATH).

- GitHub (0.16.1, user request): public copy https://github.com/MariusEng/notepad (gh CLI is logged in as MariusEng).
  The user wanted a GITHUB APP, not tokens. An app only gives 1-hour installation tokens, so no Forgejo push mirror:
  `.forgejo/workflows/github-mirror.yml` (every push; fetches all heads into refs/mirror/*, `git push --force`
  heads + tags) and the release job's "Publish on GitHub" (scripts/github-release.sh; on the Mac it falls back to
  `gh auth token`) mint tokens with scripts/github-token.sh (JWT via openssl, secrets GH_APP_ID, GH_APP_PRIVATE_KEY;
  missing → skipped). scripts/github-setup.sh <app id> <pem> is run by the user (key never in the chat); it also
  deletes an old push mirror. GitHub is overwritten → NEVER merge there. GitHub PRs: scripts/github-pr.sh show/merge
  <n> (refs/pull/n/head, --no-ff merge on main, push to git.1011.no; GitHub then marks the PR merged). Still bump
  version + CHANGELOG for merged PRs. License: MIT (LICENSE, user's choice).

- GitHub pull requests → Forgejo (0.16.2): `.forgejo/workflows/github-prs.yml` (cron */30 + dispatch, runs from main)
  → `scripts/github-pr-sync.mjs` (Node; GitHub App JWT in-process): each open GitHub PR #N → branch `github-pr-N`
  in the fork `github-sync/notepad` → Forgejo PR "GitHub #N: …" opened BY THE BOT. The bot `github-sync` is a
  restricted user with READ access only (created by `scripts/github-sync-bot.py`, admin; token in secret
  SYNC_BOT_TOKEN, never printed; secret names may not start with FORGEJO_/GITHUB_), so Forgejo 15 treats its PRs as
  untrusted: CI needs the user's Approve and gets no secrets. Opening them as marius would run them at once with the
  PR's own workflow files (could pick the Mac host runner): never do that. Closed on GitHub → closed here; merged here
  → mirror pushes main → GitHub marks merged (merge commit), else the sync comments + closes it (app has Pull
  requests: write). `.forgejo/workflows/ci.yml` = test job (docker runner only; typecheck, build, cargo test).
  Branch protection on main: status check `ci / test (pull_request)`, pushes allowed.
  Verified end to end 2026-11-23 (GitHub #2 → Forgejo #2 → approve → ci green in 4 min → merge → GitHub "merged").
  The approval is the workflow approval on the run (Actions page or PR box; no API for it): "Approve once", never
  "trust" the bot. GitHub rulesets: "main comes from git.1011.no" (rule update, bypass only the App, id 5891842) and
  the user's "Default" (deletion + non_fast_forward; bypass admin role + the App: the mirror force-pushes main).

- Updates (0.17.0, user request; Help → Check for Updates…, user wants it in the Help menu on all platforms):
  tauri-plugin-updater (used from Rust since 0.20.0: src-tauri/src/update.rs), `src/updates.tsx` (manual check =
  dialog; auto check 15 s after launch and daily if settings.autoUpdates → status bar "Update to X"; install =
  saveSessionNow → invoke update_install, which restarts the app).
  Endpoint https://github.com/MariusEng/notepad/releases/latest/download/latest.json (user's final choice: GitHub; 0.17.0
  alone was built with https://deling.1011.no/notepad/last-ned/latest.json, so deling still gets a copy of
  latest.json with GitHub URLs until nobody runs 0.17.0). github-release.sh creates new releases as DRAFTS and
  publishes them after the uploads, so "latest" never lacks latest.json. Minisign key: Forgejo secrets TAURI_SIGNING_PRIVATE_KEY(+_PASSWORD), backup in the login keychain
  (services notepad-updater-private-key / notepad-updater-key-password), pubkey in tauri.conf.json. CI passes
  `--config '{"bundle":{"createUpdaterArtifacts":true}}'` (local builds stay keyless). Release job: updater-manifest.mjs
  → latest.json (darwin-aarch64[-app] = renamed Notepad_<v>_aarch64.app.tar.gz, windows-x86_64[-nsis] = setup.exe,
  linux-x86_64-appimage/-deb/-rpm; NO plain linux key), .sig deleted, latest.json uploaded last to GitHub;
  deling gets the files minus .app.tar.gz, plus latest.json for 0.17.0. Why it helps on macOS: the app downloads with its own HTTP client, so no quarantine xattr →
  no Gatekeeper prompt. Keychain items made by an ad-hoc signed build may still ask "allow access" after an update.

- Macros (0.19.0, user request, like Notepad++): `editors/macroBus.ts` (step types + recorder hook, no imports, so
  FindPanel can record without a cycle), `editors/macro.tsx` (CodeMirror recorder extension in CodeEditor: inputHandler
  observer at Prec.highest for text, domEventObservers for keys with Ctrl/⌘ or named keys, paste/copy/cut, beforeinput
  historyUndo/Redo; playback: keys via runScopeHandlers(view, KeyboardEvent, "editor"), text char by char through the
  inputHandler facet (closeBrackets only acts on single chars), find/replace via FindPanel.playSearch; paste uses
  what copy/cut set during the same playback). Run once / n / until EOF: every run must leave less text after the
  cursor, else it stops (0.19.3 fix: a macro ending with Home on the last line, or Find Next wrapping to the top,
  repeated up to MAX_RUNS); yields every 100 ms. Menu Edit → Macro (macro_record ⇧⌘R, macro_play ⇧⌘P, macro_macros dialog).
  settings.lastMacro + settings.macros. Mouse not recorded. Not in formatted Markdown or the SQLite query editor
  (EditorHandle.view only in CodeEditor). Tested with jsdom in the scratchpad (8 cases); ArrowUp/Down need real layout.

## Gotchas found so far
- macOS "Notepad is damaged and can't be opened" for a downloaded build (2026-11-22): only the binary was
  linker-signed, the bundle wasn't sealed. tauri.conf.json `bundle.macOS.signingIdentity: "-"` ad-hoc signs the
  whole bundle (hardened runtime on; the app still starts). Downloaded copies then get the normal "unverified
  developer" prompt → System Settings → Privacy & Security → Open Anyway (right-click → Open no longer works on
  recent macOS). Check with `codesign --verify --deep --strict Notepad.app`.
- Keychain prompts after every update (2026-11-23, user: "allow keychain access three times"): keychain ACLs follow the
  app's designated requirement; ad-hoc = cdhash = new each build. Fix (0.18.1): a self-signed code signing certificate
  (`scripts/macos-signing-setup.sh`, RUN BY THE USER: makes it, stores Forgejo secrets MACOS_SIGNING_P12(+_PASSWORD)
  and the login-keychain backup notepad-macos-signing-p12(-password)). `scripts/with-signing-keychain.sh <build cmd>`
  puts it in a temporary keychain and sets APPLE_SIGNING_IDENTITY=<sha1> (Tauri's APPLE_CERTIFICATE route needs an
  Apple certificate; codesign itself accepts an untrusted one). DR becomes `certificate leaf = H"…"`: stable. The temp keychain is
  NOT put in the search list (0.19.1: on the CI runner's launchd user codesign then said "no identity found"); a
  `codesign` wrapper first in PATH adds `--keychain <temp>` when signing. No certificate or a setup error → ad-hoc
  build with a warning. Gatekeeper is unchanged (still unidentified). I was not
  allowed to store the secrets myself (permission check), so the user runs the setup script.
  NOT ENOUGH (found 2026-11-24): besides the ACL (which did follow the certificate), keychain items have a
  partition list, and for an app WITHOUT an Apple team ID the partition is `cdhash:<build>` (seen with
  `security dump-keychain -a`), so every update still asked once per item. Fix (0.20.0): on macOS creds.rs stores
  sign-ins through /usr/bin/security (`apple_tool`: service no.1011.notepad.git, value base64 via `security -i` +
  `-X hex` on stdin, never argv; read with -w); such items belong to the tool (partition apple-tool:), so updates
  don't matter. Trade-off: other programs of the user can read them via the tool (like git-credential-osxkeychain,
  gh). Old keyring items are migrated on first load (one last prompt) and deleted. Windows/Linux keep keyring.
- Dock (found 2026-11-24): the plugin's macOS install swaps the whole Notepad.app folder, so a pinned Dock tile kept
  pointing at the old folder and the updated app showed as a second, "recent" tile. 0.20.0: `src-tauri/src/update.rs`
  does check/download (plugin: verifies the signature) in Rust (commands update_check / update_install, progress
  event "update-progress") and on macOS installs IN PLACE: unpack into Notepad.app/.notepad-update, check the bundle
  id, rename Contents aside, new Contents in (rollback on failure), lsregister -f; else falls back to
  update.install(). JS plugin-updater/plugin-process removed (and their capabilities). Tests: inode kept, wrong app
  refused; NOTEPAD_REAL_UPDATE_TEST=<tar.gz>:<app copy> cargo test real_files runs it on real files.
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

## Status (2026-11-24, version 0.20.0)
Latest (0.20.0): no keychain prompts on update (sign-ins via /usr/bin/security), in-place macOS updates (Dock tile kept). Both seen working only in tests so far. 0.19.3: macro "until the end of the file" stops at the end. 0.19.2: managed build option. 0.19.1: macOS signing fix for the CI runner (0.18.1 + 0.19.0 never released). 0.19.0: macros. 0.18.1: macOS builds signed with a fixed self-signed certificate (needs the user to run scripts/macos-signing-setup.sh). 0.18.0: Extended search mode (Notepad++). 0.17.1: updates come from GitHub (0.17.0 checked deling). Not yet seen working end to end. 0.17.0: auto updates. 0.16.3: docs + test file removed. 0.16.2: GitHub PRs synced into Forgejo + ci.yml + branch protection. 0.16.1: GitHub copy + GitHub Releases via a GitHub App (needs the app + scripts/github-setup.sh once). 0.16.0: `notepad` command line tool (macOS). 0.15.0: SQLite databases (open, New Database, New Table, query with ⌘↵, results grid, Open as CSV, Save As copy).
`cargo test` covers db.rs; typecheck/build clean. NOT yet checked by eye or run in `tauri dev`. 0.14.1: CHANGELOG.md drives release notes and the growing deling changelog. 0.14.0: preview tabs from the sidebar (single click previews, double click keeps). VERIFIED by the user
(local build). 0.13.3: Help → Keyboard Shortcuts (SHORTCUTS.md). 0.13.2: macOS bundle ad-hoc signed (downloads were "damaged"). 0.13.1: persistent cargo build folders on the Mac runner; Linux CI image prepared (not in use yet).
0.13.0: XML (highlighting, formatting, file types), JSON/XML validation, JSON/XML tree view.
Not yet checked by eye. 0.12.6: Windows keychain split for long sign-ins; Forgejo provider has no prefilled server (was
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
- Managed edition (planned 2026-11-24): signed builds without self-update for an organisation, built in a separate
  PRIVATE repository from each release of this project (its name and plan: see Claude's local memory, not this
  repo). Never name the organisation in this repository, its commits or pull requests: it is copied to public GitHub.
  DONE here (0.19.2): the managed build option = `VITE_NOTEPAD_MANAGED=1` (src/edition.ts; updates.tsx
  short-circuits, the bundler drops the update code; About "(managed)") + `--config src-tauri/tauri.managed.conf.json`
  (identifier no.1011.notepad.managed, NSIS perMachine, updater endpoints [], no updater artifacts; Tauri refuses
  unknown keys such as "$comment"). cli.rs writes the running app's own bundle id into /usr/local/bin/notepad. ci.yml
  builds the managed frontend. deling-publish.sh: DELING_SLUG/NAME/PASSWORD. deling has password protection.
- More memory ideas (not done): after editing a big document (> 2 M chars) the store holds a flattened copy while
  CodeMirror's lines still pin the original string (≈ 2× the file); keeping no store copy for mounted big docs would
  need every `tab.content` reader to go through the editor. Dirty/untitled background tabs could also be unloaded
  (their text is in buffers/), but `needsBuffer` must then not prune them.
- Linux CI image (0.13.1, prepared, NOT YET IN USE): ci/linux.Containerfile (packages, rustup, npm cache, all Rust
  deps compiled into CARGO_TARGET_DIR=/opt/notepad-target) + scripts/ci-image.sh (podman/docker build + push to
  git.1011.no/marius/notepad-ci-linux:latest; .dockerignore keeps the context to 4 files). Once pushed, switch the
  linux job to `container: image:` it (credentials if the package is private), drop its apt/rustup steps and copy
  bundles from /opt/notepad-target/release/bundle.
- Find inside the formatted Markdown view (currently ⌘F switches to source).
- Recent files list.
