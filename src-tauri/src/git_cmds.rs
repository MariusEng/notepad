//! Tauri commands for the git features. They only forward to `gitops`, `creds`, `oauth` and `provider`;
//! anything that can take a while (network) runs on a worker thread so the UI stays responsive.

use crate::creds::{self, Stored};
use crate::files::{self, GitPathInfo};
use crate::gitops::{self, BranchInfo, DirEntry, RepoInfo, SyncResult};
use crate::oauth;
use crate::provider::{self, NewRepo, ProviderCfg, RepoCreated};
use serde::Serialize;

type Res<T> = Result<T, String>;

async fn blocking<T, F>(f: F) -> Res<T>
where
    F: FnOnce() -> Res<T> + Send + 'static,
    T: Send + 'static,
{
    let joined = tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?;
    joined
}

// ---------------------------------------------------------------- folder browser

#[tauri::command]
pub fn fs_list_dir(dir: String) -> Res<Vec<DirEntry>> {
    files::list_dir(&dir)
}

#[tauri::command]
pub fn fs_create_file(dir: String, name: String) -> Res<String> {
    files::create_file(&dir, &name)
}

#[tauri::command]
pub fn fs_create_dir(dir: String, name: String) -> Res<String> {
    files::create_dir(&dir, &name)
}

/// Moves a file or folder to the Trash.
#[tauri::command]
pub fn fs_trash(path: String) -> Res<()> {
    files::move_to_trash(&path)
}

/// Commits the removal of a file or folder that was deleted (moved to the Trash). None: nothing tracked was there.
#[tauri::command]
pub fn git_commit_removal(root: String, path: String, author: Option<String>) -> Res<Option<String>> {
    gitops::commit_removal(&root, &path, author.as_deref())
}

/// The git repository a file belongs to (None: not in one, or ignored), for the tab bar's git mark.
#[tauri::command]
pub fn git_path_info(path: String) -> Option<GitPathInfo> {
    files::git_path_info(&path)
}

// ---------------------------------------------------------------- repository

#[tauri::command]
pub fn git_open(path: String) -> Res<RepoInfo> {
    gitops::open(&path)
}

#[tauri::command]
pub fn git_info(root: String) -> Res<RepoInfo> {
    gitops::info(&root)
}

#[tauri::command]
pub fn git_list_dir(root: String, rel: String) -> Res<Vec<DirEntry>> {
    gitops::list_dir(&root, &rel)
}

/// Commits one saved file. Returns the commit message, or None if nothing changed (or the file is ignored/outside).
#[tauri::command]
pub fn git_commit_file(root: String, file: String, author: Option<String>) -> Res<Option<String>> {
    gitops::commit_file(&root, &file, author.as_deref())
}

#[tauri::command]
pub async fn git_sync(root: String) -> Res<SyncResult> {
    blocking(move || gitops::sync(&root)).await
}

#[tauri::command]
pub fn git_branches(root: String) -> Res<Vec<BranchInfo>> {
    gitops::list_branches(&root)
}

#[tauri::command]
pub fn git_switch_branch(root: String, name: String) -> Res<RepoInfo> {
    gitops::switch_branch(&root, &name)
}

#[tauri::command]
pub fn git_create_branch(root: String, name: String) -> Res<RepoInfo> {
    gitops::create_branch(&root, &name)
}

#[tauri::command]
pub fn git_move_to_branch(root: String, name: String) -> Res<RepoInfo> {
    gitops::move_to_new_branch(&root, &name)
}

#[tauri::command]
pub async fn git_clone(url: String, dest: String) -> Res<RepoInfo> {
    blocking(move || gitops::clone_repo(&url, &dest)).await
}

// ---------------------------------------------------------------- accounts

#[tauri::command]
pub fn cred_save_pat(host: String, username: String, token: String, provider: String) -> Res<()> {
    if host.trim().is_empty() || token.trim().is_empty() {
        return Err("Enter the server and the token".into());
    }
    let stored = Stored {
        kind: "pat".into(),
        provider,
        username: username.trim().to_string(),
        secret: token.trim().to_string(),
        ..Default::default()
    };
    creds::save(host.trim(), &stored)
}

#[tauri::command]
pub fn cred_delete(host: String) -> Res<()> {
    creds::delete(&host)
}

#[tauri::command]
pub fn cred_exists(host: String) -> bool {
    creds::load(&host).is_some()
}

// ---------------------------------------------------------------- OAuth

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignIn {
    /// "pending" | "slow_down" | "done" | "denied" | "expired"
    pub status: String,
    pub username: Option<String>,
}

/// Opens a web page in the default browser (only http/https addresses).
#[tauri::command]
pub fn open_external(url: String) -> Res<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only web addresses can be opened".into());
    }
    oauth::open_url(&url);
    Ok(())
}

#[tauri::command]
pub fn oauth_redirect_uri() -> String {
    oauth::redirect_uri()
}

#[tauri::command]
pub async fn oauth_device_start(cfg: ProviderCfg) -> Res<oauth::DeviceStart> {
    blocking(move || oauth::device_start(&cfg)).await
}

/// Checks whether the user has approved the device code. The tokens go straight into the keychain.
#[tauri::command]
pub async fn oauth_device_poll(cfg: ProviderCfg, device_code: String) -> Res<SignIn> {
    blocking(move || {
        let poll = oauth::device_poll(&cfg, &device_code)?;
        let mut username = None;
        if let Some(stored) = poll.stored {
            creds::save(&cfg.host(), &stored)?;
            username = Some(stored.username);
        }
        Ok(SignIn { status: poll.status, username })
    })
    .await
}

/// Browser sign-in (authorization code + PKCE). Resolves when the user has finished in the browser.
#[tauri::command]
pub async fn oauth_login(cfg: ProviderCfg) -> Res<SignIn> {
    blocking(move || {
        let stored = oauth::authcode(&cfg, oauth::open_url)?;
        creds::save(&cfg.host(), &stored)?;
        Ok(SignIn { status: "done".into(), username: Some(stored.username) })
    })
    .await
}

// ---------------------------------------------------------------- new repository

/// Creates a private repository with the account signed in for that provider.
#[tauri::command]
pub async fn git_create_repo(cfg: ProviderCfg, repo: NewRepo) -> Res<RepoCreated> {
    blocking(move || {
        let host = cfg.host();
        let account = creds::fresh(&host).ok_or_else(|| format!("AUTH_REQUIRED:{host}"))?;
        provider::create_repo(&cfg, &account, &repo)
    })
    .await
}
