//! Notepad backend: file I/O, session/buffer persistence ("hot exit"),
//! native menus, OS file-open events and optional external formatters.

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

// Only release builds use it (see run()).
#[cfg(debug_assertions)]
use tauri_plugin_single_instance as _;

mod cli;
mod creds;
mod db;
mod files;
mod git_cmds;
mod gitops;
mod oauth;
mod provider;
mod update;
#[cfg(test)]
mod git_tests;

/// Files the OS asked us to open before the frontend was ready to receive them.
#[derive(Default)]
struct PendingOpen(Mutex<Vec<OpenRequest>>);

/// A file another program (or the command line) asked to open.
#[derive(Serialize, Clone, Debug, PartialEq)]
struct OpenRequest {
    path: String,
    /// `--preview`: in the preview tab, which the next preview replaces.
    preview: bool,
}

/// Set once the frontend has flushed the session and confirmed it is safe to quit.
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
struct FileStat {
    size: u64,
    mtime: Option<u64>,
}

fn mtime_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as u64)
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("buffers")).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Buffer ids come from the frontend; only allow simple names so they can't escape the folder.
fn buffer_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(format!("invalid buffer id: {id}"));
    }
    Ok(data_dir(app)?.join("buffers").join(format!("{id}.txt")))
}

// ---------- files ----------

#[tauri::command]
fn file_stat(path: String) -> Result<FileStat, String> {
    let meta = fs::metadata(&path).map_err(|e| format!("{path}: {e}"))?;
    if meta.is_dir() {
        return Err(format!("{path} is a folder"));
    }
    Ok(FileStat { size: meta.len(), mtime: mtime_ms(Path::new(&path)) })
}

/// Reads up to `len` bytes from `offset`, as raw bytes (an ArrayBuffer in the frontend, no JSON).
/// Files are read in chunks like this so big files load with a progress bar and never block the app.
#[tauri::command]
fn read_file_range(path: String, offset: u64, len: u64) -> Result<tauri::ipc::Response, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = fs::File::open(&path).map_err(|e| format!("{path}: {e}"))?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| format!("{path}: {e}"))?;
    let mut buf = Vec::with_capacity(len.min(64 << 20) as usize);
    f.take(len).read_to_end(&mut buf).map_err(|e| format!("{path}: {e}"))?;
    Ok(tauri::ipc::Response::new(buf))
}

/// Image types a Markdown document may show from disk.
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "apng"];

/// Lets the webview show one image file through the asset protocol (Markdown images with relative paths). Only
/// existing files with an image extension: the scope starts empty, so nothing else on disk becomes readable.
fn is_image_file(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    matches!(ext, Some(e) if IMAGE_EXTS.contains(&e.as_str())) && path.is_file()
}

#[tauri::command]
fn allow_image(app: AppHandle, path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !p.is_absolute() || !is_image_file(p) {
        return Err(format!("not an image file: {path}"));
    }
    app.asset_protocol_scope().allow_file(p).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Text → bytes in `encoding` (a WHATWG label such as "utf-8", "windows-1252", "utf-16le", "shift_jis").
/// Refuses characters the encoding can't represent rather than writing a damaged file.
fn encode_text(content: &str, encoding: &str, bom: bool) -> Result<Vec<u8>, String> {
    let label = encoding.trim().to_ascii_lowercase();
    let mut data = Vec::with_capacity(content.len() + 3);
    match label.as_str() {
        "" | "utf-8" | "utf8" => {
            if bom {
                data.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
            }
            data.extend_from_slice(content.as_bytes());
        }
        // encoding_rs only decodes UTF-16, so encode it here. UTF-16 files normally start with a BOM.
        "utf-16le" | "utf-16" | "utf-16be" => {
            let be = label == "utf-16be";
            if bom {
                data.extend_from_slice(if be { &[0xFE, 0xFF] } else { &[0xFF, 0xFE] });
            }
            for unit in content.encode_utf16() {
                data.extend_from_slice(&if be { unit.to_be_bytes() } else { unit.to_le_bytes() });
            }
        }
        _ => {
            let enc = encoding_rs::Encoding::for_label(label.as_bytes()).ok_or(format!("Unknown encoding {encoding}"))?;
            let (bytes, _, unmappable) = enc.encode(content);
            if unmappable {
                let bad: String = content
                    .chars()
                    .filter(|c| enc.encode(&c.to_string()).2)
                    .take(5)
                    .collect();
                return Err(format!(
                    "Some characters ({bad}) can't be saved as {}. Save with UTF-8 instead (status bar or tab menu → Encoding).",
                    enc.name()
                ));
            }
            data.extend_from_slice(&bytes);
        }
    }
    Ok(data)
}

/// Writes in place (rather than temp + rename) so file permissions such as +x are kept.
#[tauri::command]
fn write_file(path: String, content: String, bom: bool, encoding: Option<String>) -> Result<Option<u64>, String> {
    let data = encode_text(&content, encoding.as_deref().unwrap_or("utf-8"), bom)?;
    fs::write(&path, data).map_err(|e| format!("{path}: {e}"))?;
    Ok(mtime_ms(Path::new(&path)))
}

#[tauri::command]
fn file_mtime(path: String) -> Option<u64> {
    mtime_ms(Path::new(&path))
}

// ---------- session, settings and buffers ----------

#[tauri::command]
fn load_state(app: AppHandle, name: String) -> Result<Option<String>, String> {
    if name != "session" && name != "settings" {
        return Err("unknown state file".into());
    }
    let p = data_dir(&app)?.join(format!("{name}.json"));
    Ok(fs::read_to_string(p).ok())
}

/// Atomic write (temp + rename) so a crash mid-write never corrupts the session.
#[tauri::command]
fn save_state(app: AppHandle, name: String, json: String) -> Result<(), String> {
    #[cfg(debug_assertions)]
    eprintln!("[notepad] save_state {name} ({} bytes)", json.len());
    if name != "session" && name != "settings" {
        return Err("unknown state file".into());
    }
    let dir = data_dir(&app)?;
    let tmp = dir.join(format!("{name}.json.tmp"));
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join(format!("{name}.json"))).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_buffer(app: AppHandle, id: String, content: String) -> Result<(), String> {
    fs::write(buffer_path(&app, &id)?, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_buffer(app: AppHandle, id: String) -> Result<Option<String>, String> {
    Ok(fs::read_to_string(buffer_path(&app, &id)?).ok())
}

/// Deletes every stored buffer that is not in `keep`.
#[tauri::command]
fn prune_buffers(app: AppHandle, keep: Vec<String>) -> Result<(), String> {
    let dir = data_dir(&app)?.join("buffers");
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let id = name.trim_end_matches(".txt");
        if !keep.iter().any(|k| k == id) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

// ---------- OS integration ----------

#[tauri::command]
fn take_pending_open(state: State<PendingOpen>) -> Vec<OpenRequest> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    #[cfg(debug_assertions)]
    eprintln!("[notepad] quit_app");
    QUIT_CONFIRMED.store(true, Ordering::SeqCst);
    let _ = app.save_window_state(window_state_flags());
    app.exit(0);
}

// ---------- external formatters ----------

/// GUI apps on macOS don't inherit the shell PATH, so add the usual tool locations.
fn tool_path() -> String {
    let mut parts: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(if cfg!(windows) { ';' } else { ':' })
        .map(String::from)
        .collect();
    if !cfg!(windows) {
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"] {
            if !parts.iter().any(|p| p == extra) {
                parts.push(extra.into());
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            parts.push(format!("{home}/go/bin"));
            parts.push(format!("{home}/.local/bin"));
        }
    }
    parts.join(if cfg!(windows) { ";" } else { ":" })
}

/// Runs one of a fixed set of formatters, feeding the document on stdin.
#[tauri::command]
fn format_external(tool: String, input: String, indent: u8) -> Result<String, String> {
    let indent_s = indent.to_string();
    let (program, args): (&str, Vec<&str>) = match tool.as_str() {
        "shfmt" => ("shfmt", vec!["-i", &indent_s, "-ci"]),
        "perltidy" => ("perltidy", vec!["-st", "-se", "-q"]),
        "pwsh" => (
            "pwsh",
            vec![
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$PSStyle.OutputRendering = 'PlainText'; Invoke-Formatter -ScriptDefinition ([Console]::In.ReadToEnd())",
            ],
        ),
        _ => return Err(format!("unknown formatter: {tool}")),
    };
    let mut child = Command::new(program)
        .args(&args)
        .env("PATH", tool_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                let hint = match tool.as_str() {
                    "shfmt" => "Install it with `brew install shfmt` (or your package manager).",
                    "perltidy" => "Install it with `brew install perltidy` or `cpan Perl::Tidy`.",
                    _ => "Install PowerShell 7 and run `Install-Module PSScriptAnalyzer`.",
                };
                format!("{program} was not found. {hint}")
            } else {
                e.to_string()
            }
        })?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(input.as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
        // pwsh prints the formatted script with a trailing newline of its own; normalise.
        if tool == "pwsh" && s.ends_with("\r\n") {
            s.truncate(s.len() - 2);
            s.push('\n');
        }
        Ok(s)
    } else {
        let err = strip_ansi(&String::from_utf8_lossy(&out.stderr));
        if tool == "pwsh" && err.contains("Invoke-Formatter") && err.contains("not recognized") {
            return Err("PowerShell formatting needs PSScriptAnalyzer. Run `Install-Module PSScriptAnalyzer` in pwsh.".into());
        }
        Err(err.lines().next().unwrap_or("formatter failed").trim().to_string())
    }
}

/// Removes terminal colour codes (ESC [ … letter) from tool output.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_existing_image_files_are_allowed() {
        let d = std::env::temp_dir().join(format!("notepad-img-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("a.PNG"), "x").unwrap();
        std::fs::write(d.join("id_rsa"), "x").unwrap();
        assert!(is_image_file(&d.join("a.PNG")));
        assert!(!is_image_file(&d.join("id_rsa")));
        assert!(!is_image_file(&d.join("missing.png")));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn files_from_args_resolves_and_filters() {
        let d = std::env::temp_dir().join(format!("notepad-args-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("a.md"), "a").unwrap();
        let abs = d.join("a.md").to_string_lossy().into_owned();
        let got = files_from_args(
            ["a.md".to_string(), "--flag".into(), "missing.md".into(), abs.clone(), "-psn_0_123".into(), "nodir/x.md".into(), ".".into()],
            &d,
        );
        let missing = d.join("missing.md").to_string_lossy().into_owned();
        let req = |path: &str, preview| OpenRequest { path: path.to_string(), preview };
        assert_eq!(got, vec![req(&abs, false), req(&missing, false), req(&abs, false)]);
        // --preview, before or after the file; only for a single file.
        let args = |a: &[&str]| files_from_args(a.iter().map(|s| s.to_string()), &d);
        assert_eq!(args(&["--preview", "a.md"]), vec![req(&abs, true)]);
        assert_eq!(args(&["a.md", "--preview"]), vec![req(&abs, true)]);
        assert_eq!(args(&["--preview", "a.md", "missing.md"]), vec![req(&abs, false), req(&missing, false)]);
        assert_eq!(args(&["--preview"]), vec![]);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn strips_ansi_codes() {
        assert_eq!(strip_ansi("\u{1b}[31;1mError:\u{1b}[0m bad"), "Error: bad");
    }

    #[test]
    fn rejects_unknown_formatter() {
        assert!(format_external("rm".into(), String::new(), 2).is_err());
    }

    #[test]
    fn encodes_text_in_the_chosen_encoding() {
        assert_eq!(encode_text("æøå", "utf-8", true).unwrap(), b"\xEF\xBB\xBF\xC3\xA6\xC3\xB8\xC3\xA5");
        assert_eq!(encode_text("æøå€", "windows-1252", false).unwrap(), b"\xE6\xF8\xE5\x80");
        assert_eq!(encode_text("æ", "iso-8859-1", false).unwrap(), b"\xE6");
        assert_eq!(encode_text("Aæ", "utf-16le", true).unwrap(), b"\xFF\xFE\x41\x00\xE6\x00");
        assert_eq!(encode_text("A", "utf-16be", true).unwrap(), b"\xFE\xFF\x00\x41");
        assert_eq!(encode_text("日本", "shift_jis", false).unwrap(), b"\x93\xFA\x96\x7B");
        let err = encode_text("a 日 b", "windows-1252", false).unwrap_err();
        assert!(err.contains('日'), "{err}");
        assert!(encode_text("x", "no-such-encoding", false).is_err());
    }

    #[test]
    fn pwsh_reports_missing_module_or_formats() {
        if Command::new("pwsh").arg("-v").output().is_err() {
            return; // pwsh not installed here
        }
        match format_external("pwsh".into(), "function x{\nWrite-Host 'a'\n}\n".into(), 4) {
            Ok(out) => assert!(out.contains("Write-Host")),
            Err(e) => assert!(e.contains("PSScriptAnalyzer"), "unexpected error: {e}"),
        }
    }
}

// ---------- menu ----------

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, text: &str, accel: Option<&str>| {
        MenuItem::with_id(app, id, text, true, accel)
    };

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("new", "New", Some("CmdOrCtrl+N"))?,
            &item("new_of_type", "New File of Type…", Some("CmdOrCtrl+Shift+N"))?,
            &item("open", "Open…", Some("CmdOrCtrl+O"))?,
            &item("open_folder", "Open Folder…", Some("Alt+CmdOrCtrl+O"))?,
            &item("new_database", "New Database…", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("open_repo", "Open Repository…", Some("CmdOrCtrl+Shift+O"))?,
            &item("clone_repo", "Clone Repository…", None)?,
            &item("new_repo", "New Private Repository…", None)?,
            &item("sync_repo", "Sync Repository", None)?,
            &item("switch_branch", "Switch Branch…", None)?,
            &item("new_branch", "New Branch…", None)?,
            &item("git_accounts", "Git Accounts…", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("save", "Save", Some("CmdOrCtrl+S"))?,
            &item("save_as", "Save As…", Some("CmdOrCtrl+Shift+S"))?,
            &item("encoding", "Encoding…", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("close_tab", "Close Tab", Some("CmdOrCtrl+W"))?,
        ],
    )?;
    #[cfg(not(target_os = "macos"))]
    {
        file.append(&PredefinedMenuItem::separator(app)?)?;
        file.append(&item("quit", "Exit", Some("CmdOrCtrl+Q"))?)?;
    }

    // Find shortcuts follow each OS: macOS ⌥⌘F replace, ⌘G/⇧⌘G next/previous, ⌘E use selection;
    // Windows/Linux Ctrl+H replace, F3/Shift+F3 next/previous.
    let mac = cfg!(target_os = "macos");
    let find_menu = Submenu::with_items(
        app,
        "Find",
        true,
        &[
            &item("find", "Find…", Some("CmdOrCtrl+F"))?,
            &item("find_replace", "Find and Replace…", Some(if mac { "Alt+Cmd+F" } else { "Ctrl+H" }))?,
            &item("find_next", "Find Next", Some(if mac { "Cmd+G" } else { "F3" }))?,
            &item("find_prev", "Find Previous", Some(if mac { "Shift+Cmd+G" } else { "Shift+F3" }))?,
            &item("find_selection", "Use Selection for Find", if mac { Some("Cmd+E") } else { None })?,
        ],
    )?;

    // The predefined clipboard items are required on macOS for copy/paste to work in the webview.
    // Macros like Notepad++ (editors/macro.tsx). Ctrl+Shift+R / Ctrl+Shift+P as there; ⇧⌘R / ⇧⌘P on macOS.
    let macro_menu = Submenu::with_items(
        app,
        "Macro",
        true,
        &[
            &item("macro_record", "Start/Stop Recording", Some("CmdOrCtrl+Shift+R"))?,
            &item("macro_play", "Play", Some("CmdOrCtrl+Shift+P"))?,
            &item("macro_macros", "Run Multiple Times / Saved Macros…", None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &find_menu,
            &item("select_column", "Select Column (CSV, Log)", Some("Ctrl+Space"))?,
            &item("format", "Format Document", Some("Shift+Alt+F"))?,
            &PredefinedMenuItem::separator(app)?,
            &macro_menu,
        ],
    )?;

    let theme = Submenu::with_items(
        app,
        "Theme",
        true,
        &[
            &item("theme_system", "Follow System", None)?,
            &item("theme_light", "Light", None)?,
            &item("theme_dark", "Dark", None)?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("toggle_source", "Toggle Source View", Some("CmdOrCtrl+/"))?,
            &item("toggle_format_bar", "Show/Hide Formatting Bar", None)?,
            &item("close_split", "Close Split View", None)?,
            &item("toggle_sidebar", "Show/Hide Sidebar", Some("CmdOrCtrl+Shift+E"))?,
            &item("toggle_autocommit", "Auto Commit & Push on Save (On/Off)", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("next_tab", "Next Tab        Ctrl+Tab", None)?,
            &item("prev_tab", "Previous Tab    Ctrl+Shift+Tab", None)?,
            &PredefinedMenuItem::separator(app)?,
            &theme,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &item("help", "Notepad Help", None)?,
            &item("shortcuts", "Keyboard Shortcuts", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item("check_updates", "Check for Updates…", None)?,
        ],
    )?;
    #[cfg(not(target_os = "macos"))]
    {
        help.append(&PredefinedMenuItem::separator(app)?)?;
        help.append(&item("about", "About Notepad", None)?)?;
    }

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "Notepad",
            true,
            &[
                &item("about", "About Notepad", None)?,
                &PredefinedMenuItem::separator(app)?,
                &item("install_cli", "Install Command Line Tool…", None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                // Custom quit so the frontend can flush the session first.
                &item("quit", "Quit Notepad", Some("CmdOrCtrl+Q"))?,
            ],
        )?;
        Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
    }
    #[cfg(not(target_os = "macos"))]
    Menu::with_items(app, &[&file, &edit, &view, &window, &help])
}

/// The files among command-line arguments (options skipped), as absolute paths. Relative ones are resolved against
/// `cwd`: for a second launch that is the folder it was started in, not the running app's.
/// `--preview` opens a single file in the preview tab (several files open as normal tabs).
fn files_from_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<OpenRequest> {
    let args: Vec<String> = args.into_iter().collect();
    let preview = args.iter().any(|a| a == "--preview");
    let mut files: Vec<OpenRequest> = args
        .into_iter()
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(a)) // join keeps an absolute path as it is
        // A file that doesn't exist yet (`notepad new.md`) opens as an empty tab that saving creates; its folder must exist.
        .filter(|p| p.is_file() || (!p.exists() && p.parent().is_some_and(|d| d.is_dir())))
        .map(|p| OpenRequest { path: p.to_string_lossy().into_owned(), preview: false })
        .collect();
    if let [file] = files.as_mut_slice() {
        file.preview = preview;
    }
    files
}

/// Restore size, position and maximised state, but not visibility: the window
/// stays hidden until the frontend has painted (see main.tsx).
fn window_state_flags() -> StateFlags {
    StateFlags::all() & !StateFlags::VISIBLE
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows/Linux pass files to open as command-line arguments.
    let cwd = std::env::current_dir().unwrap_or_default();
    let cli_files = files_from_args(std::env::args().skip(1), &cwd);

    let builder = tauri::Builder::default();
    // Must come first: a second launch (opening a file from Explorer, the command line…) hands its files to the
    // running Notepad and exits, instead of starting a second app with its own session. Release builds only, so a
    // dev build can run next to the installed app.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let files = files_from_args(argv.into_iter().skip(1), Path::new(&cwd));
            if !files.is_empty() {
                app.state::<PendingOpen>().0.lock().unwrap().extend(files);
                let _ = app.emit("open-files", ());
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    let app = builder
        .plugin(tauri_plugin_dialog::init())
        // Updates from GitHub Releases (latest.json, signed with the updater key; see scripts/updater-manifest.mjs).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .build(),
        )
        .manage(PendingOpen(Mutex::new(cli_files)))
        .manage(update::Pending::default())
        .menu(|app| build_menu(app))
        .setup(|app| {
            // Windows: WebView2 keeps browser shortcuts for itself (Ctrl+N / Ctrl+Shift+N open a browser window, F5 and
            // Ctrl+R reload the page and lose state, Ctrl+P prints), so Notepad's own shortcuts never fire. Turn them off.
            #[cfg(windows)]
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.with_webview(|wv| unsafe {
                    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                    use windows::core::Interface;
                    if let Ok(core) = wv.controller().CoreWebView2() {
                        if let Ok(settings) = core.Settings() {
                            if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
                                let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
                            }
                        }
                    }
                });
            }
            // Safety net: the frontend shows the window after its first render. If that
            // never happens (a startup error), show it anyway rather than run invisibly.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                if let Some(w) = handle.get_webview_window("main") {
                    if !w.is_visible().unwrap_or(true) {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|_window, event| {
            // The frontend already saved in its close handler; the webview is gone, so
            // the exit hook below must not wait for it.
            if let tauri::WindowEvent::Destroyed = event {
                QUIT_CONFIRMED.store(true, Ordering::SeqCst);
            }
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.as_str());
        })
        .invoke_handler(tauri::generate_handler![
            file_stat,
            read_file_range,
            write_file,
            file_mtime,
            load_state,
            save_state,
            write_buffer,
            read_buffer,
            prune_buffers,
            take_pending_open,
            allow_image,
            quit_app,
            format_external,
            git_cmds::fs_list_dir,
            git_cmds::fs_create_file,
            git_cmds::fs_create_dir,
            git_cmds::git_path_info,
            git_cmds::fs_trash,
            git_cmds::git_commit_removal,
            git_cmds::git_open,
            git_cmds::git_info,
            git_cmds::git_list_dir,
            git_cmds::git_commit_file,
            git_cmds::git_sync,
            git_cmds::git_clone,
            git_cmds::git_branches,
            git_cmds::git_switch_branch,
            git_cmds::git_create_branch,
            git_cmds::git_move_to_branch,
            git_cmds::git_create_repo,
            git_cmds::cred_save_pat,
            git_cmds::cred_delete,
            git_cmds::cred_exists,
            git_cmds::open_external,
            git_cmds::oauth_redirect_uri,
            git_cmds::oauth_device_start,
            git_cmds::oauth_device_poll,
            git_cmds::oauth_login,
            cli::install_cli,
            update::update_check,
            update::update_install,
            db::db_probe,
            db::db_schema,
            db::db_run,
            db::db_interrupt,
            db::db_create,
            db::db_copy
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| match event {
        // Quitting (Cmd+Q from the Dock, OS shutdown…) — let the frontend save first.
        RunEvent::ExitRequested { api, code, .. } => {
            #[cfg(debug_assertions)]
            eprintln!(
                "[notepad] exit requested code={code:?} confirmed={}",
                QUIT_CONFIRMED.load(Ordering::SeqCst)
            );
            if code.is_none() && !QUIT_CONFIRMED.load(Ordering::SeqCst) {
                if app.get_webview_window("main").is_some() {
                    api.prevent_exit();
                    let _ = app.emit("menu", "quit");
                }
            }
        }
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        RunEvent::Opened { urls } => {
            let paths: Vec<OpenRequest> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| OpenRequest { path: p.to_string_lossy().into_owned(), preview: false })
                .collect();
            app.state::<PendingOpen>().0.lock().unwrap().extend(paths);
            // The frontend responds by calling take_pending_open.
            let _ = app.emit("open-files", ());
        }
        _ => {}
    });
}
