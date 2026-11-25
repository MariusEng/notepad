import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { Menu } from "@tauri-apps/api/menu";
import { git } from "../lib/backend";
import { useSettings } from "../settings";
import { useTabs } from "../tabs/store";
import { openFiles } from "../actions";
import { checkExternalChanges } from "../session/session";
import { currentRepo, useGit, type Dialog, type SyncState } from "./store";
import { guessProvider, hostOf, pullRequestUrl, type Account, type RepoInfo, type SyncResult } from "./types";

const notify = (text: string, kind: "info" | "error" = "info") => useTabs.getState().notify(text, kind);
const setSync = (root: string, state: SyncState, message = "", conflicts: string[] = []) =>
  useGit.setState((s) => ({ syncs: { ...s.syncs, [root]: { state, message, conflicts, at: Date.now() } } }));
const current = () => currentRepo(useGit.getState());
const repoAt = (root: string) => useGit.getState().repos.find((r) => r.root === root) ?? null;

const sepOf = (root: string) => (root.includes("\\") ? "\\" : "/");
const norm = (p: string) => p.replace(/\\/g, "/");

export const isInRepo = (root: string, path: string) => norm(path).startsWith(norm(root) + "/");
export const joinPath = (root: string, rel: string) => root + sepOf(root) + rel.split("/").join(sepOf(root));

/** The open repository a file belongs to (the innermost one, for a repository inside another). */
export function repoOf(path: string): RepoInfo | null {
  let best: RepoInfo | null = null;
  for (const r of useGit.getState().repos) if (isInRepo(r.root, path) && (!best || r.root.length > best.root.length)) best = r;
  return best;
}

/** Makes a repository the current one (status bar, git menu). */
export const activateRepo = (root: string) => useGit.setState({ activeRoot: root });

/** The current repository follows the active tab. */
export function followActiveTab() {
  let last = "";
  useTabs.subscribe((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeId);
    const key = `${s.activeId}|${tab?.path ?? ""}`;
    if (key === last) return;
    last = key;
    const repo = tab?.path ? repoOf(tab.path) : null;
    if (repo) activateRepo(repo.root);
  });
}

// ---------------------------------------------------------------- opening

export async function openRepoFolder() {
  const dirs = await pickFolder({ directory: true, multiple: true, title: "Open Repository (any folder inside a git repository)" });
  for (const dir of dirs ?? []) await openRepo(dir);
}

export async function openRepo(path: string) {
  try {
    const repo = await git.open(path);
    addRepo(repo);
    const s = useSettings.getState();
    s.update({
      repos: s.repos.includes(repo.root) ? s.repos : [...s.repos, repo.root],
      collapsed: s.collapsed.filter((c) => c !== `repo:${repo.root}`),
      sidebar: true,
    });
    activateRepo(repo.root);
    await syncNow(true, repo.root);
  } catch (e) {
    notify(String(e), "error");
  }
}

/** Adds a repository, or updates it if it is already open. */
function addRepo(repo: RepoInfo) {
  useGit.setState((s) => ({
    repos: s.repos.some((r) => r.root === repo.root) ? s.repos.map((r) => (r.root === repo.root ? repo : r)) : [...s.repos, repo],
    treeVersion: s.treeVersion + 1,
  }));
}

/** New state of an open repository; ignored if it was closed meanwhile. */
function updateRepo(repo: RepoInfo, reloadTree: boolean) {
  useGit.setState((s) => ({
    repos: s.repos.map((r) => (r.root === repo.root ? repo : r)),
    treeVersion: s.treeVersion + (reloadTree ? 1 : 0),
  }));
}

export function closeRepo(root: string) {
  useGit.setState((s) => {
    const { [root]: _, ...syncs } = s.syncs;
    return {
      repos: s.repos.filter((r) => r.root !== root),
      activeRoot: s.activeRoot === root ? null : s.activeRoot,
      syncs,
      treeVersion: s.treeVersion + 1,
    };
  });
  const s = useSettings.getState();
  s.update({ repos: s.repos.filter((r) => r !== root), collapsed: s.collapsed.filter((c) => c !== `repo:${root}`) });
}

/** On launch: reopen the repositories that were open last time. */
export async function restoreRepos() {
  for (const root of useSettings.getState().repos) {
    try {
      addRepo(await git.open(root));
      void syncNow(true, root);
    } catch {
      closeRepo(root); // moved or deleted
    }
  }
  const { tabs, activeId } = useTabs.getState();
  const path = tabs.find((t) => t.id === activeId)?.path;
  const repo = path ? repoOf(path) : null;
  if (repo) activateRepo(repo.root);
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
export const keepCommittingTo = (root: string, branch: string) => keepRejected.add(`${root}\n${branch}`);

function failed(root: string, e: unknown) {
  if (!repoAt(root)) return; // closed meanwhile
  const msg = String(e);
  if (msg.startsWith("PUSH_REJECTED:")) {
    const rest = msg.slice("PUSH_REJECTED:".length);
    const cut = rest.indexOf(":");
    const branch = rest.slice(0, cut);
    const reason = rest.slice(cut + 1);
    setSync(root, "error", `The server doesn't accept pushes to ${branch}. Your commits are kept locally.`);
    if (!keepRejected.has(`${root}\n${branch}`)) openDialog({ kind: "pushRejected", root, branch, reason });
  } else if (msg.startsWith("AUTH_REQUIRED:")) {
    const host = msg.slice("AUTH_REQUIRED:".length);
    setSync(root, "auth", `Sign in to ${host || "the git server"} to sync`);
    openDialog({ kind: "accounts", host });
  } else {
    setSync(root, "error", msg);
  }
}

async function runSync(root: string, quiet: boolean) {
  if (!repoAt(root)) return; // closed while waiting in the queue
  setSync(root, "syncing", "Syncing…");
  try {
    const r: SyncResult = await git.sync(root);
    updateRepo(r.info, r.state === "pulled" || r.state === "merged");
    if (r.state === "conflict") {
      setSync(root, "conflict", r.message, r.conflicts);
      notify(`${r.info.name}: ${r.message} Conflicts: ${r.conflicts.join(", ")}`, "error");
    } else {
      setSync(root, r.state === "local-only" ? "local" : "synced", r.message);
      if (r.state === "pulled" || r.state === "merged") {
        await checkExternalChanges(); // open tabs pick up the downloaded files
        if (!quiet) notify(`${r.info.name}: ${r.message}`);
      }
    }
  } catch (e) {
    failed(root, e);
  }
}

/** Sync a repository (default: the current one) with its remote (fetch, merge if needed, push). */
export function syncNow(quiet = false, root = current()?.root) {
  const repo = root ? repoAt(root) : null;
  if (!repo) {
    if (!quiet) notify("Open a repository first (File → Open Repository…)");
    return Promise.resolve();
  }
  return enqueue(() => runSync(repo.root, quiet));
}

/** Called after a file was saved: commit it and push, when it belongs to an open repository. */
export function afterSave(path: string) {
  const repo = repoOf(path);
  if (!repo || !useSettings.getState().autoCommit) return;
  void enqueue(async () => {
    try {
      setSync(repo.root, "syncing", "Committing…");
      const message = await git.commitFile(repo.root, path, accountFor(repo)?.username ?? null);
      if (message === null && (repoAt(repo.root)?.ahead ?? 0) === 0) {
        setSync(repo.root, "synced", "Nothing to commit");
        return;
      }
      useGit.setState((s) => ({ treeVersion: s.treeVersion + 1 }));
      await runSync(repo.root, true);
    } catch (e) {
      failed(repo.root, e);
    }
  });
}

/** Called after a file or folder was moved to the Trash: commit the removal and push, when it was in the repository. */
export function afterDelete(path: string) {
  const repo = repoOf(path);
  if (!repo || !useSettings.getState().autoCommit) return;
  void enqueue(async () => {
    try {
      setSync(repo.root, "syncing", "Committing…");
      const message = await git.commitRemoval(repo.root, path, accountFor(repo)?.username ?? null);
      if (message === null && (repoAt(repo.root)?.ahead ?? 0) === 0) {
        setSync(repo.root, "synced", "Nothing to commit");
        return;
      }
      await runSync(repo.root, true);
    } catch (e) {
      failed(repo.root, e);
    }
  });
}

/** Sync when the window comes back to the front, each repository at most every two minutes. */
export function syncOnFocus() {
  const { repos, syncs } = useGit.getState();
  for (const { root } of repos) {
    const sync = syncs[root];
    if (sync?.state !== "syncing" && Date.now() - (sync?.at ?? 0) > 120_000) void syncNow(true, root);
  }
}

// ---------------------------------------------------------------- opening files from the tree

export const openRepoFile = (root: string, rel: string) => openFiles([joinPath(root, rel)]);

// ---------------------------------------------------------------- branches

/** Switches branch. Files on disk change; open tabs pick that up (unsaved edits get a banner). */
export function switchBranch(root: string, name: string) {
  const repo = repoAt(root);
  if (!repo) return Promise.resolve();
  return enqueue(async () => {
    try {
      updateRepo(await git.switchBranch(repo.root, name), true);
      await checkExternalChanges();
      notify(`Switched to ${name}`);
    } catch (e) {
      notify(String(e), "error");
    }
  }).then(() => syncNow(true, root));
}

/** Creates a branch from the current commit, switches to it and publishes it on the remote. */
export async function createBranch(root: string, name: string) {
  const repo = repoAt(root);
  if (!repo) return;
  updateRepo(await git.createBranch(repo.root, name.trim()), true);
  notify(`Created branch ${name.trim()}`);
  void syncNow(true, root);
}

/** Moves the commits the server refused onto a new branch, then pushes that branch. */
export async function moveToNewBranch(root: string, name: string) {
  const repo = repoAt(root);
  if (!repo) return;
  updateRepo(await git.moveToBranch(repo.root, name.trim()), true);
  await syncNow(true, root);
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
export function pullRequestLink(repo: RepoInfo | null): string | null {
  if (!repo?.remoteUrl || !repo.branch || !repo.defaultBranch || repo.branch === repo.defaultBranch) return null;
  return pullRequestUrl(repo.remoteUrl, providerOf(repo), repo.branch, repo.defaultBranch);
}

export function openPullRequest(root: string) {
  const url = pullRequestLink(repoAt(root));
  if (url) void git.openExternal(url);
}

/** Native menu with the branches, from the sidebar header or the status bar. */
export async function showBranchMenu(root = current()?.root) {
  const repo = root ? repoAt(root) : null;
  if (!repo) return;
  const branches = await git.branches(repo.root).catch(() => []);
  const item = (b: (typeof branches)[number]) => ({
    id: `branch-${b.name}`,
    text: b.name,
    checked: b.current,
    action: () => void (b.current ? undefined : switchBranch(repo.root, b.name)),
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
      { id: "new-branch", text: "New Branch…", action: () => openDialog({ kind: "newBranch", root: repo.root }) },
      {
        id: "pull-request",
        text: repo.defaultBranch ? `Create Pull Request into ${repo.defaultBranch}…` : "Create Pull Request…",
        enabled: !!pullRequestLink(repo),
        action: () => openPullRequest(repo.root),
      },
      { id: "sync", text: "Sync Now", action: () => void syncNow(false, repo.root) },
      { item: "Separator" as const },
      { id: "close-repo", text: "Close Repository", action: () => closeRepo(repo.root) },
    ],
  });
  await menu.popup();
}
