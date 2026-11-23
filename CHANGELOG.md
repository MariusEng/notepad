# Changelog

The main changes in each version, newest first.

## 0.19.1 — 2026-11-23

0.18.1 and 0.19.0 weren't published (the macOS build failed), so this is the first version with:

- **Macros**, as in Notepad++: Edit → Macro → Start/Stop Recording (⇧⌘R · Ctrl+Shift+R), do an edit once, then Play it (⇧⌘P · Ctrl+Shift+P), run it a number of times or until the end of the file, and save it with a name.
- macOS: Notepad is signed with its own certificate, so after this update you allow keychain access one last time; later updates don't ask again.

## 0.19.0 — 2026-11-23

- **Macros**, as in Notepad++: Edit → Macro → Start/Stop Recording (⇧⌘R · Ctrl+Shift+R), do an edit once, then Play it (⇧⌘P · Ctrl+Shift+P), run it a number of times or until the end of the file, and save it with a name.

## 0.18.1 — 2026-11-23

- macOS: Notepad is now signed with its own certificate, so after this update you allow keychain access one last time; later updates don't ask again.

## 0.18.0 — 2026-11-23

- **Extended search**, as in Notepad++: turn on **\\n** in the find panel and use `\n` (line break), `\t` (tab), `\r`, `\0`, `\xNN` and `\uNNNN` in Find and Replace, e.g. replace tabs with commas, or split a list onto separate lines. Normal search now finds exactly what you type.

## 0.17.1 — 2026-11-23

- Updates now come from GitHub Releases.

## 0.17.0 — 2026-11-23

- **Updates**: Help → Check for Updates…, and Notepad looks for a new version by itself once a day ("Update to …" in the status bar). Install and Restart downloads, checks and installs it, and your tabs come back.
- On macOS, updated versions no longer need "Open Anyway" in System Settings: install this version by hand once more, and later versions come through the app.

## 0.16.3 — 2026-11-23

- GitHub only accepts changes that come from git.1011.no, so pull requests can't be merged there by mistake.

## 0.16.2 — 2026-11-23

- Pull requests on GitHub are now tested automatically on git.1011.no before they are merged.

## 0.16.1 — 2026-11-23

- Notepad is also on GitHub: [github.com/MariusEng/notepad](https://github.com/MariusEng/notepad), with the same downloads under Releases.
- Notepad is open source under the MIT license.

## 0.16.0 — 2026-11-23

- **Open files from a terminal** on macOS: Notepad → Install Command Line Tool… adds the `notepad` command, so `notepad file.txt` opens the file in Notepad. A file that doesn't exist yet opens as a new, empty tab, and saving creates it.

## 0.15.0 — 2026-11-23

- **SQLite databases**: open `.sqlite` and `.db` files (or any SQLite file) in a tab with their tables and views, a SQL editor that completes table and column names, and a results grid. ⌘↵ (Ctrl+Enter) runs the SQL or the selected part; Stop cancels a long query; Open as CSV copies the results to a new tab.
- **File → New Database…** creates an empty database, and **New Table…** creates a table from a list of columns (type, key, required, unique, default) or as SQL you can edit first.
- Right-click a table to insert a SELECT, copy its CREATE statement or drop it. Save As writes a compact copy of the database.

## 0.14.1 — 2026-11-22

- The download page on deling.1011.no now shows the whole changelog, not just the latest changes.

## 0.14.0 — 2026-11-22

- **Preview tabs**: a single click on a file in the sidebar opens it as a preview (italic title) that the next click replaces, so browsing doesn't fill the tab bar. Double-click a file, or its tab, to keep it open. Editing a preview keeps it too.

## 0.13.3 — 2026-11-22

- **Help → Keyboard Shortcuts**: every shortcut for macOS and Windows/Linux in one list, including column selection and Ctrl+Space column select in CSV and log files.

## 0.13.2 — 2026-11-22

- macOS: a downloaded Notepad no longer says it is "damaged". The first time, open it via System Settings → Privacy & Security → Open Anyway.

## 0.13.0 — 2026-11-22

- **XML**: syntax highlighting, Format Document (pretty-print) and file types such as .xml, .xsd, .xslt, .svg, .plist, .csproj and .config.
- **JSON and XML are checked while you type**: mistakes are underlined with an explanation, and the status bar says "Valid JSON" / "Valid XML" or how many errors there are (click to jump to the first).
- **Tree view** for JSON and XML: click View in the status bar (or ⌘/ · Ctrl+/) to expand and collapse the document.
- Format JSON keeps every digit of big numbers, the order of keys and comments in JSONC files.

## 0.12.6 — 2026-11-22

- Windows: signing in to a git server with the browser works (the sign-in was too long for Windows' credential store).
- The Forgejo / Gitea sign-in no longer suggests a particular server.

## 0.12.1 — 2026-11-22

- Windows: Ctrl+N and Ctrl+Shift+N work, and F5 / Ctrl+R no longer reload the app.

## 0.12.0 — 2026-11-22

- First release with downloads for macOS, Windows and Linux, built automatically and published here and on git.1011.no.

## 0.11.0 — 2026-11-22

- Opening a file while Notepad is running opens it in the running app instead of starting a second one.
- Images with relative paths in Markdown (`![](images/photo.png)`) show in the formatted view.

## 0.10.0 — 2026-11-22

- Right-click a file or folder in the sidebar → **Move to Trash** (in a git repository the deletion is also committed and pushed).
- Lighter on memory: saved files in tabs you aren't looking at free their text and reload it when you come back.

## 0.9.0 — 2026-11-22

- **Folder browser** in the sidebar next to the git repository.
- Right-click in the sidebar → **New File** / **New Folder**.
- Tabs of files that are in a git repository get a mark, so you know not to put secrets in them.

## 0.8.0 — 2026-11-20

- **Find and replace** with match count, case / whole word / regular expressions and find in selection.
- CSV and log files: select a whole column (Ctrl+Space or Alt+double-click).
- Save As asks for the file type first; HTML has a Preview / Source button.

## 0.7.0 — 2026-11-20

- **Column (block) selection** with the mouse (Alt/Option+drag) and the keyboard.
- File encodings: open, reopen and save with another encoding (UTF-8, UTF-16, Windows-1252 and more), with or without BOM.

## 0.6.0 — 2026-11-20

- Drag tabs to reorder them; git branches (switch, create, pull request when the server refuses a push).
- JavaScript and HTML (with a preview), CSV and log files with a colour per column.
- Very large files open without freezing, with progress in the tab. Help and About.

## 0.5.0 — 2026-11-20

- One-click browser sign-in for Forgejo/Gitea and GitHub.

## 0.4.0 — 2026-11-20

- **Git repositories**: a file tree in the sidebar, and saving commits and pushes. Create a private repository or clone one.

## 0.3.0 — 2026-11-20

- **Split view**: show two files side by side.

## 0.2.0 — 2026-11-20

- New file of a chosen type (⇧⌘N · Ctrl+Shift+N), change a tab's file type, SQL support, formatting bar.

## 0.1.0 — 2026-11-20

- First version: tabs, formatted Markdown editing saved as plain .md, highlighting for many languages, Format Document, light and dark theme, and nothing is ever lost when you quit.
