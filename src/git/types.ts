export type ProviderKind = "github" | "gitlab" | "forgejo" | "bitbucket" | "azure";

export interface RepoInfo {
  root: string;
  name: string;
  branch: string | null;
  remoteUrl: string | null;
  ahead: number;
  behind: number;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface SyncResult {
  state: "local-only" | "up-to-date" | "pushed" | "pulled" | "merged" | "conflict";
  message: string;
  info: RepoInfo;
  conflicts: string[];
}

/** A signed-in git account. Secrets live in the OS keychain (Rust side), never here. */
export interface Account {
  host: string;
  username: string;
  kind: "pat" | "oauth";
  provider: ProviderKind;
  baseUrl: string;
  clientId?: string;
}

export interface ProviderCfg {
  kind: ProviderKind;
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  tenant?: string;
}

export interface NewRepo {
  name: string;
  description: string;
  owner?: string;
  project?: string;
}

export interface RepoCreated {
  cloneUrl: string;
  webUrl: string;
}

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

export interface SignIn {
  status: "pending" | "slow_down" | "done" | "denied" | "expired";
  username: string | null;
}

export interface ProviderInfo {
  label: string;
  baseUrl: string;
  /** The server address can be changed (self-hosted / enterprise). */
  editableUrl: boolean;
  /** OAuth: device code sign-in is available. */
  deviceFlow: boolean;
  /** OAuth: the app registration includes a client secret that must be entered. */
  secretRequired: boolean;
  /** What to enter for "owner" when creating a repository, if anything. */
  owner: null | { label: string; required: boolean };
  project: boolean;
  /** How to register an OAuth app. */
  oauthHelp: string;
  patHelp: string;
}

export const PROVIDERS: Record<ProviderKind, ProviderInfo> = {
  github: {
    label: "GitHub",
    baseUrl: "https://github.com",
    editableUrl: true,
    deviceFlow: true,
    secretRequired: false,
    owner: { label: "Organisation (optional)", required: false },
    project: false,
    oauthHelp: "Register an OAuth app (Settings → Developer settings), tick “Enable Device Flow”, and paste its client id.",
    patHelp: "Create a token with the “repo” scope (Settings → Developer settings → Personal access tokens).",
  },
  gitlab: {
    label: "GitLab",
    baseUrl: "https://gitlab.com",
    editableUrl: true,
    deviceFlow: true,
    secretRequired: false,
    owner: null,
    project: false,
    oauthHelp: "Add an application (Preferences → Applications), untick “Confidential”, scope “api”, and paste its Application ID. Device code sign-in needs GitLab 17.9+; otherwise use the browser and add the redirect URI shown below.",
    patHelp: "Create a token with the “api” scope (Preferences → Access tokens).",
  },
  forgejo: {
    label: "Forgejo / Gitea",
    baseUrl: "https://git.1011.no",
    editableUrl: true,
    deviceFlow: false,
    secretRequired: false,
    owner: { label: "Organisation (optional)", required: false },
    project: false,
    oauthHelp: "Only needed to use your own OAuth app: add an OAuth2 application (Settings → Applications), untick “Confidential client”, add the redirect URI shown below, and paste its client id.",
    patHelp: "Create a token with repository read/write permission (Settings → Applications).",
  },
  bitbucket: {
    label: "Bitbucket",
    baseUrl: "https://bitbucket.org",
    editableUrl: false,
    deviceFlow: false,
    secretRequired: true,
    owner: { label: "Workspace", required: true },
    project: false,
    oauthHelp: "Add an OAuth consumer (Workspace settings → OAuth consumers) with the callback URL shown below and repository read/write + admin permission. Paste its key and secret.",
    patHelp: "Use your Bitbucket username and an app password with repository read/write and admin permission.",
  },
  azure: {
    label: "Azure DevOps",
    baseUrl: "https://dev.azure.com",
    editableUrl: false,
    deviceFlow: false,
    secretRequired: false,
    owner: { label: "Organisation", required: true },
    project: true,
    oauthHelp: "Register an app in Microsoft Entra (public client, redirect URI shown below, Azure DevOps permission) and paste its application (client) id. Repositories are private to your project.",
    patHelp: "Create a personal access token with Code (read & write) scope. Any user name works.",
  },
};

/**
 * OAuth client ids that work without the user registering anything. Client ids of public (PKCE / device flow)
 * apps are not secret. Where there is none, the account dialog asks for the user's own OAuth app.
 *  - Forgejo and Gitea pre-register apps for git credential helpers on every server, with the same ids
 *    (https://forgejo.org/docs/latest/user/authentication/oauth2-provider/); this is "git-credential-oauth".
 *  - For the others, register an OAuth app for Notepad once and paste its client id here:
 *    GitHub (device flow enabled, host github.com), GitLab (public app, scope api, host gitlab.com, redirect
 *    http://127.0.0.1:51789), Azure DevOps (Entra public client). Bitbucket needs a client secret, so it cannot
 *    be shipped.
 */
export const BUILTIN_OAUTH: Record<ProviderKind, { clientId: string; hosts?: string[]; name: string } | null> = {
  forgejo: { clientId: "a4792ccc-144e-407e-86c9-5e7d8d9c3269", name: "git-credential-oauth" },
  github: { clientId: "", hosts: ["github.com"], name: "Notepad" },
  gitlab: { clientId: "", hosts: ["gitlab.com"], name: "Notepad" },
  azure: { clientId: "", name: "Notepad" },
  bitbucket: null,
};

/** The built-in client id for this provider and server, or null if the user has to bring their own. */
export function builtinClient(provider: ProviderKind, host: string): { clientId: string; name: string } | null {
  const b = BUILTIN_OAUTH[provider];
  if (!b || !b.clientId) return null;
  if (b.hosts && !b.hosts.includes(host.toLowerCase())) return null;
  return b;
}

/** Best guess at the provider for a git host name. */
export function guessProvider(host: string): ProviderKind {
  const h = host.toLowerCase();
  if (h === "github.com" || h.includes("github")) return "github";
  if (h === "gitlab.com" || h.includes("gitlab")) return "gitlab";
  if (h === "bitbucket.org") return "bitbucket";
  if (h === "dev.azure.com" || h.endsWith("visualstudio.com")) return "azure";
  return "forgejo";
}

/** "git.example.com:8443" for a server address, the key credentials are stored under. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host.toLowerCase();
  } catch {
    return baseUrl.trim().toLowerCase();
  }
}
