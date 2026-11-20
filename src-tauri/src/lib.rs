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

/// Files the OS asked us to open before the frontend was ready to receive them.
#[derive(Default)]
struct PendingOpen(Mutex<Vec<String>>);

/// Set once the frontend has flushed the session and confirmed it is safe to quit.
static QUIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

#[derive(Serialize)]
struct FileData {
    content: String,
    /// The file started with a UTF-8 byte order mark; written back on save.
    bom: bool,
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
fn read_file(path: String) -> Result<FileData, String> {
    let bytes = fs::read(&path).map_err(|e| format!("{path}: {e}"))?;
    let bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
    let body = if bom { &bytes[3..] } else { &bytes[..] };
    Ok(FileData {
        content: String::from_utf8_lossy(body).into_owned(),
        bom,
        mtime: mtime_ms(Path::new(&path)),
    })
}

/// Writes in place (rather than temp + rename) so file permissions such as +x are kept.
#[tauri::command]
fn write_file(path: String, content: String, bom: bool) -> Result<Option<u64>, String> {
    let mut data = Vec::with_capacity(content.len() + 3);
    if bom {
        data.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    data.extend_from_slice(content.as_bytes());
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
fn take_pending_open(state: State<PendingOpen>) -> Vec<String> {
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
    fn strips_ansi_codes() {
        assert_eq!(strip_ansi("\u{1b}[31;1mError:\u{1b}[0m bad"), "Error: bad");
    }

    #[test]
    fn rejects_unknown_formatter() {
        assert!(format_external("rm".into(), String::new(), 2).is_err());
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
            &item("open", "Open…", Some("CmdOrCtrl+O"))?,
            &PredefinedMenuItem::separator(app)?,
            &item("save", "Save", Some("CmdOrCtrl+S"))?,
            &item("save_as", "Save As…", Some("CmdOrCtrl+Shift+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &item("close_tab", "Close Tab", Some("CmdOrCtrl+W"))?,
        ],
    )?;
    #[cfg(not(target_os = "macos"))]
    {
        file.append(&PredefinedMenuItem::separator(app)?)?;
        file.append(&item("quit", "Exit", Some("CmdOrCtrl+Q"))?)?;
    }

    // The predefined clipboard items are required on macOS for copy/paste to work in the webview.
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
            &item("find", "Find…", Some("CmdOrCtrl+F"))?,
            &item("format", "Format Document", Some("Shift+Alt+F"))?,
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
            &item("toggle_source", "Toggle Markdown Source", Some("CmdOrCtrl+/"))?,
            &item("toggle_format_bar", "Show/Hide Formatting Bar", None)?,
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

    #[cfg(target_os = "macos")]
    {
        let app_menu = Submenu::with_items(
            app,
            "Notepad",
            true,
            &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                // Custom quit so the frontend can flush the session first.
                &item("quit", "Quit Notepad", Some("CmdOrCtrl+Q"))?,
            ],
        )?;
        Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window])
    }
    #[cfg(not(target_os = "macos"))]
    Menu::with_items(app, &[&file, &edit, &view, &window])
}

/// Restore size, position and maximised state, but not visibility: the window
/// stays hidden until the frontend has painted (see main.tsx).
fn window_state_flags() -> StateFlags {
    StateFlags::all() & !StateFlags::VISIBLE
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows/Linux pass files to open as command-line arguments.
    let cli_files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-') && Path::new(a).is_file())
        .collect();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .build(),
        )
        .manage(PendingOpen(Mutex::new(cli_files)))
        .menu(|app| build_menu(app))
        .setup(|app| {
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
            read_file,
            write_file,
            file_mtime,
            load_state,
            save_state,
            write_buffer,
            read_buffer,
            prune_buffers,
            take_pending_open,
            quit_app,
            format_external
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
            let paths: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            app.state::<PendingOpen>().0.lock().unwrap().extend(paths);
            // The frontend responds by calling take_pending_open.
            let _ = app.emit("open-files", ());
        }
        _ => {}
    });
}
