//! Git hosting providers: endpoints, and creating a new private repository over their REST APIs.
//! Supported: GitHub (and Enterprise), GitLab (and self-hosted), Forgejo/Gitea, Bitbucket Cloud, Azure DevOps.

use crate::creds::{self, Stored};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

pub type Res<T> = Result<T, String>;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCfg {
    /// "github" | "gitlab" | "forgejo" | "bitbucket" | "azure"
    pub kind: String,
    /// Web address of the server, e.g. https://github.com, https://gitlab.example.com, https://git.1011.no,
    /// https://bitbucket.org, https://dev.azure.com
    pub base_url: String,
    /// OAuth app client id (only needed for OAuth sign-in).
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    /// Azure DevOps: Entra tenant (default "organizations").
    #[serde(default)]
    pub tenant: Option<String>,
    /// Replaces the REST API address (used by tests).
    #[serde(default)]
    pub api_url: Option<String>,
}

impl ProviderCfg {
    pub fn base(&self) -> String {
        self.base_url.trim().trim_end_matches('/').to_string()
    }

    /// Key credentials are stored under: the git host, e.g. "github.com".
    pub fn host(&self) -> String {
        creds::host_of(&self.base()).unwrap_or_default()
    }

    pub fn api_base(&self) -> String {
        if let Some(a) = &self.api_url {
            return a.trim_end_matches('/').to_string();
        }
        let b = self.base();
        match self.kind.as_str() {
            "github" if self.host() == "github.com" => "https://api.github.com".into(),
            "github" => format!("{b}/api/v3"),
            "gitlab" => format!("{b}/api/v4"),
            "forgejo" => format!("{b}/api/v1"),
            "bitbucket" => "https://api.bitbucket.org/2.0".into(),
            _ => b, // azure
        }
    }

    pub fn authorize_url(&self) -> String {
        let b = self.base();
        match self.kind.as_str() {
            "gitlab" => format!("{b}/oauth/authorize"),
            "bitbucket" => "https://bitbucket.org/site/oauth2/authorize".into(),
            "azure" => format!("https://login.microsoftonline.com/{}/oauth2/v2.0/authorize", self.tenant()),
            _ => format!("{b}/login/oauth/authorize"), // github, forgejo
        }
    }

    pub fn token_url(&self) -> String {
        let b = self.base();
        match self.kind.as_str() {
            "gitlab" => format!("{b}/oauth/token"),
            "bitbucket" => "https://bitbucket.org/site/oauth2/access_token".into(),
            "azure" => format!("https://login.microsoftonline.com/{}/oauth2/v2.0/token", self.tenant()),
            _ => format!("{b}/login/oauth/access_token"),
        }
    }

    /// Device-flow endpoint, for providers that have one.
    pub fn device_url(&self) -> Option<String> {
        let b = self.base();
        match self.kind.as_str() {
            "github" => Some(format!("{b}/login/device/code")),
            "gitlab" => Some(format!("{b}/oauth/authorize_device")),
            _ => None,
        }
    }

    pub fn scope(&self) -> Option<&'static str> {
        match self.kind.as_str() {
            "github" => Some("repo"),
            "gitlab" => Some("api"),
            "azure" => Some("499b84ac-1321-427f-aa17-267ca6975798/user_impersonation offline_access"),
            _ => None,
        }
    }

    fn tenant(&self) -> String {
        self.tenant.clone().filter(|t| !t.trim().is_empty()).unwrap_or_else(|| "organizations".into())
    }
}

// ---------------------------------------------------------------- http helpers

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).user_agent("Notepad").build()
}

/// Runs a request and returns (status, JSON body); HTTP error statuses are returned, not raised.
pub(crate) fn finish(resp: Result<ureq::Response, ureq::Error>) -> Res<(u16, Value)> {
    match resp {
        Ok(r) => {
            let code = r.status();
            Ok((code, r.into_json().unwrap_or(Value::Null)))
        }
        Err(ureq::Error::Status(code, r)) => Ok((code, r.into_json().unwrap_or(Value::Null))),
        Err(e) => Err(format!("Network error: {e}")),
    }
}

pub(crate) fn post_form(url: &str, form: &[(&str, &str)], basic: Option<(&str, &str)>) -> Res<(u16, Value)> {
    let mut req = agent().post(url).set("Accept", "application/json");
    if let Some((u, p)) = basic {
        req = req.set("Authorization", &format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{u}:{p}"))));
    }
    finish(req.send_form(form))
}

pub(crate) fn get_json(url: &str, auth: Option<&str>) -> Res<(u16, Value)> {
    let mut req = agent().get(url).set("Accept", "application/json");
    if let Some(a) = auth {
        req = req.set("Authorization", a);
    }
    finish(req.call())
}

fn error_text(code: u16, body: &Value) -> String {
    let pick = |k: &str| body.get(k).and_then(|v| v.as_str()).map(|s| s.to_string());
    let mut msg = pick("message")
        .or_else(|| pick("error_description"))
        .or_else(|| pick("error"))
        .or_else(|| body.pointer("/error/message").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| format!("HTTP {code}"));
    // GitHub: details are in errors[].message
    if let Some(list) = body.get("errors").and_then(|e| e.as_array()) {
        let more: Vec<String> = list.iter().filter_map(|e| e.get("message").and_then(|m| m.as_str()).map(|s| s.to_string())).collect();
        if !more.is_empty() {
            msg = format!("{msg} ({})", more.join("; "));
        }
    }
    msg
}

// ---------------------------------------------------------------- auth header

/// The Authorization header value for API calls with this account.
pub fn auth_header(cfg: &ProviderCfg, s: &Stored) -> String {
    let basic = |u: &str, p: &str| format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("{u}:{p}")));
    match (cfg.kind.as_str(), s.kind.as_str()) {
        ("forgejo", "pat") => format!("token {}", s.secret),
        ("bitbucket", "pat") => basic(&s.username, &s.secret),
        ("azure", "pat") => basic("", &s.secret),
        _ => format!("Bearer {}", s.secret),
    }
}

/// Best-effort: the account's user name, to show in the UI and use as commit author.
pub fn fetch_username(cfg: &ProviderCfg, s: &Stored) -> Option<String> {
    let api = cfg.api_base();
    let auth = auth_header(cfg, s);
    let (url, keys): (String, &[&str]) = match cfg.kind.as_str() {
        "github" | "forgejo" => (format!("{api}/user"), &["login"]),
        "gitlab" => (format!("{api}/user"), &["username"]),
        "bitbucket" => (format!("{api}/user"), &["nickname", "username", "display_name"]),
        "azure" => ("https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1".into(), &["displayName", "emailAddress"]),
        _ => return None,
    };
    let (code, body) = get_json(&url, Some(&auth)).ok()?;
    if code >= 300 {
        return None;
    }
    keys.iter().find_map(|k| body.get(*k).and_then(|v| v.as_str()).map(|s| s.to_string()))
}

// ---------------------------------------------------------------- create repository

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewRepo {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Organisation / workspace / group to create it in. GitHub and Forgejo: optional (default: your account).
    /// Bitbucket: the workspace (required). Azure DevOps: the organisation (required).
    #[serde(default)]
    pub owner: Option<String>,
    /// Azure DevOps project (required there).
    #[serde(default)]
    pub project: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoCreated {
    pub clone_url: String,
    pub web_url: String,
}

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

fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 100 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn text(v: &Value, ptr: &str) -> Option<String> {
    v.pointer(ptr).and_then(|x| x.as_str()).map(|s| s.to_string())
}

/// Creates a private repository and returns its HTTPS clone URL. GitHub, GitLab and Forgejo create it with a
/// README (so it can be cloned right away); Bitbucket and Azure DevOps create it empty.
/// The caller must pass the stored credentials for the provider's host.
pub fn create_repo(cfg: &ProviderCfg, account: &Stored, req: &NewRepo) -> Res<RepoCreated> {
    let name = req.name.trim();
    if !valid_name(name) {
        return Err("Use only letters, digits, '.', '_' and '-' in the repository name".into());
    }
    let api = cfg.api_base();
    let auth = auth_header(cfg, account);
    let owner = req.owner.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let post = |url: &str, body: Value| -> Res<(u16, Value)> {
        finish(agent().post(url).set("Authorization", &auth).set("Accept", "application/json").send_json(body))
    };

    let (url, body) = match cfg.kind.as_str() {
        "github" => (
            match owner {
                Some(o) => format!("{api}/orgs/{o}/repos"),
                None => format!("{api}/user/repos"),
            },
            json!({ "name": name, "description": req.description, "private": true, "auto_init": true }),
        ),
        "gitlab" => (
            format!("{api}/projects"),
            json!({ "name": name, "description": req.description, "visibility": "private", "initialize_with_readme": true }),
        ),
        "forgejo" => (
            match owner {
                Some(o) => format!("{api}/orgs/{o}/repos"),
                None => format!("{api}/user/repos"),
            },
            json!({ "name": name, "description": req.description, "private": true, "auto_init": true, "default_branch": "main" }),
        ),
        "bitbucket" => {
            let ws = owner.ok_or("Enter your Bitbucket workspace")?;
            let slug: String = name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
            (
                format!("{api}/repositories/{ws}/{slug}"),
                json!({ "scm": "git", "name": name, "description": req.description, "is_private": true }),
            )
        }
        "azure" => {
            let org = owner.ok_or("Enter your Azure DevOps organisation")?;
            let project = req.project.as_deref().map(str::trim).filter(|s| !s.is_empty()).ok_or("Enter the Azure DevOps project")?;
            (format!("{api}/{org}/{project}/_apis/git/repositories?api-version=7.1"), json!({ "name": name }))
        }
        other => return Err(format!("Unknown provider: {other}")),
    };

    let (code, resp) = post(&url, body)?;
    if code == 401 || code == 403 && cfg.kind != "github" {
        return Err(format!("AUTH_REQUIRED:{}", cfg.host()));
    }
    if code >= 300 {
        return Err(format!("Could not create the repository: {}", error_text(code, &resp)));
    }

    let (clone, web) = match cfg.kind.as_str() {
        "github" | "forgejo" => (text(&resp, "/clone_url"), text(&resp, "/html_url")),
        "gitlab" => (text(&resp, "/http_url_to_repo"), text(&resp, "/web_url")),
        "bitbucket" => (
            resp.pointer("/links/clone")
                .and_then(|c| c.as_array())
                .and_then(|a| a.iter().find(|e| e.get("name").and_then(|n| n.as_str()) == Some("https")))
                .and_then(|e| e.get("href").and_then(|h| h.as_str()))
                .map(|s| s.to_string()),
            text(&resp, "/links/html/href"),
        ),
        _ => (text(&resp, "/remoteUrl"), text(&resp, "/webUrl")),
    };
    let clone_url = clone.map(|u| strip_userinfo(&u)).ok_or("The server did not return a clone URL")?;
    Ok(RepoCreated { clone_url, web_url: web.unwrap_or_default() })
}
