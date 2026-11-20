//! Git for the notepad: open a repository, list its files, commit saved files and keep the branch in
//! sync with its remote. Built on libgit2 (no `git` binary needed). Only HTTPS remotes are supported;
//! credentials come from `creds` (the app's own store, then the user's git credential helper).
//!
//! Nothing here depends on Tauri, so it can be unit-tested on its own.

use crate::creds::{self, Credential};
use git2::{
    build::{CheckoutBuilder, RepoBuilder},
    AnnotatedCommit, Config, Cred, ErrorCode, FetchOptions, IndexEntry, IndexTime, Oid, PushOptions,
    RemoteCallbacks, Repository, Signature,
};
use serde::Serialize;
use std::cell::{Cell, RefCell};
use std::fs;
use std::path::Path;

pub type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// Absolute path of the working directory.
    pub root: String,
    pub name: String,
    pub branch: Option<String>,
    /// URL of the remote without any credentials in it.
    pub remote_url: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    /// The remote's main branch (origin/HEAD, else main or master), the target for pull requests.
    pub default_branch: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub current: bool,
    /// Exists as a local branch.
    pub local: bool,
    /// Exists on the remote (as last fetched).
    pub remote: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// "local-only" | "up-to-date" | "pushed" | "pulled" | "merged" | "conflict"
    pub state: String,
    pub message: String,
    pub info: RepoInfo,
    /// Files with merge conflicts (state == "conflict").
    pub conflicts: Vec<String>,
}

// ---------------------------------------------------------------- opening

fn strip_userinfo(url: &str) -> String {
    match url::Url::parse(url) {
        Ok(mut u) => {
            let _ = u.set_username("");
            let _ = u.set_password(None);
            u.to_string()
        }
        Err(_) => url.to_string(),
    }
}

fn workdir(repo: &Repository) -> Res<String> {
    let dir = repo.workdir().ok_or("This is a bare repository (it has no files to edit)")?;
    let s = dir.to_string_lossy().to_string();
    Ok(s.trim_end_matches(['/', '\\']).to_string())
}

/// The branch HEAD points at, also when the branch has no commits yet.
fn current_branch(repo: &Repository) -> Option<String> {
    let head = repo.find_reference("HEAD").ok()?;
    let target = head.symbolic_target()?;
    target.strip_prefix("refs/heads/").map(|s| s.to_string())
}

fn pick_remote(repo: &Repository) -> Option<String> {
    let remotes = repo.remotes().ok()?;
    if remotes.iter().flatten().any(|r| r == "origin") {
        return Some("origin".to_string());
    }
    remotes.iter().flatten().next().map(|s| s.to_string())
}

fn ahead_behind(repo: &Repository, branch: &str, remote: &str) -> (usize, usize) {
    let local = repo.refname_to_id(&format!("refs/heads/{branch}")).ok();
    let up = repo.refname_to_id(&format!("refs/remotes/{remote}/{branch}")).ok();
    match (local, up) {
        (Some(l), Some(u)) => repo.graph_ahead_behind(l, u).unwrap_or((0, 0)),
        (Some(l), None) => {
            // The remote has no such branch yet: everything is "ahead".
            let mut walk = match repo.revwalk() {
                Ok(w) => w,
                Err(_) => return (0, 0),
            };
            if walk.push(l).is_err() {
                return (0, 0);
            }
            (walk.count(), 0)
        }
        _ => (0, 0),
    }
}

fn info_of(repo: &Repository) -> Res<RepoInfo> {
    let root = workdir(repo)?;
    let name = Path::new(&root)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root.clone());
    let branch = current_branch(repo);
    let remote = pick_remote(repo);
    let remote_url = remote
        .as_ref()
        .and_then(|r| repo.find_remote(r).ok())
        .and_then(|r| r.url().map(strip_userinfo));
    let (ahead, behind) = match (&branch, &remote) {
        (Some(b), Some(r)) => ahead_behind(repo, b, r),
        _ => (0, 0),
    };
    let default_branch = remote.as_deref().and_then(|r| default_branch(repo, r));
    Ok(RepoInfo { root, name, branch, remote_url, ahead, behind, default_branch })
}

fn default_branch(repo: &Repository, remote: &str) -> Option<String> {
    let prefix = format!("refs/remotes/{remote}/");
    if let Ok(head) = repo.find_reference(&format!("{prefix}HEAD")) {
        if let Some(b) = head.symbolic_target().and_then(|t| t.strip_prefix(&prefix)) {
            return Some(b.to_string());
        }
    }
    ["main", "master"]
        .into_iter()
        .find(|b| repo.find_reference(&format!("{prefix}{b}")).is_ok())
        .map(|b| b.to_string())
}

/// Opens the repository that contains `path` (the path can be any folder inside it).
pub fn open(path: &str) -> Res<RepoInfo> {
    let repo = Repository::discover(path).map_err(|_| format!("{path} is not inside a git repository"))?;
    info_of(&repo)
}

/// Current state without touching the network.
pub fn info(root: &str) -> Res<RepoInfo> {
    info_of(&Repository::open(root).map_err(err)?)
}

/// Files and folders directly inside `rel` (relative to the repository root), folders first.
/// `.git` and ignored files are left out.
pub fn list_dir(root: &str, rel: &str) -> Res<Vec<DirEntry>> {
    let repo = Repository::open(root).map_err(err)?;
    let dir = Path::new(root).join(rel);
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".git" || name == ".DS_Store" {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let rel_path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        if repo.is_path_ignored(Path::new(&rel_path)).unwrap_or(false) {
            continue;
        }
        out.push(DirEntry { name, is_dir });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

// ---------------------------------------------------------------- credentials and callbacks

/// Turns a libgit2 failure into text the UI can act on: "AUTH_REQUIRED:<host>" means "ask for credentials".
fn net_err(e: git2::Error, url: &str) -> String {
    let msg = e.message().to_string();
    let lower = msg.to_lowercase();
    let auth = e.code() == ErrorCode::Auth
        || lower.contains("authentication")
        || lower.contains("no credentials")
        || lower.contains("401")
        || lower.contains("403");
    if auth {
        return format!("AUTH_REQUIRED:{}", creds::host_of(url).unwrap_or_default());
    }
    if lower.contains("unsupported url protocol") || url.starts_with("git@") || url.starts_with("ssh://") {
        return "Only HTTPS remotes are supported. Change the remote URL to https://…".to_string();
    }
    msg
}

fn callbacks<'a>(cred: &'a Option<Credential>, tries: &'a Cell<u32>) -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();
    cb.credentials(move |_url, _user, _allowed| {
        // libgit2 calls this again after a rejection; give up after one attempt instead of looping.
        tries.set(tries.get() + 1);
        if tries.get() > 1 {
            return Err(git2::Error::from_str("authentication failed"));
        }
        match cred {
            Some(c) if !c.bearer => Cred::userpass_plaintext(&c.username, &c.secret),
            Some(_) => Cred::userpass_plaintext("", ""),
            None => Err(git2::Error::from_str("no credentials")),
        }
    });
    cb
}

fn bearer_header(cred: &Option<Credential>) -> Vec<String> {
    match cred {
        Some(c) if c.bearer => vec![format!("Authorization: Bearer {}", c.secret)],
        _ => vec![],
    }
}

fn fetch_remote(repo: &Repository, remote: &str, branch: Option<&str>, cred: &Option<Credential>) -> Res<()> {
    let mut r = repo.find_remote(remote).map_err(err)?;
    let url = r.url().unwrap_or_default().to_string();
    let tries = Cell::new(0);
    let headers = bearer_header(cred);
    let header_refs: Vec<&str> = headers.iter().map(|s| s.as_str()).collect();
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks(cred, &tries));
    if !header_refs.is_empty() {
        fo.custom_headers(&header_refs);
    }
    let spec = match branch {
        Some(b) => vec![format!("+refs/heads/{b}:refs/remotes/{remote}/{b}")],
        None => {
            // Forget branches that were deleted on the server.
            fo.prune(git2::FetchPrune::On);
            vec![format!("+refs/heads/*:refs/remotes/{remote}/*")]
        }
    };
    match r.fetch(&spec, Some(&mut fo), None) {
        Ok(()) => Ok(()),
        // A branch that does not exist on the remote yet is fine (empty or brand-new repository).
        Err(e) if e.code() == ErrorCode::NotFound || e.message().contains("couldn't find remote ref") => Ok(()),
        Err(e) => Err(net_err(e, &url)),
    }
}

/// Error prefix for "the server won't take pushes to this branch": `PUSH_REJECTED:<branch>:<reason>`.
pub const PUSH_REJECTED: &str = "PUSH_REJECTED:";

fn push_branch(repo: &Repository, remote: &str, branch: &str, cred: &Option<Credential>) -> Res<()> {
    let mut r = repo.find_remote(remote).map_err(err)?;
    let url = r.url().unwrap_or_default().to_string();
    let tries = Cell::new(0);
    let rejected: RefCell<Option<String>> = RefCell::new(None);
    let headers = bearer_header(cred);
    let header_refs: Vec<&str> = headers.iter().map(|s| s.as_str()).collect();
    let mut cb = callbacks(cred, &tries);
    cb.push_update_reference(|name, status| {
        if let Some(s) = status {
            *rejected.borrow_mut() = Some(format!("{name}: {s}"));
        }
        Ok(())
    });
    let mut po = PushOptions::new();
    po.remote_callbacks(cb);
    if !header_refs.is_empty() {
        po.custom_headers(&header_refs);
    }
    let spec = format!("refs/heads/{branch}:refs/heads/{branch}");
    if let Err(e) = r.push(&[spec.as_str()], Some(&mut po)) {
        let lower = e.message().to_lowercase();
        if lower.contains("protected") || lower.contains("hook declined") || lower.contains("denied to push")
            || lower.contains("not allowed to push")
        {
            return Err(format!("{PUSH_REJECTED}{branch}:{}", e.message()));
        }
        return Err(net_err(e, &url));
    }
    drop(po);
    if let Some(why) = rejected.into_inner() {
        // The server refused this branch (protected main/master, review required, hook…).
        return Err(format!("{PUSH_REJECTED}{branch}:{why}"));
    }
    // Remember where this branch lives, so ahead/behind can be shown.
    if let Ok(mut b) = repo.find_branch(branch, git2::BranchType::Local) {
        let _ = b.set_upstream(Some(&format!("{remote}/{branch}")));
    }
    Ok(())
}

// ---------------------------------------------------------------- clone

/// Clones `url` (HTTPS) into `dest`, which must not exist or must be empty.
pub fn clone_repo(url: &str, dest: &str) -> Res<RepoInfo> {
    let dest_path = Path::new(dest);
    if dest_path.exists() {
        let empty = fs::read_dir(dest_path).map_err(err)?.next().is_none();
        if !empty {
            return Err(format!("{dest} already exists and is not empty"));
        }
    }
    let cfg = Config::open_default().or_else(|_| Config::new()).map_err(err)?;
    let cred = creds::resolve(url, &cfg);
    let tries = Cell::new(0);
    let headers = bearer_header(&cred);
    let header_refs: Vec<&str> = headers.iter().map(|s| s.as_str()).collect();
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks(&cred, &tries));
    if !header_refs.is_empty() {
        fo.custom_headers(&header_refs);
    }
    let repo = RepoBuilder::new().fetch_options(fo).clone(url, dest_path).map_err(|e| net_err(e, url))?;
    info_of(&repo)
}

// ---------------------------------------------------------------- commit

fn signature(repo: &Repository, author: Option<(&str, &str)>) -> Res<Signature<'static>> {
    if let Ok(sig) = repo.signature() {
        return Signature::now(sig.name().unwrap_or("Notepad"), sig.email().unwrap_or("notepad@localhost")).map_err(err);
    }
    let (n, e) = author.unwrap_or(("Notepad", "notepad@localhost"));
    Signature::now(n, e).map_err(err)
}

#[cfg(unix)]
fn file_mode(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    match fs::metadata(path) {
        Ok(m) if m.permissions().mode() & 0o111 != 0 => 0o100755,
        _ => 0o100644,
    }
}
#[cfg(not(unix))]
fn file_mode(_path: &Path) -> u32 {
    0o100644
}

/// Commits the current disk content of `rels` (paths relative to the root) as one commit. Only those
/// paths go into the commit; anything else that is staged is left alone. Returns the new commit id,
/// or None when there was nothing to commit.
pub fn commit_paths(root: &str, rels: &[String], message: &str, author: Option<(&str, &str)>) -> Res<Option<String>> {
    let repo = Repository::open(root).map_err(err)?;
    let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());

    // Build the new tree in memory: the parent's tree plus the changed files.
    let mut idx = git2::Index::new().map_err(err)?;
    if let Some(p) = &parent {
        idx.read_tree(&p.tree().map_err(err)?).map_err(err)?;
    }
    let mut touched: Vec<&String> = Vec::new();
    for rel in rels {
        let rel_path = Path::new(rel);
        if repo.is_path_ignored(rel_path).unwrap_or(false) && idx.get_path(rel_path, 0).is_none() {
            continue; // ignored and never tracked: not ours to commit
        }
        let full = Path::new(root).join(rel);
        if full.is_file() {
            let data = fs::read(&full).map_err(err)?;
            let blob = repo.blob(&data).map_err(err)?;
            let entry = IndexEntry {
                ctime: IndexTime::new(0, 0),
                mtime: IndexTime::new(0, 0),
                dev: 0,
                ino: 0,
                mode: file_mode(&full),
                uid: 0,
                gid: 0,
                file_size: data.len() as u32,
                id: blob,
                flags: 0,
                flags_extended: 0,
                path: rel.as_bytes().to_vec(),
            };
            idx.add(&entry).map_err(err)?;
            touched.push(rel);
        } else if idx.get_path(rel_path, 0).is_some() {
            idx.remove_path(rel_path).map_err(err)?;
            touched.push(rel);
        }
    }
    let tree_id = idx.write_tree_to(&repo).map_err(err)?;
    if let Some(p) = &parent {
        if p.tree_id() == tree_id {
            return Ok(None);
        }
    }
    let tree = repo.find_tree(tree_id).map_err(err)?;
    let sig = signature(&repo, author)?;
    let parents: Vec<&git2::Commit> = parent.iter().collect();
    let oid = repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents).map_err(err)?;

    // Bring the real index in line with the new HEAD for the files we committed.
    let mut real = repo.index().map_err(err)?;
    for rel in touched {
        let p = Path::new(rel);
        if Path::new(root).join(rel).is_file() {
            let _ = real.add_path(p);
        } else {
            let _ = real.remove_path(p);
        }
    }
    real.write().map_err(err)?;
    Ok(Some(oid.to_string()))
}

/// Commits one saved file with a generated message ("Add notes.md", "Update notes.md", "Delete notes.md").
/// Returns the message, or None when the file is outside the repository, ignored, or unchanged.
pub fn commit_file(root: &str, file: &str, author: Option<&str>) -> Res<Option<String>> {
    let Some(rel) = relative_to(root, file) else {
        return Ok(None);
    };
    let repo = Repository::open(root).map_err(err)?;
    let in_head = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok())
        .map(|t| t.get_path(Path::new(&rel)).is_ok())
        .unwrap_or(false);
    let exists = Path::new(root).join(&rel).is_file();
    let message = match (exists, in_head) {
        (true, true) => format!("Update {rel}"),
        (true, false) => format!("Add {rel}"),
        (false, _) => format!("Delete {rel}"),
    };
    let email = author.map(|a| format!("{a}@users.noreply.local"));
    let who = author.zip(email.as_deref());
    Ok(commit_paths(root, &[rel], &message, who)?.map(|_| message))
}

// ---------------------------------------------------------------- sync

fn result(repo: &Repository, state: &str, message: &str) -> Res<SyncResult> {
    Ok(SyncResult { state: state.into(), message: message.into(), info: info_of(repo)?, conflicts: vec![] })
}

fn fast_forward(repo: &Repository, branch: &str, target: Oid) -> Res<()> {
    let commit = repo.find_commit(target).map_err(err)?;
    // Check out first: if local edits are in the way this fails and nothing has moved.
    repo.checkout_tree(commit.as_object(), Some(CheckoutBuilder::new().safe()))
        .map_err(|e| format!("Local changes would be overwritten by the update: {}", e.message()))?;
    match repo.find_reference(&format!("refs/heads/{branch}")) {
        Ok(mut r) => {
            r.set_target(target, "notepad: fast-forward").map_err(err)?;
        }
        Err(_) => {
            repo.reference(&format!("refs/heads/{branch}"), target, true, "notepad: create branch").map_err(err)?;
        }
    }
    repo.set_head(&format!("refs/heads/{branch}")).map_err(err)
}

/// Brings the current branch in line with its remote: fetch, fast-forward or merge, then push.
/// A merge that would conflict is never applied: the local commits stay as they are (and unpushed).
pub fn sync(root: &str) -> Res<SyncResult> {
    let repo = Repository::open(root).map_err(err)?;
    let Some(remote) = pick_remote(&repo) else {
        return result(&repo, "local-only", "This repository has no remote.");
    };
    let branch = current_branch(&repo).ok_or("No branch is checked out")?;
    let url = repo.find_remote(&remote).map_err(err)?.url().unwrap_or_default().to_string();
    let cfg = repo.config().map_err(err)?;
    let cred = creds::resolve(&url, &cfg);

    // All branches, so the branch menu also lists ones created elsewhere.
    fetch_remote(&repo, &remote, None, &cred)?;

    let remote_ref = format!("refs/remotes/{remote}/{branch}");
    let their_ref = repo.find_reference(&remote_ref).ok();
    let local_oid = repo.refname_to_id(&format!("refs/heads/{branch}")).ok();

    let (Some(their_ref), Some(local_oid)) = (their_ref, local_oid) else {
        return match (repo.find_reference(&remote_ref).ok(), local_oid) {
            // The remote has the branch, we have no commits yet: take theirs.
            (Some(r), None) => {
                let oid = r.target().ok_or("Remote branch has no commit")?;
                fast_forward(&repo, &branch, oid)?;
                result(&repo, "pulled", "Downloaded the repository's files.")
            }
            // We have commits, the remote does not have this branch: publish it.
            (None, Some(_)) => {
                push_branch(&repo, &remote, &branch, &cred)?;
                result(&repo, "pushed", "Pushed.")
            }
            // Nothing anywhere yet.
            _ => result(&repo, "up-to-date", "Nothing to sync yet."),
        };
    };

    let their_oid = their_ref.target().ok_or("Remote branch has no commit")?;
    let their_annot: AnnotatedCommit = repo.reference_to_annotated_commit(&their_ref).map_err(err)?;
    let (analysis, _) = repo.merge_analysis(&[&their_annot]).map_err(err)?;

    if analysis.is_up_to_date() {
        let (ahead, _) = repo.graph_ahead_behind(local_oid, their_oid).map_err(err)?;
        if ahead > 0 {
            push_branch(&repo, &remote, &branch, &cred)?;
            return result(&repo, "pushed", "Pushed.");
        }
        return result(&repo, "up-to-date", "Already up to date.");
    }

    if analysis.is_fast_forward() {
        fast_forward(&repo, &branch, their_oid)?;
        return result(&repo, "pulled", "Downloaded changes from the remote.");
    }

    // Diverged: merge in memory first, so a conflict leaves the working folder untouched.
    let ours = repo.find_commit(local_oid).map_err(err)?;
    let theirs = repo.find_commit(their_oid).map_err(err)?;
    let mut merged = repo.merge_commits(&ours, &theirs, None).map_err(err)?;
    if merged.has_conflicts() {
        let conflicts: Vec<String> = merged
            .conflicts()
            .map_err(err)?
            .flatten()
            .filter_map(|c| c.our.or(c.their).or(c.ancestor))
            .map(|e| String::from_utf8_lossy(&e.path).to_string())
            .collect();
        return Ok(SyncResult {
            state: "conflict".into(),
            message: "The remote has conflicting changes. Your commits are kept locally and were not pushed.".into(),
            info: info_of(&repo)?,
            conflicts,
        });
    }
    let tree_id = merged.write_tree_to(&repo).map_err(err)?;
    let tree = repo.find_tree(tree_id).map_err(err)?;
    repo.checkout_tree(tree.as_object(), Some(CheckoutBuilder::new().safe()))
        .map_err(|e| format!("Local changes would be overwritten by the merge: {}", e.message()))?;
    let sig = signature(&repo, None)?;
    repo.commit(Some("HEAD"), &sig, &sig, &format!("Merge {remote}/{branch}"), &tree, &[&ours, &theirs]).map_err(err)?;
    push_branch(&repo, &remote, &branch, &cred)?;
    result(&repo, "merged", "Merged the remote's changes and pushed.")
}

// ---------------------------------------------------------------- branches

/// Local branches and the remote's branches (as of the last fetch), current first, then by name.
pub fn list_branches(root: &str) -> Res<Vec<BranchInfo>> {
    let repo = Repository::open(root).map_err(err)?;
    let current = current_branch(&repo);
    let remote = pick_remote(&repo);
    let mut out: Vec<BranchInfo> = Vec::new();
    for b in repo.branches(Some(git2::BranchType::Local)).map_err(err)?.flatten() {
        if let Ok(Some(name)) = b.0.name() {
            out.push(BranchInfo { name: name.to_string(), current: false, local: true, remote: false });
        }
    }
    if let Some(remote) = &remote {
        let prefix = format!("{remote}/");
        for b in repo.branches(Some(git2::BranchType::Remote)).map_err(err)?.flatten() {
            let Ok(Some(full)) = b.0.name() else { continue };
            let Some(name) = full.strip_prefix(&prefix) else { continue };
            if name == "HEAD" {
                continue;
            }
            match out.iter_mut().find(|x| x.name == name) {
                Some(x) => x.remote = true,
                None => out.push(BranchInfo { name: name.to_string(), current: false, local: false, remote: true }),
            }
        }
    }
    if let Some(cur) = &current {
        match out.iter_mut().find(|x| &x.name == cur) {
            Some(x) => x.current = true,
            // A branch without commits yet.
            None => out.push(BranchInfo { name: cur.clone(), current: true, local: true, remote: false }),
        }
    }
    out.sort_by(|a, b| b.current.cmp(&a.current).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

fn check_branch_name(name: &str) -> Res<()> {
    if name.trim().is_empty() || !git2::Branch::name_is_valid(name).unwrap_or(false) {
        return Err(format!("“{name}” is not a valid branch name"));
    }
    Ok(())
}

/// Switches to `name`. A branch that only exists on the remote gets a local branch that tracks it.
/// Fails without changing anything when local changes would be overwritten.
pub fn switch_branch(root: &str, name: &str) -> Res<RepoInfo> {
    let repo = Repository::open(root).map_err(err)?;
    if current_branch(&repo).as_deref() == Some(name) {
        return info_of(&repo);
    }
    let local_ref = format!("refs/heads/{name}");
    let remote = pick_remote(&repo);
    let target = match repo.refname_to_id(&local_ref) {
        Ok(oid) => oid,
        Err(_) => {
            let r = remote.as_deref().ok_or_else(|| format!("There is no branch called {name}"))?;
            repo.refname_to_id(&format!("refs/remotes/{r}/{name}"))
                .map_err(|_| format!("There is no branch called {name}"))?
        }
    };
    let commit = repo.find_commit(target).map_err(err)?;
    repo.checkout_tree(commit.as_object(), Some(CheckoutBuilder::new().safe()))
        .map_err(|e| format!("Can't switch branch: local changes would be overwritten ({})", e.message()))?;
    if repo.find_reference(&local_ref).is_err() {
        let mut b = repo.branch(name, &commit, false).map_err(err)?;
        if let Some(r) = &remote {
            let _ = b.set_upstream(Some(&format!("{r}/{name}")));
        }
    }
    repo.set_head(&local_ref).map_err(err)?;
    info_of(&repo)
}

/// Creates `name` at the current commit and switches to it (files on disk stay as they are).
pub fn create_branch(root: &str, name: &str) -> Res<RepoInfo> {
    check_branch_name(name)?;
    let repo = Repository::open(root).map_err(err)?;
    let local_ref = format!("refs/heads/{name}");
    if repo.find_reference(&local_ref).is_ok() {
        return Err(format!("A branch called {name} already exists"));
    }
    match repo.head().ok().and_then(|h| h.peel_to_commit().ok()) {
        Some(head) => {
            repo.branch(name, &head, false).map_err(err)?;
        }
        None => {} // no commits yet: HEAD just points at the new (unborn) branch
    }
    repo.set_head(&local_ref).map_err(err)?;
    info_of(&repo)
}

/// For a branch the server won't accept pushes to: moves the unpushed commits to a new branch `name`
/// (which becomes the current one) and puts the old branch back where the remote has it.
/// Files on disk don't change. Push afterwards with `sync`.
pub fn move_to_new_branch(root: &str, name: &str) -> Res<RepoInfo> {
    check_branch_name(name)?;
    let repo = Repository::open(root).map_err(err)?;
    let old = current_branch(&repo).ok_or("No branch is checked out")?;
    create_branch(root, name)?;
    if let Some(remote) = pick_remote(&repo) {
        if let Ok(up) = repo.refname_to_id(&format!("refs/remotes/{remote}/{old}")) {
            let mut r = repo.find_reference(&format!("refs/heads/{old}")).map_err(err)?;
            r.set_target(up, "notepad: commits moved to a new branch").map_err(err)?;
        }
    }
    info_of(&repo)
}

/// Path of `file` relative to `root`, with forward slashes; None if it is outside the repository.
pub fn relative_to(root: &str, file: &str) -> Option<String> {
    let rel = Path::new(file).strip_prefix(root).ok()?;
    if rel.as_os_str().is_empty() {
        return None;
    }
    let s = rel.to_string_lossy().replace('\\', "/");
    if s == ".git" || s.starts_with(".git/") {
        return None;
    }
    Some(s)
}
