import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { Menu } from "@tauri-apps/api/menu";
import { git } from "../lib/backend";
import { useSettings } from "../settings";
import { useTabs } from "../tabs/store";
import { openFiles } from "../actions";
import { checkExternalChanges } from "../session/session";
import { useGit, type Dialog, type SyncState } from "./store";
import { guessProvider, hostOf, pullRequestUrl, type Account, type RepoInfo, type SyncResult } from "./types";

const notify = (text: string, kind: "info" | "error" = "info") => useTabs.getState().notify(text, kind);
const setSync = (state: SyncState, message = "", conflicts: string[] = []) =>
  useGit.setState({ sync: { state, message, conflicts, at: Date.now() } });

const sepOf = (root: string) => (root.includes("\\") ? "\\" : "/");
const norm = (p: string) => p.replace(/\\/g, "/");

export const isInRepo = (root: string, path: string) => norm(path).startsWith(norm(root) + "/");
export const joinPath = (root: string, rel: string) => root + sepOf(root) + rel.split("/").join(sepOf(root));

// ---------------------------------------------------------------- opening

export async function openRepoFolder() {
  const dir = await pickFolder({ directory: true, multiple: false, title: "Open Repository (any folder inside a git repository)" });
  if (typeof dir === "string") await openRepo(dir);
}

export async function openRepo(path: string) {
  try {
    const repo = await git.open(path);
    setRepo(repo);
    useSettings.getState().update({ repoRoot: repo.root, sidebar: true });
    setSync("idle");
    await syncNow(true);
  } catch (e) {
    notify(String(e), "error");
  }
}

function setRepo(repo: RepoInfo | null) {
  useGit.setState((s) => ({ repo, treeVersion: s.treeVersion + 1 }));
}

export function closeRepo() {
  setRepo(null);
  setSync("idle");
  useSettings.getState().update({ repoRoot: null });
}

/** On launch: reopen the repository that was open last time. */
export async function restoreRepo() {
  const root = useSettings.getState().repoRoot;
  if (!root) return;
  try {
    setRepo(await git.open(root));
    void syncNow(true);
  } catch {
    useSettings.getState().update({ repoRoot: null }); // moved or deleted
  }
}

export function openDialog(dialog: Dialog) {
  useGit.setState({ dialog });
}
export const closeDialog = () => useGit.setState({ dialog: null });

export function toggleSidebar() {
  const s = useSettings.getState();
  s.update({ sidebar: !s.sidebar });
}

export function toggleAutoCommit() {
  const s = useSettings.getState();
  s.update({ autoCommit: !s.autoCommit });
  notify(!s.autoCommit ? "Saving now commits and pushes automatically" : "Saving no longer commits automatically");
}

// ---------------------------------------------------------------- sync (one job at a time)

let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
  const next = queue.then(job, job);
  queue = next.catch(() => {});
  return next;
};

function accountFor(repo: RepoInfo): Account | undefined {
  if (!repo.remoteUrl) return undefined;
  let host = "";
  try {
    host = hostOf(repo.remoteUrl);
  } catch {
    return undefined;
  }
  return useSettings.getState().accounts.find((a) => a.host === host);
}

/** Branches the user chose to keep committing to even though the server refuses pushes (this session). */
const keepRejected = new Set<string>();
export const keepCommittingTo = (branch: string) => keepRejected.add(branch);

function failed(e: unknown) {
  const msg = String(e);
  if (msg.startsWith("PUSH_REJECTED:")) {
    const rest = msg.slice("PUSH_REJECTED:".length);
    const cut = rest.indexOf(":");
    const branch = rest.slice(0, cut);
    const reason = rest.slice(cut + 1);
    setSync("error", `The server doesn't accept pushes to ${branch}. Your commits are kept locally.`);
    if (!keepRejected.has(branch)) openDialog({ kind: "pushRejected", branch, reason });
  } else if (msg.startsWith("AUTH_REQUIRED:")) {
    const host = msg.slice("AUTH_REQUIRED:".length);
    setSync("auth", `Sign in to ${host || "the git server"} to sync`);
    openDialog({ kind: "accounts", host });
  } else {
    setSync("error", msg);
  }
}

async function runSync(root: string, quiet: boolean) {
  setSync("syncing", "Syncing…");
  try {
    const r: SyncResult = await git.sync(root);
    useGit.setState((s) => ({ repo: r.info, treeVersion: s.treeVersion + (r.state === "pulled" || r.state === "merged" ? 1 : 0) }));
    if (r.state === "conflict") {
      setSync("conflict", r.message, r.conflicts);
      notify(`${r.message} Conflicts: ${r.conflicts.join(", ")}`, "error");
    } else {
      setSync(r.state === "local-only" ? "local" : "synced", r.message);
      if (r.state === "pulled" || r.state === "merged") {
        await checkExternalChanges(); // open tabs pick up the downloaded files
        if (!quiet) notify(r.message);
      }
    }
  } catch (e) {
    failed(e);
  }
}

/** Sync the open repository with its remote (fetch, merge if needed, push). */
export function syncNow(quiet = false) {
  const repo = useGit.getState().repo;
  if (!repo) {
    if (!quiet) notify("Open a repository first (File → Open Repository…)");
    return Promise.resolve();
  }
  return enqueue(() => runSync(repo.root, quiet));
}

/** Called after a file was saved: commit it and push, when it belongs to the open repository. */
export function afterSave(path: string) {
  const { repo } = useGit.getState();
  const settings = useSettings.getState();
  if (!repo || !settings.autoCommit || !isInRepo(repo.root, path)) return;
  void enqueue(async () => {
    try {
      setSync("syncing", "Committing…");
      const message = await git.commitFile(repo.root, path, accountFor(repo)?.username ?? null);
      if (message === null && (useGit.getState().repo?.ahead ?? 0) === 0) {
        setSync("synced", "Nothing to commit");
        return;
      }
      useGit.setState((s) => ({ treeVersion: s.treeVersion + 1 }));
      await runSync(repo.root, true);
    } catch (e) {
      failed(e);
    }
  });
}

/** Sync when the window comes back to the front, at most every two minutes. */
export function syncOnFocus() {
  const { repo, sync } = useGit.getState();
  if (repo && sync.state !== "syncing" && Date.now() - sync.at > 120_000) void syncNow(true);
}

// ---------------------------------------------------------------- opening files from the tree

export const openRepoFile = (root: string, rel: string) => openFiles([joinPath(root, rel)]);

// ---------------------------------------------------------------- branches

function afterBranchChange(info: RepoInfo) {
  setRepo(info);
  useSettings.getState().update({ repoRoot: info.root });
}

/** Switches branch. Files on disk change; open tabs pick that up (unsaved edits get a banner). */
export function switchBranch(name: string) {
  const repo = useGit.getState().repo;
  if (!repo) return Promise.resolve();
  return enqueue(async () => {
    try {
      afterBranchChange(await git.switchBranch(repo.root, name));
      await checkExternalChanges();
      notify(`Switched to ${name}`);
    } catch (e) {
      notify(String(e), "error");
    }
  }).then(() => syncNow(true));
}

/** Creates a branch from the current commit, switches to it and publishes it on the remote. */
export async function createBranch(name: string) {
  const repo = useGit.getState().repo;
  if (!repo) return;
  afterBranchChange(await git.createBranch(repo.root, name.trim()));
  notify(`Created branch ${name.trim()}`);
  void syncNow(true);
}

/** Moves the commits the server refused onto a new branch, then pushes that branch. */
export async function moveToNewBranch(name: string) {
  const repo = useGit.getState().repo;
  if (!repo) return;
  afterBranchChange(await git.moveToBranch(repo.root, name.trim()));
  await syncNow(true);
}

function providerOf(repo: RepoInfo) {
  const account = accountFor(repo);
  if (account) return account.provider;
  try {
    return guessProvider(hostOf(repo.remoteUrl ?? ""));
  } catch {
    return "forgejo" as const;
  }
}

/** Address of the page for opening a pull request from the current branch, if that makes sense. */
export function pullRequestLink(repo = useGit.getState().repo): string | null {
  if (!repo?.remoteUrl || !repo.branch || !repo.defaultBranch || repo.branch === repo.defaultBranch) return null;
  return pullRequestUrl(repo.remoteUrl, providerOf(repo), repo.branch, repo.defaultBranch);
}

export function openPullRequest() {
  const url = pullRequestLink();
  if (url) void git.openExternal(url);
}

/** Native menu with the branches, from the sidebar header or the status bar. */
export async function showBranchMenu() {
  const repo = useGit.getState().repo;
  if (!repo) return;
  const branches = await git.branches(repo.root).catch(() => []);
  const item = (b: (typeof branches)[number]) => ({
    id: `branch-${b.name}`,
    text: b.name,
    checked: b.current,
    action: () => void (b.current ? undefined : switchBranch(b.name)),
  });
  const local = branches.filter((b) => b.local);
  const remoteOnly = branches.filter((b) => !b.local);
  const menu = await Menu.new({
    items: [
      ...local.map(item),
      ...(remoteOnly.length
        ? [{ id: "remote-branches", text: "Remote Branches", items: remoteOnly.map(item) }]
        : []),
      { item: "Separator" as const },
      { id: "new-branch", text: "New Branch…", action: () => openDialog({ kind: "newBranch" }) },
      {
        id: "pull-request",
        text: repo.defaultBranch ? `Create Pull Request into ${repo.defaultBranch}…` : "Create Pull Request…",
        enabled: !!pullRequestLink(repo),
        action: openPullRequest,
      },
      { id: "sync", text: "Sync Now", action: () => void syncNow() },
      { item: "Separator" as const },
      { id: "close-repo", text: "Close Repository", action: closeRepo },
    ],
  });
  await menu.popup();
}
