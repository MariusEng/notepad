//! macOS: Notepad → Install Command Line Tool… puts a `notepad` command in /usr/local/bin (on the default PATH), so
//! `notepad file.txt` opens files from a terminal. It starts a new instance through Launch Services; the
//! single-instance plugin hands its files (resolved against the terminal's folder) to a Notepad that is already
//! running, or that instance becomes Notepad. The app is found by its bundle id, so moving Notepad.app is fine.

/// The installed command. `--args` reaches the app as argv (`files_from_args`), also for files that don't exist yet.
pub const SCRIPT: &str = r#"#!/bin/sh
# notepad [file…]: opens files in Notepad. Installed by Notepad → Install Command Line Tool…
for f do
  shift
  case "$f" in
    /*) ;;
    *) f="$PWD/$f" ;;
  esac
  set -- "$@" "$f"
done
exec open -n -b no.1011.notepad --args "$@"
"#;

pub const TARGET: &str = "/usr/local/bin/notepad";
/// Marks a file as ours, so an unrelated `notepad` command is never overwritten.
const MARK: &str = "Installed by Notepad";

#[cfg(target_os = "macos")]
pub fn install() -> Result<String, String> {
    use std::path::Path;
    use std::process::Command;
    if let Ok(existing) = std::fs::read_to_string(TARGET) {
        if !existing.contains(MARK) {
            return Err(format!("{TARGET} already exists and isn't Notepad's. Remove it first."));
        }
    } else if Path::new(TARGET).exists() {
        return Err(format!("{TARGET} already exists and isn't Notepad's. Remove it first."));
    }
    let tmp = std::env::temp_dir().join("notepad-cli.sh");
    std::fs::write(&tmp, SCRIPT).map_err(|e| e.to_string())?;
    // Without admin rights first (works when /usr/local/bin is the user's, e.g. an Intel Homebrew setup).
    let direct = Command::new("/usr/bin/install").args(["-m", "755"]).arg(&tmp).arg(TARGET).output();
    if !matches!(direct, Ok(ref o) if o.status.success()) {
        // macOS asks for an administrator password. The temp path is passed as an argument, not pasted into the
        // script, so no quoting can go wrong.
        let out = Command::new("/usr/bin/osascript")
            .args([
                "-e",
                "on run argv",
                "-e",
                &format!(
                    "do shell script \"mkdir -p /usr/local/bin && /usr/bin/install -m 755 \" & quoted form of item 1 of argv & \" {TARGET}\" with administrator privileges"
                ),
                "-e",
                "end run",
            ])
            .arg(&tmp)
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            let msg = String::from_utf8_lossy(&out.stderr);
            let _ = std::fs::remove_file(&tmp);
            return Err(if msg.contains("-128") { "Cancelled.".into() } else { msg.trim().to_string() });
        }
    }
    let _ = std::fs::remove_file(&tmp);
    Ok(TARGET.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn install() -> Result<String, String> {
    Err("Only needed on macOS: the Linux packages install the notepad command themselves.".into())
}

#[tauri::command]
pub async fn install_cli() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(install).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The script turns relative paths into absolute ones (spaces kept) before handing them to `open`.
    #[cfg(unix)]
    #[test]
    fn script_makes_paths_absolute() {
        let d = tempfile::tempdir().unwrap();
        let fake = SCRIPT.replace("exec open -n -b no.1011.notepad --args", "printf '%s\\n'");
        let script = d.path().join("notepad");
        std::fs::write(&script, fake).unwrap();
        let out = std::process::Command::new("/bin/sh")
            .arg(&script)
            .args(["a b.txt", "/abs/c.md", "sub/d.log"])
            .current_dir(d.path())
            .output()
            .unwrap();
        let cwd = std::fs::canonicalize(d.path()).unwrap();
        let got = String::from_utf8(out.stdout).unwrap();
        let lines: Vec<&str> = got.lines().collect();
        assert_eq!(lines.len(), 3, "{got}");
        assert!(lines[0].ends_with("/a b.txt"));
        assert!(std::path::Path::new(lines[0]).parent().unwrap().ends_with(cwd.file_name().unwrap()));
        assert_eq!(lines[1], "/abs/c.md");
        assert!(lines[2].ends_with("/sub/d.log"));
        assert!(SCRIPT.contains(MARK));
    }
}
