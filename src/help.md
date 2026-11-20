# Notepad Help

A minimal notepad. Markdown is the default: you edit formatted text and the file on disk stays plain `.md`.

## Documents and tabs

- **⌘N** (Ctrl+N) opens a new Markdown document. **⇧⌘N** (Ctrl+Shift+N) asks for the file type first.
- **Drag tabs** to reorder them. Middle-click closes a tab. Right-click a tab for more: Open to the Right, Close Others, File Type, Copy Path.
- Switch tabs with **Ctrl+Tab** / **Ctrl+Shift+Tab**, or **⌘1–⌘8** (Ctrl+1–8), **⌘9** for the last tab.
- **Split view**: right-click a tab → *Open to the Right*. The two tabs shown side by side are framed together in the tab bar and move as one when you drag them. Drag the divider to resize; double-click it to reset.
- **Hot exit**: quit at any time. Tabs, unsaved edits and untitled documents come back on the next launch.
- If a file changes in another program, a clean tab reloads by itself; with unsaved edits a banner lets you choose.

## Markdown and HTML

- Formatted editing: select text for a floating toolbar, type `/` for blocks, or use Markdown shortcuts (`## `, `- `, `> `, `**bold**`). The formatting bar under the tabs can be hidden in the View menu.
- HTML files open in a **preview** (scripts don't run in it).
- **⌘/** (Ctrl+/) switches between the formatted view or preview and the **source**. The status bar button does the same.

## Code

- Highlighting for JavaScript, HTML, CSV, log files, PowerShell, Perl, shell, batch (cmd/bat), INI, YAML, JSON, SQL (ANSI, PostgreSQL, T-SQL), Markdown and plain text. Change the language in the status bar.
- **Format Document**: **⇧⌥F** (Shift+Alt+F). JavaScript, HTML, JSON, YAML, Markdown, INI and SQL are built in; shell, Perl and PowerShell use `shfmt`, `perltidy` and `PSScriptAnalyzer` when they are installed.
- **Find**: **⌘F** (Ctrl+F).

## Column (block) selection

Select a rectangle of text across several lines, for example one column of a CSV or log file. Then type, delete, copy or paste on every line at once.

| | macOS | Windows / Linux |
|---|---|---|
| Mouse | **Option + drag** | **Alt + drag** |
| Keyboard | **⇧⌥⌘ + arrow keys** | **Shift+Alt + arrow keys** (or Ctrl+Shift+Alt + arrow keys) |
| Extend by a page | ⇧⌥⌘ + Page Up/Down | Shift+Alt + Page Up/Down |
| Add a cursor above/below | ⌥⌘↑ / ⌥⌘↓ | Ctrl+Alt+↑ / ↓ |
| Back to one cursor | Esc | Esc |

- The pointer turns into a crosshair while Option/Alt is held.
- Columns count tabs to the next tab stop, so the block stays rectangular. Lines that are too short get a cursor at their end.
- Pasting text with as many lines as there are cursors puts one line at each cursor.
- Column selection works in code and plain-text views. For Markdown, switch to the source view (⌘/) first.

## Encodings

- Files are read and saved as **UTF-8** by default.
- A byte order mark (BOM) is recognised: UTF-8 with BOM, UTF-16 LE and UTF-16 BE files open correctly and keep their BOM.
- A file that isn't valid UTF-8 opens as **Western (Windows-1252 / ISO-8859-1)**, and a message tells you so.
- To change it: **File → Encoding…**, right-click the tab → **Encoding**, or click the encoding in the status bar. The status bar only shows the encoding when it isn't plain UTF-8.
  - **Reopen with Encoding** reads the file again as Western, Central European, Cyrillic, Greek, Turkish, Baltic, Hebrew, Arabic, Thai, Vietnamese, Japanese, Chinese, Korean, UTF-16 and more. This fixes text that shows the wrong characters.
  - **Save with Encoding** saves the file in another encoding. If a character can't be stored in that encoding, nothing is saved and you are told which characters are the problem.
  - **UTF-8 with BOM** turns the byte order mark on or off.
- If some bytes can't be read in the chosen encoding, they show as **�** and the status bar turns red. Saving then asks first, because those bytes would be replaced.

## Git repositories

- **File → Open Repository…** (⇧⌘O) opens any folder inside a git repository. Its files are listed in the sidebar.
- **Hide or show the sidebar** with the button at its top right, the button at the left of the status bar, or **⇧⌘E** (Ctrl+Shift+E).
- **Saving commits and pushes** the saved file. Turn this off under View → *Auto Commit & Push on Save*.
- **Branches**: click the repository name in the sidebar, or the branch name in the status bar, to switch branch, create a new one, or open a pull request. Branches that only exist on the server are under *Remote Branches*.
- **Protected branches**: if the server doesn't accept pushes to `main`/`master`, Notepad offers to move your unpushed commits to a new branch, push it, and open a pull request. Nothing is lost either way.
- Conflicting changes from the server are never applied: your commits stay local and the status bar shows a warning.
- **File → Git Accounts…** manages sign-ins (token or browser sign-in). Only HTTPS remotes are supported.

## CSV, log and big files

- In CSV files every column keeps its own colour on every line, and the header line is bold. In log files the leading columns (time, level, thread, logger…) are coloured, and error and warning lines are tinted.
- Files over 4 MB load in the background with a progress bar in the tab. Notepad opens files up to 512 MB.

## Appearance

The theme follows the system; choose Light or Dark under **View → Theme**.
