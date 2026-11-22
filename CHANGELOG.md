# Changelog

The main changes in each version, newest first.

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
