import { useEffect, useRef, useState, type ReactNode } from "react";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { git } from "../lib/backend";
import { useSettings } from "../settings";
import {
  closeDialog,
  createBranch,
  keepCommittingTo,
  moveToNewBranch,
  openDialog,
  openPullRequest,
  openRepo,
  pullRequestLink,
} from "./actions";
import { useGit } from "./store";
import {
  PROVIDERS,
  builtinClient,
  guessProvider,
  hostOf,
  type Account,
  type DeviceStart,
  type ProviderCfg,
  type ProviderKind,
} from "./types";

export function GitDialogs() {
  const dialog = useGit((s) => s.dialog);
  if (!dialog) return null;
  return (
    <div className="picker-backdrop" onMouseDown={closeDialog}>
      <div
        className="dialog"
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && closeDialog()}
      >
        {dialog.kind === "accounts" && <AccountsDialog host={dialog.host} />}
        {dialog.kind === "newRepo" && <NewRepoDialog />}
        {dialog.kind === "clone" && <CloneDialog />}
        {dialog.kind === "newBranch" && <NewBranchDialog />}
        {dialog.kind === "pushRejected" && <PushRejectedDialog branch={dialog.branch} reason={dialog.reason} />}
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

const basename = (url: string) => url.replace(/\/+$/, "").split("/").pop()?.replace(/\.git$/, "") ?? "";

async function chooseFolder(title: string): Promise<string | null> {
  const dir = await pickFolder({ directory: true, multiple: false, title });
  return typeof dir === "string" ? dir : null;
}

const joinDir = (parent: string, name: string) => parent + (parent.includes("\\") ? "\\" : "/") + name;

// ---------------------------------------------------------------- accounts

function AccountsDialog({ host }: { host?: string }) {
  const accounts = useSettings((s) => s.accounts);
  const update = useSettings((s) => s.update);
  const [adding, setAdding] = useState(!!host || accounts.length === 0);

  const remove = async (a: Account) => {
    await git.credDelete(a.host).catch(() => {});
    update({ accounts: accounts.filter((x) => x.host !== a.host) });
  };

  return (
    <>
      <h2>Git accounts</h2>
      {host && <p className="note">Sign in to {host} to continue. You can also use credentials your git credential manager already has: nothing to do then.</p>}
      {accounts.length > 0 && (
        <ul className="acct-list">
          {accounts.map((a) => (
            <li key={a.host}>
              <span>
                {a.host} · {a.username || "signed in"} · {a.kind === "oauth" ? "OAuth" : "token"}
              </span>
              <button className="btn ghost" onClick={() => remove(a)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <AddAccount initialHost={host} onDone={() => setAdding(false)} />
      ) : (
        <div className="dialog-actions">
          <button className="btn" onClick={() => setAdding(true)}>
            Add account…
          </button>
          <span className="sb-spacer" />
          <button className="btn" onClick={closeDialog}>
            Done
          </button>
        </div>
      )}
    </>
  );
}

function AddAccount({ initialHost, onDone }: { initialHost?: string; onDone: () => void }) {
  const accounts = useSettings((s) => s.accounts);
  const update = useSettings((s) => s.update);
  const [provider, setProvider] = useState<ProviderKind>(initialHost ? guessProvider(initialHost) : "github");
  const info = PROVIDERS[provider];
  const [baseUrl, setBaseUrl] = useState(initialHost ? `https://${initialHost}` : info.baseUrl);
  const builtin = builtinClient(provider, hostOf(baseUrl));
  // Browser sign-in is the default whenever it needs nothing from the user.
  const [chosen, setChosen] = useState<"pat" | "oauth" | null>(null);
  const method = chosen ?? (builtin ? "oauth" : "pat");
  const setMethod = setChosen;
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [useDevice, setUseDevice] = useState(true);
  const [redirect, setRedirect] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [device, setDevice] = useState<DeviceStart | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    git.oauthRedirectUri().then(setRedirect).catch(() => {});
    return () => {
      cancelled.current = true;
    };
  }, []);

  const pick = (p: ProviderKind) => {
    setProvider(p);
    setBaseUrl(PROVIDERS[p].baseUrl);
  };

  const finish = (a: Account) => {
    update({ accounts: [...accounts.filter((x) => x.host !== a.host), a] });
    onDone();
  };

  const cfg = (): ProviderCfg => ({
    kind: provider,
    baseUrl: baseUrl.trim(),
    clientId: clientId.trim() || builtin?.clientId || "",
    clientSecret: clientSecret.trim() || undefined,
  });

  const saveToken = async () => {
    setError("");
    if (!username.trim() || !token.trim()) return setError("Enter your user name and the token");
    try {
      const host = hostOf(baseUrl);
      await git.credSavePat(host, username, token, provider);
      finish({ host, username: username.trim(), kind: "pat", provider, baseUrl: baseUrl.trim() });
    } catch (e) {
      setError(String(e));
    }
  };

  const signIn = async () => {
    setError("");
    cancelled.current = false;
    const c = cfg();
    const host = hostOf(baseUrl);
    const done = (username: string | null) =>
      finish({ host, username: username ?? "", kind: "oauth", provider, baseUrl: baseUrl.trim(), clientId: c.clientId });
    try {
      if (info.deviceFlow && useDevice) {
        setBusy("Requesting a code…");
        const start = await git.oauthDeviceStart(c);
        setDevice(start);
        setBusy("Waiting for you to approve in the browser…");
        let interval = start.interval;
        const until = Date.now() + start.expiresIn * 1000;
        while (!cancelled.current && Date.now() < until) {
          await new Promise((r) => setTimeout(r, interval * 1000));
          const r = await git.oauthDevicePoll(c, start.deviceCode);
          if (r.status === "done") return done(r.username);
          if (r.status === "slow_down") interval += 5;
          if (r.status === "denied") throw new Error("Sign-in was denied");
          if (r.status === "expired") throw new Error("The code expired. Try again.");
        }
        if (!cancelled.current) throw new Error("Sign-in timed out");
      } else {
        setBusy("Complete the sign-in in your browser…");
        const r = await git.oauthLogin(c);
        done(r.username);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy("");
      setDevice(null);
    }
  };

  return (
    <div className="add-account">
      <Field label="Provider">
        <select value={provider} onChange={(e) => pick(e.target.value as ProviderKind)}>
          {Object.entries(PROVIDERS).map(([k, p]) => (
            <option key={k} value={k}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      {info.editableUrl && (
        <Field label="Server">
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
        </Field>
      )}
      <div className="seg">
        <button className={method === "pat" ? "on" : ""} onClick={() => setMethod("pat")}>
          Access token
        </button>
        <button className={method === "oauth" ? "on" : ""} onClick={() => setMethod("oauth")}>
          Sign in with browser
        </button>
      </div>
      {method === "pat" ? (
        <>
          <p className="note">{info.patHelp}</p>
          <Field label="User name">
            <input value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} />
          </Field>
          <Field label="Token">
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} spellCheck={false} />
          </Field>
        </>
      ) : (
        <>
          {builtin ? (
            <>
              <p className="note">
                {info.deviceFlow && useDevice ? "You get a short code to enter on the provider’s page in your browser." : "Your browser opens so you can sign in and allow access."} {info.label} may show the app as “{builtin.name}”.
              </p>
              <details className="advanced">
                <summary>Use my own OAuth app instead</summary>
                <p className="note">
                  {info.oauthHelp} Redirect URI: <code>{redirect}</code>
                </p>
                <Field label="Client id">
                  <input value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} />
                </Field>
                <Field label="Client secret (only if your app has one)">
                  <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} spellCheck={false} />
                </Field>
              </details>
            </>
          ) : (
            <>
              <p className="note">
                {info.oauthHelp} Redirect URI: <code>{redirect}</code>
              </p>
              <Field label="Client id">
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} />
              </Field>
              <Field label={info.secretRequired ? "Client secret" : "Client secret (only if your app has one)"}>
                <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} spellCheck={false} />
              </Field>
            </>
          )}
          {info.deviceFlow && (
            <label className="check">
              <input type="checkbox" checked={useDevice} onChange={(e) => setUseDevice(e.target.checked)} /> Use a device code (no redirect needed)
            </label>
          )}
          {device && (
            <div className="device-code">
              <div>
                Enter <strong>{device.userCode}</strong> at
              </div>
              <button className="btn" onClick={() => git.openExternal(device.verificationUri)}>
                Open {device.verificationUri}
              </button>
            </div>
          )}
        </>
      )}
      {busy && <p className="note">{busy}</p>}
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions">
        <span className="sb-spacer" />
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={!!busy} onClick={method === "pat" ? saveToken : signIn}>
          {method === "pat" ? "Save" : "Sign in"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- new private repository

function NewRepoDialog() {
  const accounts = useSettings((s) => s.accounts);
  const [host, setHost] = useState(accounts[0]?.host ?? "");
  const account = accounts.find((a) => a.host === host);
  const info = account ? PROVIDERS[account.provider] : null;
  const [name, setName] = useState("documents");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [project, setProject] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  if (accounts.length === 0) {
    return (
      <>
        <h2>New private repository</h2>
        <p className="note">Sign in to a git provider first (a token or browser sign-in).</p>
        <div className="dialog-actions">
          <span className="sb-spacer" />
          <button className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => openDialog({ kind: "accounts" })}>
            Add account…
          </button>
        </div>
      </>
    );
  }

  const create = async () => {
    setError("");
    if (!account || !info) return;
    if (info.owner?.required && !owner.trim()) return setError(`Enter ${info.owner.label.toLowerCase()}`);
    if (info.project && !project.trim()) return setError("Enter the project");
    let folder = parent;
    if (!folder) folder = await chooseFolder("Where should the repository be saved on this computer?");
    if (!folder) return;
    setParent(folder);
    try {
      setBusy("Creating the repository…");
      const created = await git.createRepo(
        { kind: account.provider, baseUrl: account.baseUrl },
        { name: name.trim(), description: description.trim(), owner: owner.trim() || undefined, project: project.trim() || undefined },
      );
      setBusy("Downloading it…");
      const dest = joinDir(folder, basename(created.cloneUrl) || name.trim());
      const repo = await git.clone(created.cloneUrl, dest);
      closeDialog();
      await openRepo(repo.root);
    } catch (e) {
      const msg = String(e);
      if (msg.startsWith("AUTH_REQUIRED:")) openDialog({ kind: "accounts", host: msg.slice(14) });
      else setError(msg);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <h2>New private repository</h2>
      <Field label="Account">
        <select value={host} onChange={(e) => setHost(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.host} value={a.host}>
              {PROVIDERS[a.provider].label} · {a.host} · {a.username || "signed in"}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
      </Field>
      <Field label="Description (optional)">
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {info?.owner && (
        <Field label={info.owner.label}>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} spellCheck={false} />
        </Field>
      )}
      {info?.project && (
        <Field label="Project">
          <input value={project} onChange={(e) => setProject(e.target.value)} spellCheck={false} />
        </Field>
      )}
      <p className="note">
        {parent ? `It will be saved in ${parent}.` : "You will choose where to save it on this computer."}{" "}
        {account && ["bitbucket", "azure"].includes(account.provider) && "This provider creates it empty: your first save creates the first commit."}
      </p>
      {busy && <p className="note">{busy}</p>}
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions">
        <button className="btn ghost" onClick={() => openDialog({ kind: "accounts" })}>
          Accounts…
        </button>
        <span className="sb-spacer" />
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={!!busy || !name.trim()} onClick={create}>
          Create
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- clone

function CloneDialog() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const clone = async () => {
    setError("");
    const u = url.trim();
    if (!/^https:\/\//i.test(u)) return setError("Enter an https:// address (SSH is not supported)");
    const parent = await chooseFolder("Where should the repository be saved on this computer?");
    if (!parent) return;
    try {
      setBusy("Downloading…");
      const repo = await git.clone(u, joinDir(parent, basename(u) || "repository"));
      closeDialog();
      await openRepo(repo.root);
    } catch (e) {
      const msg = String(e);
      if (msg.startsWith("AUTH_REQUIRED:")) openDialog({ kind: "accounts", host: msg.slice(14) });
      else setError(msg);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <h2>Clone a repository</h2>
      <Field label="Repository address" hint="Private repositories use the account you signed in with, or your git credential manager.">
        <input autoFocus value={url} placeholder="https://git.example.com/me/notes.git" onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
      </Field>
      {busy && <p className="note">{busy}</p>}
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions">
        <button className="btn ghost" onClick={() => openDialog({ kind: "accounts" })}>
          Accounts…
        </button>
        <span className="sb-spacer" />
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={!!busy || !url.trim()} onClick={clone}>
          Clone
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- branches

/** "notes/2026-11-20": a suggested name for a branch of today's edits. */
function suggestBranch(prefix: string) {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix}/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function NewBranchDialog() {
  const repo = useGit((s) => s.repo);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    setError("");
    setBusy(true);
    try {
      await createBranch(name);
      closeDialog();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>New branch</h2>
      <p className="note">
        Starts from the current commit{repo?.branch ? ` on ${repo.branch}` : ""} and switches to it. Your files stay as they are; new
        saves are committed and pushed to the new branch.
      </p>
      <Field label="Branch name">
        <input
          autoFocus
          value={name}
          placeholder={suggestBranch("notes")}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && !busy && void create()}
        />
      </Field>
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions">
        <span className="sb-spacer" />
        <button className="btn" onClick={closeDialog}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={create}>
          Create Branch
        </button>
      </div>
    </>
  );
}

function PushRejectedDialog({ branch, reason }: { branch: string; reason: string }) {
  const repo = useGit((s) => s.repo);
  const [name, setName] = useState(() => suggestBranch("notes"));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const move = async () => {
    setError("");
    setBusy(true);
    try {
      await moveToNewBranch(name);
      if (useGit.getState().sync.state === "error") setError(useGit.getState().sync.message);
      else setDone(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const pr = pullRequestLink();
    return (
      <>
        <h2>Pushed to {repo?.branch}</h2>
        <p className="note">
          Your commits are on the branch <b>{repo?.branch}</b> on the server, and new saves go there too.
          {pr ? ` To get them into ${repo?.defaultBranch}, open a pull request.` : ""}
        </p>
        <div className="dialog-actions">
          <span className="sb-spacer" />
          <button className="btn" onClick={closeDialog}>
            Close
          </button>
          {pr && (
            <button
              className="btn primary"
              onClick={() => {
                openPullRequest();
                closeDialog();
              }}
            >
              Create Pull Request…
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <h2>The server doesn't accept pushes to {branch}</h2>
      <p className="note">
        Many repositories protect their main branch: changes go in through a branch and a pull request. Your commits are
        saved locally and nothing is lost.
      </p>
      {reason && <p className="field-hint">Server: {reason}</p>}
      <Field label="Move the unpushed commits to a new branch and push it" hint={`${branch} goes back to what the server has; your files don't change.`}>
        <input
          autoFocus
          value={name}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && !busy && void move()}
        />
      </Field>
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions">
        <button
          className="btn ghost"
          title={`Keep committing to ${branch} locally without asking again this session`}
          onClick={() => {
            keepCommittingTo(branch);
            closeDialog();
          }}
        >
          Not Now
        </button>
        <span className="sb-spacer" />
        <button className="btn primary" disabled={busy || !name.trim()} onClick={move}>
          {busy ? "Pushing…" : "Move & Push"}
        </button>
      </div>
    </>
  );
}
