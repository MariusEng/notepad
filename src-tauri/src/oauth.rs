//! OAuth sign-in. Two flows, both without a client secret where the provider allows it:
//!   * device flow (GitHub, GitLab): the user types a short code on the provider's website;
//!   * authorization code + PKCE through a loopback redirect (Forgejo/Gitea, Bitbucket, Azure DevOps, GitLab):
//!     a browser opens, and the provider redirects to http://127.0.0.1:51789.
//! The client id comes from the frontend: a built-in one where the provider has one that anybody may use
//! (Forgejo/Gitea pre-register apps for git credential helpers), otherwise the user's own OAuth app.

use crate::creds::{now_secs, Stored};
use crate::provider::{fetch_username, post_form, ProviderCfg};
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

pub type Res<T> = Result<T, String>;

/// The redirect address (to register with your own OAuth app). It has no path on purpose: Forgejo and Gitea's
/// built-in apps register exactly "http://127.0.0.1" and ignore the port.
pub const REDIRECT_PORT: u16 = 51789;
pub fn redirect_uri() -> String {
    format!("http://127.0.0.1:{REDIRECT_PORT}")
}

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn random_token(len: usize) -> Res<String> {
    let mut buf = vec![0u8; len];
    getrandom::getrandom(&mut buf).map_err(|e| format!("No random numbers available: {e}"))?;
    Ok(b64url(&buf))
}

fn token_error(code: u16, body: &Value) -> String {
    let d = body.get("error_description").and_then(|v| v.as_str());
    let e = body.get("error").and_then(|v| v.as_str());
    match (e, d) {
        (Some(e), Some(d)) => format!("{e}: {d}"),
        (Some(e), None) => e.to_string(),
        _ => format!("Sign-in failed (HTTP {code})"),
    }
}

/// Turns a token endpoint response into what we keep in the keychain.
fn to_stored(cfg: &ProviderCfg, body: &Value, previous: Option<&Stored>) -> Res<Stored> {
    let access = body.get("access_token").and_then(|v| v.as_str()).ok_or("The server returned no access token")?;
    let mut s = Stored {
        kind: "oauth".into(),
        provider: cfg.kind.clone(),
        username: previous.map(|p| p.username.clone()).unwrap_or_default(),
        secret: access.to_string(),
        refresh_token: body
            .get("refresh_token")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| previous.and_then(|p| p.refresh_token.clone())),
        expires_at: body.get("expires_in").and_then(|v| v.as_u64()).map(|n| now_secs() + n),
        token_url: Some(cfg.token_url()),
        client_id: Some(cfg.client_id.clone()),
        client_secret: cfg.client_secret.clone().filter(|s| !s.is_empty()),
    };
    if s.username.is_empty() {
        s.username = fetch_username(cfg, &s).unwrap_or_default();
    }
    Ok(s)
}

fn secret_of(cfg: &ProviderCfg) -> Option<String> {
    cfg.client_secret.clone().filter(|s| !s.is_empty())
}

// ---------------------------------------------------------------- device flow

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStart {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

pub fn device_start(cfg: &ProviderCfg) -> Res<DeviceStart> {
    let url = cfg.device_url().ok_or("This provider has no device sign-in; use browser sign-in")?;
    if cfg.client_id.is_empty() {
        return Err("Enter the OAuth app's client id".into());
    }
    let mut form = vec![("client_id", cfg.client_id.as_str())];
    if let Some(sc) = cfg.scope() {
        form.push(("scope", sc));
    }
    let (code, body) = post_form(&url, &form, None)?;
    if code >= 300 || body.get("device_code").is_none() {
        return Err(token_error(code, &body));
    }
    let get = |k: &str| body.get(k).and_then(|v| v.as_str()).unwrap_or_default().to_string();
    Ok(DeviceStart {
        device_code: get("device_code"),
        user_code: get("user_code"),
        verification_uri: get("verification_uri"),
        interval: body.get("interval").and_then(|v| v.as_u64()).unwrap_or(5).max(1),
        expires_in: body.get("expires_in").and_then(|v| v.as_u64()).unwrap_or(900),
    })
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DevicePoll {
    /// "pending" | "slow_down" | "done" | "denied" | "expired"
    pub status: String,
    pub stored: Option<Stored>,
}

pub fn device_poll(cfg: &ProviderCfg, device_code: &str) -> Res<DevicePoll> {
    let secret = secret_of(cfg);
    let mut form = vec![
        ("client_id", cfg.client_id.as_str()),
        ("device_code", device_code),
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
    ];
    if let Some(s) = &secret {
        form.push(("client_secret", s.as_str()));
    }
    let (code, body) = post_form(&cfg.token_url(), &form, None)?;
    if body.get("access_token").is_some() {
        return Ok(DevicePoll { status: "done".into(), stored: Some(to_stored(cfg, &body, None)?) });
    }
    let status = match body.get("error").and_then(|v| v.as_str()) {
        Some("authorization_pending") => "pending",
        Some("slow_down") => "slow_down",
        Some("access_denied") => "denied",
        Some("expired_token") => "expired",
        _ => return Err(token_error(code, &body)),
    };
    Ok(DevicePoll { status: status.into(), stored: None })
}

// ---------------------------------------------------------------- authorization code + PKCE

fn query_param(query: &str, key: &str) -> Option<String> {
    url::form_urlencoded::parse(query.as_bytes()).find(|(k, _)| k == key).map(|(_, v)| v.into_owned())
}

/// Opens `url` in the default browser.
pub fn open_url(url: &str) {
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

fn reply(stream: &mut std::net::TcpStream, ok: bool) {
    let msg = if ok { "Signed in. You can close this window and return to Notepad." } else { "Sign-in failed. Return to Notepad for details." };
    let html = format!("<!doctype html><meta charset=utf-8><title>Notepad</title><body style=\"font:16px system-ui;margin:3em\">{msg}</body>");
    let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}", html.len());
}

/// Runs the whole browser sign-in: opens the browser (through `open`), waits up to three minutes for the
/// redirect, and exchanges the code for tokens.
pub fn authcode(cfg: &ProviderCfg, open: impl FnOnce(&str)) -> Res<Stored> {
    if cfg.client_id.is_empty() {
        return Err("Enter the OAuth app's client id".into());
    }
    let verifier = random_token(48)?;
    let challenge = b64url(&Sha256::digest(verifier.as_bytes()));
    let state = random_token(16)?;

    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
        .map_err(|e| format!("Could not listen on port {REDIRECT_PORT} for the sign-in redirect: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let mut url = url::Url::parse(&cfg.authorize_url()).map_err(|e| format!("Bad server address: {e}"))?;
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("response_type", "code")
            .append_pair("client_id", &cfg.client_id)
            .append_pair("redirect_uri", &redirect_uri())
            .append_pair("state", &state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");
        if let Some(sc) = cfg.scope() {
            q.append_pair("scope", sc);
        }
    }
    open(url.as_str());

    let deadline = Instant::now() + Duration::from_secs(180);
    let code = loop {
        if Instant::now() > deadline {
            return Err("Sign-in timed out. Try again.".into());
        }
        let mut stream = match listener.accept() {
            Ok((s, _)) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let head = String::from_utf8_lossy(&buf[..n]).to_string();
        let target = head.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("");
        let query = match target.split_once('?') {
            Some(("/" | "/callback", q)) => q,
            _ => {
                reply(&mut stream, false); // e.g. a favicon request: keep waiting
                continue;
            }
        };
        if let Some(e) = query_param(query, "error") {
            reply(&mut stream, false);
            return Err(format!("Sign-in was not completed: {}", query_param(query, "error_description").unwrap_or(e)));
        }
        if query_param(query, "state").as_deref() != Some(state.as_str()) {
            reply(&mut stream, false);
            continue;
        }
        match query_param(query, "code") {
            Some(c) => {
                reply(&mut stream, true);
                break c;
            }
            None => {
                reply(&mut stream, false);
                continue;
            }
        }
    };

    let redirect = redirect_uri();
    let secret = secret_of(cfg);
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("client_id", cfg.client_id.as_str()),
        ("code_verifier", verifier.as_str()),
    ];
    // Bitbucket wants the client secret as HTTP Basic credentials; everyone else takes it in the form.
    let basic = if cfg.kind == "bitbucket" { secret.as_deref().map(|s| (cfg.client_id.as_str(), s)) } else { None };
    if basic.is_none() {
        if let Some(s) = &secret {
            form.push(("client_secret", s.as_str()));
        }
    }
    let (status, body) = post_form(&cfg.token_url(), &form, basic)?;
    if status >= 300 || body.get("access_token").is_none() {
        return Err(token_error(status, &body));
    }
    to_stored(cfg, &body, None)
}

// ---------------------------------------------------------------- refresh

pub fn refresh(s: &Stored) -> Res<Stored> {
    let (Some(token_url), Some(client_id), Some(refresh)) = (&s.token_url, &s.client_id, &s.refresh_token) else {
        return Err("Nothing to refresh".into());
    };
    let mut form = vec![("grant_type", "refresh_token"), ("refresh_token", refresh.as_str()), ("client_id", client_id.as_str())];
    let secret = s.client_secret.clone();
    let basic = if s.provider == "bitbucket" { secret.as_deref().map(|sec| (client_id.as_str(), sec)) } else { None };
    if basic.is_none() {
        if let Some(sec) = &secret {
            form.push(("client_secret", sec.as_str()));
        }
    }
    let (code, body) = post_form(token_url, &form, basic)?;
    if code >= 300 || body.get("access_token").is_none() {
        return Err(token_error(code, &body));
    }
    let cfg = ProviderCfg {
        kind: s.provider.clone(),
        base_url: String::new(),
        client_id: client_id.clone(),
        client_secret: secret,
        tenant: None,
        api_url: None,
    };
    let mut next = to_stored(&cfg, &body, Some(s))?;
    next.token_url = s.token_url.clone();
    Ok(next)
}
