//! The folder browser in the sidebar: list a directory, create files and folders, and tell whether a path is
//! inside a git repository (so the tab bar can mark files that get committed). No Tauri dependency.

use crate::gitops::DirEntry;
use git2::Repository;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

pub type Res<T> = Result<T, String>;

/// Entries of a directory, folders first, by name. Skips `.git` and macOS `.DS_Store`; other dotfiles are shown.
pub fn list_dir(dir: &str) -> Res<Vec<DirEntry>> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("Can't read {dir}: {e}"))? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" || name == ".DS_Store" {
            continue;
        }
        // Follow symlinks so a linked folder can be expanded.
        let is_dir = fs::metadata(entry.path()).map(|m| m.is_dir()).unwrap_or(false);
        out.push(DirEntry { name, is_dir });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// A single file or folder name typed by the user: no separators, not `.`/`..`, not empty.
fn checked_child(dir: &str, name: &str) -> Res<PathBuf> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Enter a name".into());
    }
    if name == "." || name == ".." || name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(format!("\"{name}\" isn't a valid name"));
    }
    let dir = Path::new(dir);
    if !dir.is_dir() {
        return Err(format!("{} is not a folder", dir.display()));
    }
    Ok(dir.join(name))
}

/// Creates an empty file; refuses to touch an existing one. Returns its full path.
pub fn create_file(dir: &str, name: &str) -> Res<String> {
    let path = checked_child(dir, name)?;
    fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!("{} already exists", name.trim()),
        _ => format!("Can't create {}: {e}", name.trim()),
    })?;
    Ok(path.to_string_lossy().to_string())
}

/// Creates an empty folder; refuses if anything with that name exists. Returns its full path.
pub fn create_dir(dir: &str, name: &str) -> Res<String> {
    let path = checked_child(dir, name)?;
    fs::create_dir(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::AlreadyExists => format!("{} already exists", name.trim()),
        _ => format!("Can't create {}: {e}", name.trim()),
    })?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitPathInfo {
    /// Working directory of the repository the path is in (as git reports it, without a trailing slash).
    pub root: String,
    /// Folder name of that repository.
    pub name: String,
    /// The file is in the last commit or the index (false: new, not committed yet).
    pub tracked: bool,
}

/// Is this file (or folder) inside a git working tree and not ignored? None otherwise, also for paths that don't
/// exist yet in a folder outside any repository.
pub fn git_path_info(path: &str) -> Option<GitPathInfo> {
    let p = Path::new(path);
    // Resolve symlinks (/tmp → /private/tmp on macOS) so the path lines up with the repository's workdir.
    let abs = fs::canonicalize(p).ok().or_else(|| {
        let parent = fs::canonicalize(p.parent()?).ok()?;
        Some(parent.join(p.file_name()?))
    })?;
    let start = if abs.is_dir() { abs.clone() } else { abs.parent()?.to_path_buf() };
    let repo = Repository::discover(&start).ok()?;
    let workdir = fs::canonicalize(repo.workdir()?).ok()?;
    let rel = abs.strip_prefix(&workdir).ok()?;
    let rel_s = rel.to_string_lossy().replace('\\', "/");
    if rel_s == ".git" || rel_s.starts_with(".git/") {
        return None;
    }
    if !rel_s.is_empty() && repo.is_path_ignored(rel).unwrap_or(false) {
        return None;
    }
    let tracked = if rel_s.is_empty() || abs.is_dir() {
        true
    } else {
        let in_index = repo.index().ok().map(|i| i.get_path(rel, 0).is_some()).unwrap_or(false);
        in_index
            || repo
                .head()
                .ok()
                .and_then(|h| h.peel_to_tree().ok())
                .map(|t| t.get_path(rel).is_ok())
                .unwrap_or(false)
    };
    let root = workdir.to_string_lossy().trim_end_matches(['/', '\\']).to_string();
    let name = workdir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| root.clone());
    Some(GitPathInfo { root, name, tracked })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("notepad-files-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn creates_files_and_folders_and_lists_them() {
        let d = tmp("create");
        let ds = d.to_str().unwrap();
        let f = create_file(ds, "notes.md").unwrap();
        assert!(Path::new(&f).is_file());
        assert!(create_file(ds, "notes.md").unwrap_err().contains("already exists"));
        create_dir(ds, "Sub").unwrap();
        assert!(create_dir(ds, "Sub").is_err());
        assert!(create_file(ds, "../evil").is_err());
        assert!(create_file(ds, "a/b").is_err());
        assert!(create_file(ds, "  ").is_err());
        fs::write(d.join(".DS_Store"), "").unwrap();
        fs::write(d.join(".env"), "").unwrap();
        let names: Vec<_> = list_dir(ds).unwrap().into_iter().map(|e| (e.name, e.is_dir)).collect();
        assert_eq!(
            names,
            vec![("Sub".into(), true), (".env".into(), false), ("notes.md".into(), false)]
        );
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn tells_whether_a_path_is_in_git() {
        let d = tmp("gitinfo");
        let repo = Repository::init(&d).unwrap();
        fs::write(d.join(".gitignore"), "secret.txt\n").unwrap();
        fs::write(d.join("a.md"), "a").unwrap();
        fs::write(d.join("secret.txt"), "x").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(Path::new("a.md")).unwrap();
        index.write().unwrap();

        let a = git_path_info(d.join("a.md").to_str().unwrap()).unwrap();
        assert!(a.tracked);
        assert_eq!(a.root, fs::canonicalize(&d).unwrap().to_string_lossy());
        let new = git_path_info(d.join("new.md").to_str().unwrap()).unwrap();
        assert!(!new.tracked);
        assert_eq!(git_path_info(d.join("secret.txt").to_str().unwrap()), None);
        assert!(git_path_info(d.to_str().unwrap()).is_some());

        let outside = tmp("nogit");
        fs::write(outside.join("b.md"), "b").unwrap();
        // The temp dir itself might sit inside a repository on some machines; only check when it doesn't.
        if Repository::discover(&outside).is_err() {
            assert_eq!(git_path_info(outside.join("b.md").to_str().unwrap()), None);
        }
        let _ = fs::remove_dir_all(&d);
        let _ = fs::remove_dir_all(&outside);
    }
}
