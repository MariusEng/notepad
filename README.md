# Notepad

A minimal, modern notepad for macOS, Windows and Linux. Markdown is the default:
you edit formatted text, and the file on disk stays plain `.md`.

Built with [Tauri 2](https://tauri.app) (Rust) + React + TypeScript,
[Milkdown](https://milkdown.dev) for Markdown and [CodeMirror 6](https://codemirror.net) for everything else.

Downloads: [GitHub Releases](https://github.com/MariusEng/notepad/releases) (macOS Apple Silicon, Windows, Linux).
The macOS app isn't notarised: the first time, open it via System Settings → Privacy & Security → Open Anyway.

**License:** MIT (see [LICENSE](LICENSE)).

**Contributing:** pull requests are welcome on [GitHub](https://github.com/MariusEng/notepad/pulls). The GitHub
repository is a copy of the main repository on git.1011.no: pull requests are brought over there (within half an
hour), tested by its CI, merged there, and then show up here as merged. GitHub's merge button isn't used.

## Features

- **Formatted Markdown editing**: select text for a floating toolbar, type `/` for blocks
  (headings, lists, tasks, tables, code, quotes), or use Markdown shortcuts (`## `, `- `, `> `, `**bold**`).
  A fixed formatting bar sits under the tabs (hide it under **View → Show/Hide Formatting Bar**);
  it is greyed out for non-Markdown files and in the Markdown source view.
  **⌘/** (Ctrl+/) toggles the raw Markdown source.
- **HTML** opens in a sandboxed preview (no scripts); **⌘/** switches to the source and back.
- **Syntax highlighting** for JavaScript, HTML, PowerShell, Perl, shell, batch (`.bat`/`.cmd`), INI, YAML, JSON, XML,
  SQL (ANSI, PostgreSQL, T-SQL), Markdown and plain text. For `.sql` files the dialect is guessed
  from the content (e.g. `GO`, `@vars`, `[brackets]` → T-SQL; `$$`, `::`, `RETURNING` → PostgreSQL)
  and can be changed in the status bar. The language comes from the file extension or shebang, and can be changed
  in the status bar.
- **CSV and log files** colour each column, so values that belong together share a colour on every line.
  CSV detects the delimiter (`,` `;` tab `|`) and bolds the header; logs detect their leading columns
  (timestamp, level, [thread], logger…) and tint error and warning lines.
- **Find and replace** with OS shortcuts (⌘F/⌥⌘F/⌘G/⇧⌘G/⌘E on macOS; Ctrl+F/Ctrl+H/F3/Shift+F3 on Windows/Linux):
  match count, case/word, Notepad++'s search modes (Normal, Extended `\n \r \t \0 \xNN \uNNNN`, regular expression with `$1`
  groups), and **find in selection** (e.g. replace only within a selected column).
- **Macros** like Notepad++ (Edit → Macro): record typing, editing keys, find/replace, copy/cut/paste and undo
  (⇧⌘R / Ctrl+Shift+R), play (⇧⌘P / Ctrl+Shift+P), run n times or until the end of the file, save with a name
  (`editors/macro.tsx`; kept in settings.json).
- **Select CSV/log columns**: Ctrl+Space (as in Excel) or Alt/Option+double-click selects the column(s) at the cursor on
  every line, or only on the selected lines; each line gets its own cursor.
- **Save As** asks for the file type first (current type preselected), then where to save.
- **Column (block) selection**: Option+drag / Alt+drag with the mouse; ⇧⌥⌘+arrows (macOS) or Shift+Alt+arrows
  (Windows/Linux, also Ctrl+Shift+Alt+arrows) with the keyboard. Typing, deleting, copy and paste then work on every line.
- **Encodings**: UTF-8 by default. A BOM is recognised (UTF-8, UTF-16 LE/BE); a file that isn't valid UTF-8 opens as
  Windows-1252. **File → Encoding…** (also the tab menu, or the status bar) reopens or saves in another encoding:
  Western, Central European, Cyrillic, Greek, Turkish, Baltic, Hebrew, Arabic, Thai, Vietnamese, Japanese, Chinese,
  Korean, UTF-16. Characters an encoding can't hold are refused on save, never silently replaced.
- **Big files** (over 4 MB) stream in with a progress bar in the tab, so the app never freezes; up to 512 MB.
  Big Markdown files (over 1 MB) open in the source view.
- **JSON and XML validation** while typing (underline, gutter marker, status bar "Valid JSON" / error count, click to
  jump) and a **tree view** (status bar **View**, or ⌘/) with expand/collapse. Pure-TS checkers in
  `editors/languages/validate.ts` give exact line/column on every platform.
- **Format Document** (⇧⌥F / Shift+Alt+F): JavaScript, HTML, JSON, XML, YAML, Markdown, INI and SQL are built in. Shell, Perl and PowerShell
  use external tools if they are installed:
  - shell: `brew install shfmt`
  - Perl: `brew install perltidy`
  - PowerShell: `Install-Module PSScriptAnalyzer` (in `pwsh`)
- **Light on memory**: saved files in hidden tabs drop their text after 20 s and reread it from disk when shown;
  on launch, background tabs aren't read until you open them. Unsaved edits always stay in memory (and in the
  session buffers).
- **Relative images in Markdown** (`![](images/a.png)`) show in the formatted view (asset protocol, one allowed
  image file at a time); the Markdown keeps the relative path.
- **Command line** (macOS): Notepad → Install Command Line Tool… writes `/usr/local/bin/notepad` (admin prompt if
  needed; `src-tauri/src/cli.rs`): `notepad a.txt new.md` opens files in the running app (`open -n -b` + the
  single-instance handoff); missing files open as empty tabs that saving creates.
- **Single instance**: opening a file while Notepad runs opens it in the running app (release builds).
- **Hot exit**: close the app at any time. Open tabs, unsaved edits and untitled documents
  are restored on the next launch, with cursor and scroll position.
- **Split view**: right-click a tab → **Open to the Right** to see two files side by side
  (drag the divider to resize, double-click it to reset; **Close Split View** in the tab menu or View menu).
  The formatting bar, status bar and shortcuts follow whichever pane has the focus. The split is restored on launch.
- **Sidebar with a folder browser** (File → Open Folder…, ⌥⌘O): any folder, shown under the repository when
  one is open (drag the line between them to resize). Right-click in either tree → **New File…** / **New Folder…**
  (inline name field; new files open in a tab). A single click on a file opens a **preview tab** (italic title)
  that the next click replaces; a double click (or editing it, or double-clicking the tab) keeps it open and **Move to Trash…** (asks first; in the open repository the
  deletion is committed and pushed).
- **Git mark on tabs**: files inside a git repository (not ignored) get an orange git mark in the tab bar, so
  it's obvious which files are committed and pushed and shouldn't hold secrets. The tooltip names the repository.
- **Git repositories** (File → Open Repository…, ⇧⌘O): open any folder inside an existing repository and edit
  its files from a quiet sidebar (⇧⌘E to hide/show). **Saving commits and pushes** the file ("Update notes.md");
  if the remote moved on, the changes are merged first. A conflicting change is never applied: your commits stay
  local and the status bar shows a warning. The status bar shows the branch and sync state; click it to sync now.
  File → **New Private Repository…** creates a private repository on GitHub, GitLab, Forgejo/Gitea, Bitbucket or
  Azure DevOps and clones it; **Clone Repository…** downloads an existing one; **Git Accounts…** manages sign-ins
  (access token, or **Sign in with browser**: one click on github.com (device code) and on Forgejo/Gitea servers (built-in OAuth app for git tools); other providers use an OAuth app you register: device code for GitHub/GitLab).
  Credentials are looked up in the app's own account store (OS keychain), then in your git credential manager.
  Only HTTPS remotes are supported. View → *Auto Commit & Push on Save* turns the automatic commit off.
- **Branches**: click the repository name (sidebar) or the branch (status bar) to switch branch, create one,
  or open a pull request. If the server refuses pushes to a protected `main`/`master`, Notepad offers to move the
  unpushed commits to a new branch, push it and open a pull request. Hide the sidebar with its top-right button.
- **Updates**: Help → Check for Updates… and a daily check (status bar "Update to …"); downloads from GitHub
  Releases, verifies the signature, installs, restarts with the session restored (tauri-plugin-updater, driven from
  Rust in `src-tauri/src/update.rs`; on macOS the app's contents are replaced in place so a pinned Dock icon stays).
- **SQLite databases**: open `.sqlite`/`.db` files (recognised by their header), or File → New Database…. Tables and
  views on the left (click: rows, ▸: columns, right-click: Insert SELECT / Copy CREATE / Drop), a SQL editor with
  table/column completion (⌘↵ runs it or the selection, Stop cancels), results grid (first 1,000 rows, Open as CSV),
  New Table dialog (types, key, NOT NULL, UNIQUE, defaults; or Edit as SQL). Changes are written at once (rusqlite,
  bundled SQLite; one connection per run, `src-tauri/src/db.rs`).
- **Tabs**: drag to reorder (the two tabs of a split view sit together at the right end of the tab bar), middle-click to close, right-click for more, including **File Type**
  to change the type of a tab (an untitled file also gets the new extension).
- **New file of a type** (⇧⌘N): pick Markdown, SQL, PowerShell, … and get `Untitled-N.<ext>`.
- **Changes from other programs**: clean tabs reload automatically when the file changes on disk.
  If you have unsaved edits, a banner lets you choose which version to keep.
- **Light and dark themes** follow the OS, or can be fixed under **View → Theme**.
- Keeps each file's line endings (LF/CRLF), UTF-8 BOM and file permissions.

## Keyboard shortcuts

All shortcuts, for macOS and Windows/Linux, are in **[SHORTCUTS.md](SHORTCUTS.md)**, also in the app under
**Help → Keyboard Shortcuts**. Keep that file up to date when a shortcut is added or changed.

## Development

**Managed edition** (0.19.2): for organisations that install and update Notepad themselves (e.g. Company Portal).
`VITE_NOTEPAD_MANAGED=1 npx tauri build --config src-tauri/tauri.managed.conf.json`: own app id
(`no.1011.notepad.managed`: own settings and session), per-machine Windows installer (silent: `/S`), no update check
(Help → Check for Updates says updates are managed by the organisation), "(managed)" in About (`src/edition.ts`).
More `--config` files can be added after it. `deling-publish.sh` takes `DELING_SLUG`, `DELING_NAME`, `DELING_PASSWORD`.

**macOS signing** (0.18.1): builds are signed with Notepad's own self-signed certificate so keychain access
("Always Allow") survives updates: `scripts/macos-signing-setup.sh` creates it once (Forgejo secrets + login-keychain
backup), `scripts/with-signing-keychain.sh <build command>` uses it (CI and release-mac.sh). Without it: ad-hoc.

**Updates** (0.17.0): CI builds sign the update files (secrets TAURI_SIGNING_PRIVATE_KEY and
TAURI_SIGNING_PRIVATE_KEY_PASSWORD; backup in the Mac's login keychain as `notepad-updater-private-key` /
`notepad-updater-key-password`; the public key is in tauri.conf.json). The release job writes `latest.json`
(`scripts/updater-manifest.mjs`) and uploads it last to the GitHub release, which stays a draft until all files are
there; the app reads `releases/latest/download/latest.json`. A copy also goes to deling for 0.17.0 installs (0.17.0
looked there). Losing the key means users must reinstall by hand once. Local builds don't
make update files (`createUpdaterArtifacts` is only turned on in CI with `--config`).

**GitHub** (0.16.1): git.1011.no is the main repository; github.com/MariusEng/notepad is a copy. A GitHub App (no
personal token) gives the CI one-hour tokens (`scripts/github-token.sh`): the `github-mirror` workflow pushes every
branch and tag to GitHub after each push, and the release job also publishes a GitHub Release
(`scripts/github-release.sh`). Setup: create the app (Contents and Workflows: Read and write, no webhook, only this
account), install it on MariusEng/notepad, generate a private key, then `scripts/github-setup.sh <app id> <key.pem>`
stores the Forgejo secrets GH_APP_ID and GH_APP_PRIVATE_KEY. Pull requests from GitHub (0.16.2): the `github-prs` workflow (every 30 min, or Run
workflow) opens each one as a Forgejo pull request from the bot account `github-sync` (read-only collaborator, its
own fork with Actions off; `scripts/github-pr-sync.mjs`, bot setup/renewal `scripts/github-sync-bot.py`). Because
the bot isn't trusted, `ci.yml` (typecheck, build, `cargo test`, Linux docker runner) runs only after you click
Approve on the pull request, and without secrets. Read changes to `.forgejo/` first (the pull request says so).
Branch protection: merging into main needs a green `ci / test`; direct pushes still work. Merge on Forgejo; GitHub
then shows it merged (after squash/rebase the sync comments and closes it). `scripts/github-pr.sh` is the manual
alternative. Never merge on GitHub (the mirror overwrites GitHub's branches). GitHub enforces it: ruleset "main comes
from git.1011.no" lets only the GitHub App update main (no Merge button, no direct pushes, also for admins), and
ruleset "Default" blocks deleting main and force pushes, with the app as an exception.


Requirements: Node.js 20+, Rust (stable), and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # release build and installers (src-tauri/target/release/bundle)
npm run typecheck
cd src-tauri && cargo test
```

### Releases

- **Automatic releases**: every push to `main` builds `.deb`, `.rpm` and `.AppImage` on a Forgejo runner with the
  `docker` label, and the macOS `.dmg` plus the Windows NSIS installer (cross-compiled with cargo-xwin) on a Mac
  runner with the `macos` label
  (`.forgejo/workflows/release.yml`). When both builds are green and the version in `package.json` has no release
  yet, it publishes release `v<version>` with the installers and the commit titles since the last release. So:
  bump the version → push → release. Pushing a `v*` tag by hand also works; Actions → release → *Run workflow*
  only builds.
- **macOS** is built in the same run on a Mac runner (label `macos`, host mode); if it is down,
  `scripts/release-mac.sh` on any Mac adds the dmg to the release by hand.
- **deling.1011.no/notepad**: the release is also published there for friends (`scripts/deling-publish.sh`). CI
  publishes all platforms at once with the Actions secret `DELING_TOKEN` (`make api-token` in the deling repo on
  its server); `scripts/release-mac.sh` republishes the whole set when the dmg is added by hand, because deling
  replaces a release as a whole. On the Mac the token is read from the keychain item `deling-api-token`
  (`security add-generic-password -s deling-api-token -a deling -w '<token>'`). No token = skipped, not failed.
- **Faster builds**: the Mac runner jobs build into fixed folders (`~forgejo-runner/.cache/notepad-ci/`), so they
  only recompile what changed. For the Linux runner, `ci/linux.Containerfile` is a prepared image (packages, Rust,
  npm cache, compiled Rust dependencies); build and push it with `scripts/ci-image.sh` on a machine with podman or
  docker, then the Linux job can use it.
- **Changelog**: `CHANGELOG.md` (add each version when bumping). The release notes are that version's section; the
  deling page shows the whole list (`scripts/release-notes.sh`).
- **Build logs**: every job attaches its log to the draft release *CI logs*. `scripts/ci-log.sh list` shows them,
  `scripts/ci-log.sh get run3-windows-failure.log` downloads one (uses your git credentials for git.1011.no).
- No paid code signing. The macOS app is ad-hoc signed (`bundle.macOS.signingIdentity: "-"`; without it a
  downloaded app is reported as "damaged"); the first time, macOS says it can't check the developer: System
  Settings → Privacy & Security → **Open Anyway**. Windows: SmartScreen
  → *More info* → *Run anyway*.

### Layout

```
src/
  actions.ts            new/open/save/close/format: everything menus and shortcuts trigger
  FormatBar.tsx         formatting bar under the tabs
  keymap.ts             tab-switching shortcuts (other shortcuts are native menu accelerators)
  session/session.ts    hot exit: session.json + buffers, external change detection
  tabs/                 tab store (Zustand) and tab bar
  sidebar/              sidebar: repository + folder trees, New File/Folder, git marks on tabs
  editors/
    MarkdownEditor.tsx  Milkdown Crepe (formatted Markdown)
    mdFormat.ts         formatting commands used by the formatting bar
    CodeEditor.tsx      CodeMirror 6
    cmTheme.ts          CodeMirror theme built on CSS variables
    HtmlPreview.tsx     sandboxed HTML preview
    languages/          language registry, batch mode, formatters, CSV/log column colouring (columns.ts)
  help.md               Help → Notepad Help (opens in a tab)
  editors/blockSelect.ts   column selection (mouse + keyboard)
  editors/FindPanel.tsx    find and replace panel (CodeMirror search state, find in selection)
  editors/encodings.ts     encodings offered in File → Encoding
  db/                   SQLite tab: DbView (tables, query editor, results), New Table dialog, SQL helpers
  About.tsx             About dialog with the open source components
  theme/                design tokens (light/dark) and OS theme following
.forgejo/workflows/    release builds for Linux and Windows (Forgejo Actions)
scripts/forgejo-release.sh  attach files to the Forgejo release of a tag
scripts/deling-publish.sh  publish a version on deling.1011.no/notepad (all files at once)
scripts/release-mac.sh  build the macOS dmg, attach it to the release, republish everything on deling
scripts/ci-image.sh     build + push the Linux CI image (ci/linux.Containerfile) to git.1011.no's registry
scripts/ci-log.sh       read the build logs the workflow attaches to the draft release "CI logs"
src-tauri/src/lib.rs    file I/O, state files, menu, quit handling, external formatters
src-tauri/src/db.rs     SQLite: schema, run SQL (interruptible), create, Save As copy (VACUUM INTO)
src-tauri/src/files.rs  folder browser: list, create file/folder, "is this path in git?"
src-tauri/src/gitops.rs libgit2: open, list, commit one file, sync (fetch/merge/push), clone
src-tauri/src/creds.rs  credentials: keychain, then the git credential helper; token refresh
src-tauri/src/oauth.rs  device flow and browser (PKCE) sign-in
src-tauri/src/provider.rs  provider endpoints and "create private repository" APIs
src-tauri/src/git_cmds.rs  Tauri commands for the above (git_tests.rs holds the tests)
```

Session data is stored in the OS app-data folder
(macOS: `~/Library/Application Support/no.1011.notepad/`).
