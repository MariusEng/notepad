//! Updates (Help → Check for Updates, the daily check): tauri-plugin-updater finds the update in latest.json,
//! downloads it and verifies its signature. Installing differs on macOS: the plugin replaces the whole Notepad.app
//! folder, which leaves a Dock icon that was pinned pointing at the old folder (the updated app then shows up as a
//! second, unpinned icon). Here only the folder's `Contents` is swapped, so Notepad.app itself stays the same folder.
//! Windows and Linux use the plugin's installer as before.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update found by the last check, kept for `update_install`.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
}

#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: u64,
}

/// Looks for a newer version. None: up to date.
#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, Pending>) -> Result<Option<UpdateInfo>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        body: u.body.clone(),
    });
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

/// Downloads (with "update-progress" events), verifies, installs and restarts. The frontend saves the session first.
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, Pending>) -> Result<(), String> {
    let update = pending.0.lock().unwrap().take().ok_or("No update to install: check for updates first.")?;
    let mut done = 0u64;
    let progress_app = app.clone();
    // download() verifies the signature against the public key in tauri.conf.json before returning the bytes.
    let bytes = update
        .download(
            move |chunk, total| {
                done += chunk as u64;
                let _ = progress_app.emit("update-progress", Progress { done, total: total.unwrap_or(0) });
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        match install_in_place(&bytes, &app.config().identifier) {
            Ok(()) => return restart_after_exit(&app),
            // Not writable (e.g. installed by an administrator) or anything unexpected: the plugin's way, which can
            // ask for an administrator password.
            Err(e) => eprintln!("[notepad] in-place update failed, using the updater's install: {e}"),
        }
    }
    update.install(bytes).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    return restart_after_exit(&app);
    #[cfg(not(target_os = "macos"))]
    app.restart();
}

/// Quits, and starts the app again once this process is gone. Tauri's restart runs `open -n` while the old copy is
/// still running; with two copies at once the Dock gives the new one its own tile instead of the pinned one.
#[cfg(target_os = "macos")]
fn restart_after_exit(app: &AppHandle) -> Result<(), String> {
    relaunch_when_gone(std::process::id(), "/usr/bin/open", &current_bundle()?)?;
    app.exit(0);
    Ok(())
}

/// A detached helper: waits (at most 30 s) until `pid` is gone, then runs `<opener> <bundle>`.
#[cfg(target_os = "macos")]
fn relaunch_when_gone(pid: u32, opener: &str, bundle: &std::path::Path) -> Result<(), String> {
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    const WAIT: &str = r#"n=0; while kill -0 "$1" 2>/dev/null && [ $n -lt 300 ]; do sleep 0.1; n=$((n+1)); done; sleep 0.5; exec "$2" "$3""#;
    Command::new("/bin/sh")
        .args(["-c", WAIT, "notepad-restart", &pid.to_string(), opener])
        .arg(bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("can't restart: {e}"))
}

/// The running app's bundle: …/Notepad.app (from …/Notepad.app/Contents/MacOS/notepad).
#[cfg(target_os = "macos")]
fn current_bundle() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.canonicalize().unwrap_or(exe);
    let bundle = exe.ancestors().nth(3).ok_or("unexpected app location")?.to_path_buf();
    if bundle.extension().and_then(|e| e.to_str()) != Some("app") {
        return Err(format!("not running from an app bundle: {}", exe.display()));
    }
    Ok(bundle)
}

/// Unpacks the update (a .tar.gz with Notepad.app) inside the bundle and swaps `Contents`.
#[cfg(target_os = "macos")]
fn install_in_place(bytes: &[u8], identifier: &str) -> Result<(), String> {
    install_into(&current_bundle()?, bytes, identifier)
}

/// The swap itself, for any bundle path (tests use a temporary one).
#[cfg(any(target_os = "macos", test))]
pub(crate) fn install_into(bundle: &std::path::Path, bytes: &[u8], identifier: &str) -> Result<(), String> {
    use std::process::Command;
    let staging = bundle.join(".notepad-update");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir(&staging).map_err(|e| format!("can't write to {}: {e}", bundle.display()))?;
    let result = (|| {
        let archive = staging.join("update.tar.gz");
        std::fs::write(&archive, bytes).map_err(|e| e.to_string())?;
        let out = Command::new("/usr/bin/tar")
            .arg("-xzf")
            .arg(&archive)
            .arg("-C")
            .arg(&staging)
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!("unpacking failed: {}", String::from_utf8_lossy(&out.stderr).trim()));
        }
        // The archive holds one .app; check it is this app before touching anything.
        let new_app = std::fs::read_dir(&staging)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .find(|p| p.extension().and_then(|e| e.to_str()) == Some("app"))
            .ok_or("the update holds no app")?;
        let new_contents = new_app.join("Contents");
        let plist = std::fs::read_to_string(new_contents.join("Info.plist")).map_err(|e| e.to_string())?;
        if !plist.contains(&format!("<string>{identifier}</string>")) {
            return Err(format!("the update isn't {identifier}"));
        }
        // Swap: old Contents aside, new Contents in; put the old one back if the second step fails.
        let contents = bundle.join("Contents");
        let old = staging.join("old-Contents");
        std::fs::rename(&contents, &old).map_err(|e| format!("can't replace {}: {e}", contents.display()))?;
        if let Err(e) = std::fs::rename(&new_contents, &contents) {
            let _ = std::fs::rename(&old, &contents);
            return Err(format!("can't put the new version in place: {e}"));
        }
        Ok(())
    })();
    let _ = std::fs::remove_dir_all(&staging);
    result?;
    // Let Launch Services and the Dock see the new version (best effort).
    let _ = Command::new("/usr/bin/touch").arg(bundle).status();
    let _ = Command::new(
        "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    )
    .arg("-f")
    .arg(bundle)
    .status();
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Command;

    fn make_app(dir: &std::path::Path, id: &str, marker: &str) {
        let c = dir.join("Notepad.app/Contents/MacOS");
        std::fs::create_dir_all(&c).unwrap();
        std::fs::write(c.join("notepad"), marker).unwrap();
        std::fs::write(
            dir.join("Notepad.app/Contents/Info.plist"),
            format!("<plist><dict><key>CFBundleIdentifier</key><string>{id}</string></dict></plist>"),
        )
        .unwrap();
    }

    fn tar_gz(dir: &std::path::Path) -> Vec<u8> {
        let out = dir.join("u.tar.gz");
        assert!(Command::new("tar").arg("-czf").arg(&out).arg("-C").arg(dir).arg("Notepad.app").status().unwrap().success());
        std::fs::read(out).unwrap()
    }

    #[test]
    fn swaps_contents_and_keeps_the_bundle_folder() {
        use std::os::unix::fs::MetadataExt;
        let installed = tempfile::tempdir().unwrap();
        make_app(installed.path(), "no.1011.notepad", "old");
        let bundle = installed.path().join("Notepad.app");
        let inode = std::fs::metadata(&bundle).unwrap().ino();

        let new = tempfile::tempdir().unwrap();
        make_app(new.path(), "no.1011.notepad", "new");
        install_into(&bundle, &tar_gz(new.path()), "no.1011.notepad").unwrap();

        assert_eq!(std::fs::read_to_string(bundle.join("Contents/MacOS/notepad")).unwrap(), "new");
        assert_eq!(std::fs::metadata(&bundle).unwrap().ino(), inode, "same Notepad.app folder (the Dock keeps it)");
        assert!(!bundle.join(".notepad-update").exists(), "staging removed");
    }

    #[test]
    fn refuses_another_app_and_leaves_everything_as_it_was() {
        let installed = tempfile::tempdir().unwrap();
        make_app(installed.path(), "no.1011.notepad", "old");
        let bundle = installed.path().join("Notepad.app");
        let other = tempfile::tempdir().unwrap();
        make_app(other.path(), "com.example.other", "evil");
        assert!(install_into(&bundle, &tar_gz(other.path()), "no.1011.notepad").is_err());
        assert_eq!(std::fs::read_to_string(bundle.join("Contents/MacOS/notepad")).unwrap(), "old");
        assert!(install_into(&bundle, b"not a tar.gz", "no.1011.notepad").is_err());
        assert_eq!(std::fs::read_to_string(bundle.join("Contents/MacOS/notepad")).unwrap(), "old");
        assert!(!bundle.join(".notepad-update").exists());
    }
}

#[cfg(all(test, target_os = "macos"))]
mod real_update_test {
    #[test]
    fn relaunches_only_after_the_old_process_is_gone() {
        use std::time::{Duration, Instant};
        let dir = tempfile::tempdir().unwrap();
        let mark = dir.path().join("a folder with spaces");
        let mut old = std::process::Command::new("/bin/sleep").arg("30").spawn().unwrap();
        // "touch" stands in for "open".
        super::relaunch_when_gone(old.id(), "/usr/bin/touch", &mark).unwrap();
        std::thread::sleep(Duration::from_millis(1200));
        assert!(!mark.exists(), "started while the old process was running");
        old.kill().unwrap();
        old.wait().unwrap();
        let t = Instant::now();
        while !mark.exists() && t.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(mark.exists(), "never started again");
    }

    /// NOTEPAD_REAL_UPDATE_TEST=<app.tar.gz>:<installed .app copy> runs the swap on real files (not run by default).
    #[test]
    fn real_files() {
        let Ok(v) = std::env::var("NOTEPAD_REAL_UPDATE_TEST") else { return };
        let (archive, bundle) = v.split_once(':').unwrap();
        super::install_into(std::path::Path::new(bundle), &std::fs::read(archive).unwrap(), "no.1011.notepad").unwrap();
    }
}
