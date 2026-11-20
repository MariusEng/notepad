//! Tests for the git features. Repositories live in temp folders and "the remote" is a bare repository
//! reached through file:// URLs; the provider APIs are played by a tiny local HTTP server.

use crate::gitops::{self, relative_to};
use git2::Repository;
use std::fs;
use std::path::Path;

fn url_of(p: &Path) -> String {
    format!("file://{}", p.display())
}

fn write(root: &str, rel: &str, text: &str) {
    let p = Path::new(root).join(rel);
    if let Some(d) = p.parent() {
        fs::create_dir_all(d).unwrap();
    }
    fs::write(p, text).unwrap();
}

fn read(root: &str, rel: &str) -> String {
    fs::read_to_string(Path::new(root).join(rel)).unwrap()
}

/// A bare "remote" plus a function to clone it.
struct Remote {
    _dir: tempfile::TempDir,
    bare: std::path::PathBuf,
}

impl Remote {
    fn new() -> Remote {
        let dir = tempfile::tempdir().unwrap();
        let bare = dir.path().join("origin.git");
        Repository::init_bare(&bare).unwrap();
        Remote { _dir: dir, bare }
    }
    fn clone_to(&self, name: &str) -> (tempfile::TempDir, String) {
        let d = tempfile::tempdir().unwrap();
        let dest = d.path().join(name);
        let info = gitops::clone_repo(&url_of(&self.bare), dest.to_str().unwrap()).unwrap();
        (d, info.root)
    }
    fn head_message(&self) -> String {
        let r = Repository::open(&self.bare).unwrap();
        let c = r.find_reference("refs/heads/master").or_else(|_| r.find_reference("refs/heads/main")).unwrap().peel_to_commit().unwrap();
        c.message().unwrap().to_string()
    }
}

fn save(root: &str, rel: &str, text: &str) -> Option<String> {
    write(root, rel, text);
    gitops::commit_file(root, &format!("{root}/{rel}"), Some("tester")).unwrap()
}

#[test]
fn first_push_to_an_empty_remote() {
    let remote = Remote::new();
    let (_d, a) = remote.clone_to("a");
    assert_eq!(save(&a, "notes.md", "hello\n").as_deref(), Some("Add notes.md"));
    let r = gitops::sync(&a).unwrap();
    assert_eq!(r.state, "pushed", "{}", r.message);
    assert_eq!(remote.head_message(), "Add notes.md");
    assert_eq!(r.info.ahead, 0);
}

#[test]
fn pull_merge_and_conflict() {
    let remote = Remote::new();
    let (_da, a) = remote.clone_to("a");
    save(&a, "a.md", "one\n");
    save(&a, "b.md", "bee\n");
    assert_eq!(gitops::sync(&a).unwrap().state, "pushed");

    let (_db, b) = remote.clone_to("b");
    assert_eq!(read(&b, "a.md"), "one\n");

    // A moves ahead; B (not yet updated) edits another file: diverged, no conflict -> merged.
    assert_eq!(save(&a, "a.md", "two\n").as_deref(), Some("Update a.md"));
    assert_eq!(gitops::sync(&a).unwrap().state, "pushed");
    save(&b, "b.md", "bee, edited\n");
    let r = gitops::sync(&b).unwrap();
    assert_eq!(r.state, "merged", "{}", r.message);
    assert_eq!(read(&b, "a.md"), "two\n");
    assert_eq!(read(&b, "b.md"), "bee, edited\n");
    assert_eq!(r.info.ahead, 0);
    assert!(remote.head_message().starts_with("Merge"));

    // A is now behind: fast-forward.
    let r = gitops::sync(&a).unwrap();
    assert_eq!(r.state, "pulled", "{}", r.message);
    assert_eq!(read(&a, "b.md"), "bee, edited\n");
    assert_eq!(gitops::sync(&a).unwrap().state, "up-to-date");

    // Both edit the same line: conflict, nothing is overwritten, nothing is pushed.
    save(&a, "a.md", "three\n");
    assert_eq!(gitops::sync(&a).unwrap().state, "pushed");
    save(&b, "a.md", "four\n");
    let r = gitops::sync(&b).unwrap();
    assert_eq!(r.state, "conflict");
    assert_eq!(r.conflicts, vec!["a.md".to_string()]);
    assert_eq!(read(&b, "a.md"), "four\n");
    assert_eq!(r.info.ahead, 1);
    assert_eq!(remote.head_message().trim(), "Update a.md"); // A's commit is still the remote's head
    let repo = Repository::open(&b).unwrap();
    assert!(repo.state() == git2::RepositoryState::Clean);
}

#[test]
fn branches_create_switch_and_move_commits() {
    let remote = Remote::new();
    let (_da, a) = remote.clone_to("a");
    save(&a, "a.md", "one\n");
    assert_eq!(gitops::sync(&a).unwrap().state, "pushed");
    let main = gitops::info(&a).unwrap().branch.unwrap();

    // A new branch is published on the first sync.
    let info = gitops::create_branch(&a, "feature").unwrap();
    assert_eq!(info.branch.as_deref(), Some("feature"));
    assert!(gitops::create_branch(&a, "feature").is_err());
    assert!(gitops::create_branch(&a, "bad name..").is_err());
    save(&a, "f.md", "feature\n");
    assert_eq!(gitops::sync(&a).unwrap().state, "pushed");
    let bare = Repository::open(&remote.bare).unwrap();
    assert!(bare.find_reference("refs/heads/feature").is_ok());

    // Another clone sees it as a remote branch and can switch to it.
    let (_db, b) = remote.clone_to("b");
    let list = gitops::list_branches(&b).unwrap();
    assert!(list[0].current && list[0].name == main);
    let f = list.iter().find(|x| x.name == "feature").unwrap();
    assert!(f.remote && !f.local);
    assert_eq!(gitops::info(&b).unwrap().default_branch.as_deref(), Some(main.as_str()));
    let info = gitops::switch_branch(&b, "feature").unwrap();
    assert_eq!(info.branch.as_deref(), Some("feature"));
    assert_eq!(read(&b, "f.md"), "feature\n");
    assert_eq!(info.ahead, 0);
    gitops::switch_branch(&b, &main).unwrap();
    assert!(!Path::new(&b).join("f.md").exists());

    // Unsaved-to-git edits that the switch would overwrite: refused, nothing changes.
    write(&b, "a.md", "local edit\n");
    gitops::switch_branch(&b, "feature").unwrap(); // a.md is the same on both branches: fine
    write(&a, "f.md", "feature 2\n");
    save(&a, "f.md", "feature 2\n");
    gitops::sync(&a).unwrap();
    gitops::sync(&b).unwrap();
    write(&b, "f.md", "mine\n");
    assert!(gitops::switch_branch(&b, &main).is_err());
    assert_eq!(gitops::info(&b).unwrap().branch.as_deref(), Some("feature"));
    assert_eq!(read(&b, "f.md"), "mine\n");

    // Commits made on a branch the server refuses can be moved to a new branch.
    gitops::switch_branch(&a, &main).unwrap();
    save(&a, "a.md", "two\n");
    assert_eq!(gitops::info(&a).unwrap().ahead, 1);
    let info = gitops::move_to_new_branch(&a, "edits").unwrap();
    assert_eq!(info.branch.as_deref(), Some("edits"));
    assert_eq!(read(&a, "a.md"), "two\n");
    let repo = Repository::open(&a).unwrap();
    assert_eq!(
        repo.refname_to_id(&format!("refs/heads/{main}")).unwrap(),
        repo.refname_to_id(&format!("refs/remotes/origin/{main}")).unwrap()
    );
    assert_eq!(gitops::sync(&a).unwrap().state, "pushed");
    assert!(bare.find_reference("refs/heads/edits").is_ok());
}

#[test]
fn only_the_saved_file_is_committed() {
    let remote = Remote::new();
    let (_d, a) = remote.clone_to("a");
    save(&a, "keep.md", "k\n");
    // Another file is staged by someone else; it must not sneak into our commit.
    write(&a, "other.md", "o\n");
    let repo = Repository::open(&a).unwrap();
    let mut idx = repo.index().unwrap();
    idx.add_path(Path::new("other.md")).unwrap();
    idx.write().unwrap();
    save(&a, "keep.md", "k2\n");
    let head = repo.head().unwrap().peel_to_tree().unwrap();
    assert!(head.get_path(Path::new("keep.md")).is_ok());
    assert!(head.get_path(Path::new("other.md")).is_err());
    // And the saved file is clean afterwards.
    let st = repo.statuses(None).unwrap();
    let dirty: Vec<_> = st.iter().filter(|e| e.path() == Some("keep.md")).collect();
    assert!(dirty.is_empty(), "keep.md should be clean");
}

#[test]
fn unchanged_ignored_and_outside_files_make_no_commit() {
    let remote = Remote::new();
    let (_d, a) = remote.clone_to("a");
    save(&a, ".gitignore", "*.log\n");
    save(&a, "x.md", "x\n");
    assert_eq!(gitops::commit_file(&a, &format!("{a}/x.md"), None).unwrap(), None);
    assert_eq!(save(&a, "debug.log", "noise\n"), None);
    let outside = tempfile::tempdir().unwrap();
    let f = outside.path().join("o.md");
    fs::write(&f, "o").unwrap();
    assert_eq!(gitops::commit_file(&a, f.to_str().unwrap(), None).unwrap(), None);
    // Deleting a tracked file is a commit too.
    fs::remove_file(Path::new(&a).join("x.md")).unwrap();
    assert_eq!(gitops::commit_file(&a, &format!("{a}/x.md"), None).unwrap().as_deref(), Some("Delete x.md"));
}

#[test]
fn listing_and_opening() {
    let remote = Remote::new();
    let (_d, a) = remote.clone_to("a");
    save(&a, ".gitignore", "build/\n");
    save(&a, "docs/z.md", "z\n");
    save(&a, "Alpha.md", "a\n");
    write(&a, "build/out.txt", "x");
    let top = gitops::list_dir(&a, "").unwrap();
    let names: Vec<_> = top.iter().map(|e| (e.name.as_str(), e.is_dir)).collect();
    assert_eq!(names, vec![("docs", true), (".gitignore", false), ("Alpha.md", false)]);
    let docs = gitops::list_dir(&a, "docs").unwrap();
    assert_eq!(docs.len(), 1);
    // Opening from a sub-folder finds the repository root.
    let info = gitops::open(&format!("{a}/docs")).unwrap();
    assert_eq!(info.root, a);
    assert_eq!(info.name, "a");
}

#[test]
fn paths_relative_to_the_repository() {
    assert_eq!(relative_to("/r", "/r/docs/a.md").as_deref(), Some("docs/a.md"));
    assert_eq!(relative_to("/r", "/elsewhere/a.md"), None);
    assert_eq!(relative_to("/r", "/r/.git/config"), None);
    assert_eq!(relative_to("/r", "/r"), None);
}

#[test]
fn https_only() {
    let d = tempfile::tempdir().unwrap();
    let r = gitops::clone_repo("git@example.com:me/x.git", d.path().join("x").to_str().unwrap());
    assert!(r.is_err());
}

// ------------------------------------------------------------------ providers and OAuth (mock server)

mod api {
    use crate::creds::Stored;
    use crate::oauth;
    use crate::provider::{self, NewRepo, ProviderCfg};
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    type Log = Arc<Mutex<Vec<String>>>;

    /// Serves canned JSON: `route(request_head_and_body) -> (status, body)`. Records every request.
    fn serve(route: impl Fn(&str) -> (u16, String) + Send + 'static) -> (String, Log) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let log: Log = Arc::new(Mutex::new(vec![]));
        let l2 = log.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { break };
                let mut data = Vec::new();
                let mut buf = [0u8; 8192];
                loop {
                    let n = s.read(&mut buf).unwrap_or(0);
                    data.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&data).to_string();
                    if let Some(i) = text.find("\r\n\r\n") {
                        let want = text[..i]
                            .lines()
                            .find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                            .unwrap_or(0);
                        if data.len() >= i + 4 + want {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let req = String::from_utf8_lossy(&data).to_string();
                l2.lock().unwrap().push(req.clone());
                let (code, body) = route(&req);
                let _ = write!(s, "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        (base, log)
    }

    fn cfg(kind: &str, base: &str) -> ProviderCfg {
        ProviderCfg {
            kind: kind.into(),
            base_url: base.into(),
            client_id: "cid".into(),
            client_secret: None,
            tenant: None,
            api_url: Some(base.into()),
        }
    }

    fn pat(kind: &str) -> Stored {
        Stored { kind: "pat".into(), provider: kind.into(), username: "me".into(), secret: "tok".into(), ..Default::default() }
    }

    fn new_repo(name: &str) -> NewRepo {
        NewRepo { name: name.into(), description: "d".into(), owner: None, project: None }
    }

    #[test]
    fn creates_private_repos_on_every_provider() {
        // GitHub
        let (base, log) = serve(|_| (201, r#"{"clone_url":"https://github.com/me/docs.git","html_url":"https://github.com/me/docs"}"#.into()));
        let r = provider::create_repo(&cfg("github", &base), &pat("github"), &new_repo("docs")).unwrap();
        assert_eq!(r.clone_url, "https://github.com/me/docs.git");
        let req = log.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /user/repos "), "{req}");
        assert!(req.contains("authorization: Bearer tok") || req.contains("Authorization: Bearer tok"), "{req}");
        assert!(req.contains("\"private\":true"));

        // GitLab: returns http_url_to_repo
        let (base, log) = serve(|_| (201, r#"{"http_url_to_repo":"https://gitlab.com/me/docs.git","web_url":"https://gitlab.com/me/docs"}"#.into()));
        let r = provider::create_repo(&cfg("gitlab", &base), &pat("gitlab"), &new_repo("docs")).unwrap();
        assert_eq!(r.clone_url, "https://gitlab.com/me/docs.git");
        let req = log.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /projects "), "{req}");
        assert!(req.contains("\"visibility\":\"private\""));

        // Forgejo: "token" scheme for personal access tokens
        let (base, log) = serve(|_| (201, r#"{"clone_url":"https://git.1011.no/me/docs.git","html_url":"https://git.1011.no/me/docs"}"#.into()));
        let r = provider::create_repo(&cfg("forgejo", &base), &pat("forgejo"), &new_repo("docs")).unwrap();
        assert_eq!(r.clone_url, "https://git.1011.no/me/docs.git");
        let req = log.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /user/repos "), "{req}");
        assert!(req.to_lowercase().contains("authorization: token tok"), "{req}");

        // Bitbucket: workspace required; picks the https clone link and drops the user name in it
        let body = r#"{"links":{"clone":[{"name":"ssh","href":"git@bitbucket.org:ws/docs.git"},{"name":"https","href":"https://me@bitbucket.org/ws/docs.git"}],"html":{"href":"https://bitbucket.org/ws/docs"}}}"#;
        let (base, log) = serve(move |_| (200, body.into()));
        assert!(provider::create_repo(&cfg("bitbucket", &base), &pat("bitbucket"), &new_repo("Docs")).is_err());
        let mut nr = new_repo("Docs");
        nr.owner = Some("ws".into());
        let r = provider::create_repo(&cfg("bitbucket", &base), &pat("bitbucket"), &nr).unwrap();
        assert_eq!(r.clone_url, "https://bitbucket.org/ws/docs.git");
        let req = log.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /repositories/ws/docs "), "{req}");
        assert!(req.to_lowercase().contains("authorization: basic "), "{req}");

        // Azure DevOps: organisation and project required
        let (base, log) = serve(|_| (201, r#"{"remoteUrl":"https://org@dev.azure.com/org/proj/_git/docs","webUrl":"https://dev.azure.com/org/proj/_git/docs"}"#.into()));
        let mut nr = new_repo("docs");
        nr.owner = Some("org".into());
        assert!(provider::create_repo(&cfg("azure", &base), &pat("azure"), &nr).is_err());
        nr.project = Some("proj".into());
        let r = provider::create_repo(&cfg("azure", &base), &pat("azure"), &nr).unwrap();
        assert_eq!(r.clone_url, "https://dev.azure.com/org/proj/_git/docs");
        let req = log.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /org/proj/_apis/git/repositories?api-version=7.1 "), "{req}");
    }

    #[test]
    fn explains_failures() {
        let (base, _) = serve(|_| (422, r#"{"message":"Repository creation failed.","errors":[{"message":"name already exists on this account"}]}"#.into()));
        let e = provider::create_repo(&cfg("github", &base), &pat("github"), &new_repo("docs")).unwrap_err();
        assert!(e.contains("name already exists"), "{e}");
        let (base, _) = serve(|_| (401, "{}".into()));
        let e = provider::create_repo(&cfg("gitlab", &base), &pat("gitlab"), &new_repo("docs")).unwrap_err();
        assert!(e.starts_with("AUTH_REQUIRED:"), "{e}");
        assert!(provider::create_repo(&cfg("github", "http://x"), &pat("github"), &new_repo("bad name!")).is_err());
    }

    #[test]
    fn device_flow() {
        let polls = Arc::new(Mutex::new(0));
        let p2 = polls.clone();
        let (base, _) = serve(move |req| {
            if req.starts_with("POST /login/device/code") {
                (200, r#"{"device_code":"dc","user_code":"ABCD-1234","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#.into())
            } else if req.starts_with("POST /login/oauth/access_token") {
                let mut n = p2.lock().unwrap();
                *n += 1;
                if *n == 1 {
                    (200, r#"{"error":"authorization_pending"}"#.into())
                } else {
                    (200, r#"{"access_token":"gho_abc","token_type":"bearer"}"#.into())
                }
            } else {
                (200, r#"{"login":"marius"}"#.into())
            }
        });
        let c = cfg("github", &base);
        let start = oauth::device_start(&c).unwrap();
        assert_eq!(start.user_code, "ABCD-1234");
        assert_eq!(oauth::device_poll(&c, &start.device_code).unwrap().status, "pending");
        let done = oauth::device_poll(&c, &start.device_code).unwrap();
        assert_eq!(done.status, "done");
        let s = done.stored.unwrap();
        assert_eq!((s.secret.as_str(), s.username.as_str(), s.kind.as_str()), ("gho_abc", "marius", "oauth"));
    }

    #[test]
    fn browser_flow_with_pkce() {
        let (base, log) = serve(|req| {
            if req.starts_with("POST /login/oauth/access_token") {
                (200, r#"{"access_token":"at","refresh_token":"rt","expires_in":3600}"#.into())
            } else {
                (200, r#"{"login":"marius"}"#.into())
            }
        });
        let c = cfg("forgejo", &base);
        let auth_url = Arc::new(Mutex::new(String::new()));
        let a2 = auth_url.clone();
        // The "browser": reads state and redirect from the URL and calls the redirect with a code.
        let s = oauth::authcode(&c, move |url| {
            *a2.lock().unwrap() = url.to_string();
            let u = url::Url::parse(url).unwrap();
            let q: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
            assert_eq!(q["redirect_uri"], oauth::redirect_uri());
            let back = format!("{}?code=thecode&state={}", q["redirect_uri"], q["state"]);
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(200));
                let _ = ureq::get(&back).call();
            });
        })
        .unwrap();
        assert_eq!((s.secret.as_str(), s.refresh_token.as_deref(), s.username.as_str()), ("at", Some("rt"), "marius"));
        assert!(s.expires_at.unwrap() > crate::creds::now_secs());
        assert_eq!(s.token_url.as_deref(), Some(format!("{base}/login/oauth/access_token").as_str()));

        // The code challenge must be the SHA-256 of the verifier that was sent to the token endpoint.
        let u = url::Url::parse(&auth_url.lock().unwrap()).unwrap();
        let q: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
        assert_eq!(q["code_challenge_method"], "S256");
        let token_req = log.lock().unwrap().iter().find(|r| r.starts_with("POST /login/oauth/access_token")).cloned().unwrap();
        let verifier = token_req.split("code_verifier=").nth(1).unwrap().split('&').next().unwrap().trim().to_string();
        use base64::Engine;
        let want = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        assert_eq!(q["code_challenge"], want);
        assert!(token_req.contains("grant_type=authorization_code") && token_req.contains("code=thecode"));
    }

    #[test]
    fn refreshes_an_expired_token() {
        let (base, _) = serve(|req| {
            assert!(req.contains("grant_type=refresh_token") && req.contains("refresh_token=old-rt"), "{req}");
            (200, r#"{"access_token":"new-at","expires_in":7200}"#.into())
        });
        let s = Stored {
            kind: "oauth".into(),
            provider: "gitlab".into(),
            username: "marius".into(),
            secret: "old-at".into(),
            refresh_token: Some("old-rt".into()),
            expires_at: Some(1),
            token_url: Some(format!("{base}/oauth/token")),
            client_id: Some("cid".into()),
            client_secret: None,
        };
        let n = oauth::refresh(&s).unwrap();
        assert_eq!(n.secret, "new-at");
        assert_eq!(n.refresh_token.as_deref(), Some("old-rt")); // kept when the server sends none
        assert_eq!(n.username, "marius");
        assert!(n.expires_at.unwrap() > crate::creds::now_secs());
    }
}
