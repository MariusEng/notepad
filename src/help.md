# Notepad Help

All keyboard shortcuts are listed under **Help → Keyboard Shortcuts**.

A minimal notepad. Markdown is the default: you edit formatted text and the file on disk stays plain `.md`.

## Documents and tabs

- **⌘N** (Ctrl+N) opens a new Markdown document. **⇧⌘N** (Ctrl+Shift+N) asks for the file type first.
- **Drag tabs** to reorder them. Middle-click closes a tab. Right-click a tab for more: Open to the Right, Close Others, File Type, Copy Path.
- Switch tabs with **Ctrl+Tab** / **Ctrl+Shift+Tab**, or **⌘1–⌘8** (Ctrl+1–8), **⌘9** for the last tab.
- **Split view**: right-click a tab → *Open to the Right*. The two tabs shown side by side move to the right end of the tab bar, framed together, and stay there (also when you switch which file a pane shows). Drag the divider to resize; double-click it to reset.
- **One Notepad**: opening a file while Notepad is running (from Explorer, Finder or the command line) opens it as a tab in the running app.
- **From a terminal** (macOS): choose **Notepad → Install Command Line Tool…** once (it may ask for your password), then `notepad file.txt` opens the file, and `notepad` alone brings Notepad to the front. A file that doesn't exist yet opens as an empty tab, and saving creates it. On Linux the packages install the `notepad` command.
- **Hot exit**: quit at any time. Tabs, unsaved edits and untitled documents come back on the next launch.
- If a file changes in another program, a clean tab reloads by itself; with unsaved edits a banner lets you choose.
- **Light on memory**: a saved file in a tab you aren't looking at lets go of its text after 20 seconds and reads it again from disk when you come back (it may take a moment for a big file). Tabs with unsaved edits always keep their text.

## Markdown and HTML

- Formatted editing: select text for a floating toolbar, type `/` for blocks, or use Markdown shortcuts (`## `, `- `, `> `, `**bold**`). The formatting bar under the tabs can be hidden in the View menu.
- HTML files open in a **preview** (scripts don't run in it). While you edit the source, the status bar button says **Preview**; click it (or press ⌘/ · Ctrl+/) to see the page, and **Source** to go back.
- **⌘/** (Ctrl+/) switches Markdown between the formatted view and the **source**.
- **Images with relative paths** (`![](images/photo.png)`, `../shared/logo.svg`) show in the formatted view, read from the document's folder. The Markdown keeps the path as you wrote it. Saving commits only the document, so commit linked image files yourself. Pasted or dropped images are embedded in the file.
- Files stay plain Markdown: empty paragraphs in the formatted view aren't saved.

## Code

- Highlighting for JavaScript, HTML, CSV, log files, PowerShell, Perl, shell, batch (cmd/bat), INI, YAML, JSON, XML, SQL (ANSI, PostgreSQL, T-SQL), Markdown and plain text. Change the language in the status bar.
- **Format Document**: **⇧⌥F** (Shift+Alt+F). JavaScript, HTML, JSON, XML, YAML, Markdown, INI and SQL are built in (JSON keeps every digit of big numbers and any comments); shell, Perl and PowerShell use `shfmt`, `perltidy` and `PSScriptAnalyzer` when they are installed.
- **JSON and XML are checked while you type**: mistakes are underlined with a marker in the margin (hover for the explanation), and the status bar says *Valid JSON* / *Valid XML* or how many errors there are. Click it to jump to the first one. JSON with comments or trailing commas (like `tsconfig.json`) gets warnings, not errors.
- **Tree view for JSON and XML**: click **View** in the status bar (or press ⌘/ · Ctrl+/) to see the document as a tree you can expand and collapse; **Source** goes back to editing. Big lists show 200 entries at a time.
- **Save As…** (⇧⌘S · Ctrl+Shift+S) asks for the file type first (Enter keeps the current one), then where to save. Typing another known extension in the save dialog also works.

## Find and replace

| | macOS | Windows / Linux |
|---|---|---|
| Find | ⌘F | Ctrl+F |
| Find and replace | ⌥⌘F | Ctrl+H |
| Next / previous match | ⌘G / ⇧⌘G (or Enter / Shift+Enter in the find field) | F3 / Shift+F3 (or Enter / Shift+Enter) |
| Use selection for find | ⌘E | — |
| Select all matches (multiple cursors) | ⌥Enter in the find field | Alt+Enter in the find field |
| Replace / replace all | Enter / ⌘Enter in the replace field | Enter / Ctrl+Enter in the replace field |
| Close | Esc | Esc |

- **Aa** matches case, **ab** whole words.
- Three search modes, as in Notepad++:
  - **Normal** (both buttons off): finds exactly what you type.
  - **\\n Extended**: `\n` (line break), `\r`, `\t` (tab), `\0`, `\\` (backslash), `\xNN` and `\uNNNN` (any character by its code) work in both Find and Replace. For example, find `\t` and replace with `,` to turn tabs into commas, or find `,` and replace with `\n` to put every value on its own line. A search can span lines: `end\nstart`.
  - **.\*** Regular expressions: use `$1` in the replacement for groups; `\n` and `\t` work in the replacement too.
- **⌘E** (use selection for Find) with a selection over several lines or with tabs switches to Extended, so the find field shows it as `\n` and `\t`.
- **Find in selection** (the button with lines, right of the arrows) limits finding and replacing to the text that was selected, for example a column. It turns on by itself when you open Find with a selection over several lines.
- The count shows which match is selected and how many there are.
- In formatted Markdown and the HTML preview, Find switches to the source first.

## Macros

Repeat an edit as often as you like, as in Notepad++:

1. **Edit → Macro → Start/Stop Recording** (**⇧⌘R** · Ctrl+Shift+R). The status bar shows **● Recording macro**.
2. Do the edit once: type, use Enter, Backspace, Delete, the arrow keys, Home/End, Tab, keys with ⌘/Ctrl or Option/Alt, Find Next and Replace, copy, cut, paste and undo.
3. Stop with the same keys (or click the status bar).
4. **Play** it with **⇧⌘P** (Ctrl+Shift+P). **Edit → Macro → Run Multiple Times / Saved Macros…** runs it a number of times or **until the end of the file**, and saves it with a name so you can use it again later.

Tips:

- Start where the edit begins (e.g. at the start of a line) and end where the next one should begin (e.g. the start of the next line). Then "until the end of the file" does every line.
- "Until the end of the file" stops when the cursor reaches the end, or when a run doesn't bring it any closer to the end (for example on the last line, or when Find Next wraps around to the top).
- Paste in a macro pastes what the macro copied or cut earlier in the same run; otherwise the text pasted while recording.
- Mouse clicks aren't recorded. Macros work in code and plain-text files and in the source view of Markdown and HTML.
- A long run can be stopped by clicking **Playing macro…** in the status bar.

## Selecting CSV and log columns

- **Ctrl+Space** (on macOS too, as in Excel) selects the column the cursor is in, on every line. Or **Alt/Option + double-click** a field.
- Select across several fields first to select several columns at once.
- Select several lines first (or a block with Alt+drag) to select only that part of the column.
- Each line gets its own selection: copy gives one value per line, typing replaces the column on every line, and **Find and replace** with *Find in selection* changes values only in that column.
- Log files: the detected columns (time, level, thread…) plus the message as the last column.
- If Ctrl+Space switches your keyboard input source on macOS, use Edit → Select Column or Option + double-click.

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

## Sidebar: folders and repositories

- **File → Open Folder…** (⌥⌘O · Ctrl+Alt+O) adds folders to the sidebar; open as many as you like. Repositories are listed first, folders below. Click a name to **collapse or expand** it, **×** closes it (nothing is deleted).
- **Drag the sidebar's right edge** to resize it; double-click the edge for the default width.
- **Click a file** to preview it: its tab title is in *italics*, and clicking the next file replaces that tab, so browsing doesn't fill the tab bar. **Double-click** a file to open it for good (it stays when you click the next one). A preview tab also stays as soon as you edit it, or when you double-click its tab.
- **Right-click** a file or folder for **New File** (choose the type in the submenu) and **New Folder…** (created in the folder you clicked, or next to the file). Type the name and press Enter; Esc cancels. New files open in a tab. Right-click a section's name to create at the top level.
- **Delete**: right-click a file or folder → **Move to Trash…** (Windows/Linux: **Delete…**). It asks first and goes to the Trash (Recycle Bin), so it can be restored. In an open repository the deletion is also committed and pushed. Open tabs of deleted files close; a tab with unsaved edits stays open and says the file is gone.
- **Files in git are marked**: a tab whose file is in a git repository (and not ignored) shows an orange git mark, so you know not to put passwords or other secrets in it. Hover the mark to see which repository, and whether saving commits and pushes it. A folder that is inside a repository shows the same mark next to its name.

## Git repositories

- **File → Open Repository…** (⇧⌘O) opens any folder inside a git repository. Its files are listed at the top of the sidebar. Several repositories can be open: saving commits to the repository the file is in, and the status bar shows the repository of the active tab.
- **Hide or show the sidebar** with the button at its top right, the button at the left of the status bar, or **⇧⌘E** (Ctrl+Shift+E).
- **Saving commits and pushes** the saved file. Turn this off under View → *Auto Commit & Push on Save*.
- **Branches**: click the branch name in the sidebar or the status bar to switch branch, create a new one, or open a pull request. Branches that only exist on the server are under *Remote Branches*.
- **Protected branches**: if the server doesn't accept pushes to `main`/`master`, Notepad offers to move your unpushed commits to a new branch, push it, and open a pull request. Nothing is lost either way.
- Conflicting changes from the server are never applied: your commits stay local and the status bar shows a warning.
- **File → Git Accounts…** manages sign-ins (token or browser sign-in). Only HTTPS remotes are supported.

## SQLite databases

- **Open** an SQLite database like any file (File → Open, the sidebar, drag and drop). Notepad recognises it by its contents, whatever its extension (`.sqlite`, `.db`…).
- **File → New Database…** (or ⇧⌘N · Ctrl+Shift+N → *SQLite Database*) creates an empty database where you choose.
- The tab shows the **tables and views** on the left. Click one to see its rows; click ▸ to see its columns (the primary key is bold); right-click for Insert SELECT, Copy CREATE Statement, New Table… and Drop Table….
- **New Table…** (the **+** above the list): a name and its columns with type, key, required (NOT NULL), unique and a default value. The CREATE TABLE statement is shown as you go; **Edit as SQL** puts it in the query editor instead, for foreign keys and the like.
- **Query**: type SQL above the results and press **⌘↵** (Ctrl+Enter) or **▶ Run**. With a selection, only the selected part runs. Several statements separated by `;` run in order, and the results show the last one that returns rows. Table and column names complete as you type.
- Results show up to 1,000 rows (add `LIMIT`/`OFFSET` or a `WHERE` for others). `NULL` is shown in grey italics. **Open as CSV** puts the rows in a new CSV tab. A long query can be stopped with **Stop**.
- **Changes are written at once**: there is nothing to save. Each run is its own connection, so `BEGIN … COMMIT` works within one run, and a transaction left open at the end of a run is rolled back.
- **Save As…** writes a compact copy of the database and switches the tab to it. **Format Document** (⇧⌥F) formats the SQL in the query editor.
- A database file you can't write to opens **read-only**. Databases in a git repository aren't committed automatically (there is no save).

## CSV, log and big files

- In CSV files every column keeps its own colour on every line, and the header line is bold. In log files the leading columns (time, level, thread, logger…) are coloured, and error and warning lines are tinted.
- Files over 4 MB load in the background with a progress bar in the tab. Notepad opens files up to 512 MB.

## Updates

- **Help → Check for Updates…** looks for a new version. If there is one, you see what changed and can **Install and Restart**: Notepad downloads it, checks its signature, installs it and starts again with your tabs and unsaved changes.
- Notepad also checks by itself when it starts and once a day; a new version then shows as **Update to …** in the status bar. Turn this off with *Check for updates automatically* in the update window.
- On macOS, updates installed this way open without the "unverified developer" prompt, don't ask for keychain access, and keep Notepad on its pinned Dock icon.
- Linux: updates work for the AppImage and for the .deb and .rpm packages (installing a package asks for your password).

## Appearance

The theme follows the system; choose Light or Dark under **View → Theme**.
