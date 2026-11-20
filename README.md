# Notepad

A minimal, modern notepad for macOS, Windows and Linux. Markdown is the default:
you edit formatted text, and the file on disk stays plain `.md`.

Built with [Tauri 2](https://tauri.app) (Rust) + React + TypeScript,
[Milkdown](https://milkdown.dev) for Markdown and [CodeMirror 6](https://codemirror.net) for everything else.

## Features

- **Formatted Markdown editing**: select text for a floating toolbar, type `/` for blocks
  (headings, lists, tasks, tables, code, quotes), or use Markdown shortcuts (`## `, `- `, `> `, `**bold**`).
  A fixed formatting bar sits under the tabs (hide it under **View → Show/Hide Formatting Bar**);
  it is greyed out for non-Markdown files and in the Markdown source view.
  **⌘/** (Ctrl+/) toggles the raw Markdown source.
- **HTML** opens in a sandboxed preview (no scripts); **⌘/** switches to the source and back.
- **Syntax highlighting** for JavaScript, HTML, PowerShell, Perl, shell, batch (`.bat`/`.cmd`), INI, YAML, JSON,
  SQL (ANSI, PostgreSQL, T-SQL), Markdown and plain text. For `.sql` files the dialect is guessed
  from the content (e.g. `GO`, `@vars`, `[brackets]` → T-SQL; `$$`, `::`, `RETURNING` → PostgreSQL)
  and can be changed in the status bar. The language comes from the file extension or shebang, and can be changed
  in the status bar.
- **CSV and log files** colour each column, so values that belong together share a colour on every line.
  CSV detects the delimiter (`,` `;` tab `|`) and bolds the header; logs detect their leading columns
  (timestamp, level, [thread], logger…) and tint error and warning lines.
- **Big files** (over 4 MB) stream in with a progress bar in the tab, so the app never freezes; up to 512 MB.
  Big Markdown files (over 1 MB) open in the source view.
- **Format Document** (⇧⌥F / Shift+Alt+F): JavaScript, HTML, JSON, YAML, Markdown, INI and SQL are built in. Shell, Perl and PowerShell
  use external tools if they are installed:
  - shell: `brew install shfmt`
  - Perl: `brew install perltidy`
  - PowerShell: `Install-Module PSScriptAnalyzer` (in `pwsh`)
- **Hot exit**: close the app at any time. Open tabs, unsaved edits and untitled documents
  are restored on the next launch, with cursor and scroll position.
- **Split view**: right-click a tab → **Open to the Right** to see two files side by side
  (drag the divider to resize, double-click it to reset; **Close Split View** in the tab menu or View menu).
  The formatting bar, status bar and shortcuts follow whichever pane has the focus. The split is restored on launch.
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
- **Tabs**: drag to reorder (the two tabs of a split view stay together and move as one), middle-click to close, right-click for more, including **File Type**
  to change the type of a tab (an untitled file also gets the new extension).
- **New file of a type** (⇧⌘N): pick Markdown, SQL, PowerShell, … and get `Untitled-N.<ext>`.
- **Changes from other programs**: clean tabs reload automatically when the file changes on disk.
  If you have unsaved edits, a banner lets you choose which version to keep.
- **Light and dark themes** follow the OS, or can be fixed under **View → Theme**.
- Keeps each file's line endings (LF/CRLF), UTF-8 BOM and file permissions.

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| New Markdown document | ⌘N | Ctrl+N |
| New file of a chosen type | ⇧⌘N | Ctrl+Shift+N |
| Open / Save / Save As | ⌘O / ⌘S / ⇧⌘S | Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Close tab | ⌘W | Ctrl+W |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab, ⇧⌘] / ⇧⌘[ | Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+PgDn / Ctrl+PgUp |
| Go to tab 1–8 / last tab | ⌘1–⌘8 / ⌘9 | Ctrl+1–Ctrl+8 / Ctrl+9 |
| Find | ⌘F | Ctrl+F |
| Format Document | ⇧⌥F | Shift+Alt+F |
| Toggle source (Markdown, HTML) | ⌘/ | Ctrl+/ |
| Show/hide repository sidebar | ⇧⌘E | Ctrl+Shift+E |

⌘Tab is not used because macOS reserves it for switching apps, and the app never receives it.

## Development

Requirements: Node.js 20+, Rust (stable), and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run tauri dev      # run with hot reload
npm run tauri build    # release build and installers (src-tauri/target/release/bundle)
npm run typecheck
cd src-tauri && cargo test
```

### Layout

```
src/
  actions.ts            new/open/save/close/format: everything menus and shortcuts trigger
  FormatBar.tsx         formatting bar under the tabs
  keymap.ts             tab-switching shortcuts (other shortcuts are native menu accelerators)
  session/session.ts    hot exit: session.json + buffers, external change detection
  tabs/                 tab store (Zustand) and tab bar
  editors/
    MarkdownEditor.tsx  Milkdown Crepe (formatted Markdown)
    mdFormat.ts         formatting commands used by the formatting bar
    CodeEditor.tsx      CodeMirror 6
    cmTheme.ts          CodeMirror theme built on CSS variables
    HtmlPreview.tsx     sandboxed HTML preview
    languages/          language registry, batch mode, formatters, CSV/log column colouring (columns.ts)
  help.md               Help → Notepad Help (opens in a tab)
  About.tsx             About dialog with the open source components
  theme/                design tokens (light/dark) and OS theme following
src-tauri/src/lib.rs    file I/O, state files, menu, quit handling, external formatters
src-tauri/src/gitops.rs libgit2: open, list, commit one file, sync (fetch/merge/push), clone
src-tauri/src/creds.rs  credentials: keychain, then the git credential helper; token refresh
src-tauri/src/oauth.rs  device flow and browser (PKCE) sign-in
src-tauri/src/provider.rs  provider endpoints and "create private repository" APIs
src-tauri/src/git_cmds.rs  Tauri commands for the above (git_tests.rs holds the tests)
```

Session data is stored in the OS app-data folder
(macOS: `~/Library/Application Support/no.1011.notepad/`).
