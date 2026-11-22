//! Where git credentials come from. Lookup order for a remote URL:
//!   1. what the user signed in with in this app (stored in the OS keychain), refreshed when it has expired;
//!   2. whatever the user's own git credential helper has (Git Credential Manager, osxkeychain, …).

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

const SERVICE: &str = "no.1011.notepad";

/// What is kept in the keychain for one host. `secret` is the personal access token or the OAuth access token.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stored {
    /// "pat" | "oauth"
    pub kind: String,
    /// "github" | "gitlab" | "forgejo" | "bitbucket" | "azure" | "other"
    pub provider: String,
    pub username: String,
    pub secret: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// Unix seconds when the access token expires.
    #[serde(default)]
    pub expires_at: Option<u64>,
    // What is needed to refresh an OAuth token later.
    #[serde(default)]
    pub token_url: Option<String>,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub client_secret: Option<String>,
}

/// A username/secret pair ready to hand to git. With `bearer` the secret is sent as `Authorization: Bearer`.
#[derive(Clone, Debug)]
pub struct Credential {
    pub username: String,
    pub secret: String,
    pub bearer: bool,
}

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// "github.com" or "git.example.com:8443" for a URL; the key credentials are stored under.
pub fn host_of(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    let host = u.host_str()?.to_lowercase();
    Some(match u.port() {
        Some(p) => format!("{host}:{p}"),
        None => host,
    })
}

fn entry(host: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &host.to_lowercase()).map_err(|e| e.to_string())
}

/// Part `n` (1-based) of a secret that didn't fit in one entry.
fn part_entry(host: &str, n: usize) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("{}#{n}", host.to_lowercase())).map_err(|e| e.to_string())
}

/// Windows' Credential Manager holds at most 2560 bytes per entry and keyring stores UTF-16 there (1280 code
/// units). OAuth sign-ins (access + refresh token, often JWTs) are longer, so longer secrets are split.
const PART_UNITS: usize = 1000;
const PARTS_PREFIX: &str = "parts:";

/// Splits a secret into pieces of at most PART_UNITS UTF-16 code units, never inside a character.
/// A secret that fits stays in one piece (that is also how everything was stored before splitting existed).
fn split_secret(s: &str) -> Vec<String> {
    let mut parts = vec![String::new()];
    let mut units = 0;
    for c in s.chars() {
        let n = c.len_utf16();
        if units + n > PART_UNITS {
            parts.push(String::new());
            units = 0;
        }
        parts.last_mut().unwrap().push(c);
        units += n;
    }
    parts
}

/// How many parts the main entry's value says there are (None: the value is the secret itself).
fn parts_count(main: &str) -> Option<usize> {
    main.strip_prefix(PARTS_PREFIX)?.parse().ok()
}

fn delete_parts(host: &str, count: usize) {
    for n in 1..=count {
        if let Ok(e) = part_entry(host, n) {
            let _ = e.delete_credential();
        }
    }
}

pub fn save(host: &str, stored: &Stored) -> Result<(), String> {
    let json = serde_json::to_string(stored).map_err(|e| e.to_string())?;
    let err = |e: keyring::Error| format!("Could not save to the system keychain: {e}");
    let main = entry(host)?;
    // Parts of an earlier, longer secret would be left behind.
    if let Some(old) = main.get_password().ok().as_deref().and_then(parts_count) {
        delete_parts(host, old);
    }
    let parts = split_secret(&json);
    if parts.len() == 1 {
        return main.set_password(&json).map_err(err);
    }
    for (i, p) in parts.iter().enumerate() {
        part_entry(host, i + 1)?.set_password(p).map_err(err)?;
    }
    main.set_password(&format!("{PARTS_PREFIX}{}", parts.len())).map_err(err)
}

pub fn load(host: &str) -> Option<Stored> {
    let main = entry(host).ok()?.get_password().ok()?;
    let json = match parts_count(&main) {
        None => main,
        Some(n) => {
            let mut all = String::new();
            for i in 1..=n {
                all.push_str(&part_entry(host, i).ok()?.get_password().ok()?);
            }
            all
        }
    };
    serde_json::from_str(&json).ok()
}

pub fn delete(host: &str) -> Result<(), String> {
    let main = entry(host)?;
    if let Some(n) = main.get_password().ok().as_deref().and_then(parts_count) {
        delete_parts(host, n);
    }
    match main.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// The stored token for `host`, refreshed first if it is about to expire.
pub fn fresh(host: &str) -> Option<Stored> {
    let mut s = load(host)?;
    if let (Some(exp), Some(_), Some(_)) = (s.expires_at, &s.refresh_token, &s.token_url) {
        if now_secs() + 60 >= exp {
            if let Ok(next) = crate::oauth::refresh(&s) {
                let _ = save(host, &next);
                s = next;
            }
        }
    }
    Some(s)
}

/// The user name to send with a stored token (some providers want a fixed one with OAuth tokens).
fn username_for(s: &Stored) -> String {
    if s.kind == "oauth" {
        return match s.provider.as_str() {
            "bitbucket" => "x-token-auth".to_string(),
            "github" => "x-access-token".to_string(),
            "gitlab" => "oauth2".to_string(),
            _ if !s.username.is_empty() => s.username.clone(),
            _ => "oauth2".to_string(),
        };
    }
    s.username.clone()
}

fn from_helper(url: &str, cfg: &git2::Config) -> Option<Credential> {
    let mut helper = git2::CredentialHelper::new(url);
    helper.config(cfg);
    let (username, secret) = helper.execute()?;
    Some(Credential { username, secret, bearer: false })
}

/// Finds credentials for a remote URL (see the module docs for the order).
pub fn resolve(url: &str, cfg: &git2::Config) -> Option<Credential> {
    if let Some(host) = host_of(url) {
        if let Some(s) = fresh(&host) {
            let bearer = s.kind == "oauth" && s.provider == "azure";
            return Some(Credential { username: username_for(&s), secret: s.secret, bearer });
        }
    }
    from_helper(url, cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_secrets_stay_in_one_piece() {
        assert_eq!(split_secret("{\"kind\":\"pat\"}"), vec!["{\"kind\":\"pat\"}".to_string()]);
        assert_eq!(parts_count("{\"kind\":\"pat\"}"), None);
    }

    #[test]
    fn long_secrets_split_and_join_back() {
        // A long OAuth sign-in with non-ASCII and characters outside the BMP (two UTF-16 units each).
        let s: String = "ø🙂abc".repeat(700);
        let parts = split_secret(&s);
        assert!(parts.len() > 1);
        for p in &parts {
            assert!(p.encode_utf16().count() <= PART_UNITS);
            assert!(p.encode_utf16().count() * 2 <= 2560, "fits Windows' Credential Manager");
        }
        assert_eq!(parts.concat(), s);
        assert_eq!(parts_count(&format!("{PARTS_PREFIX}{}", parts.len())), Some(parts.len()));
    }
}
