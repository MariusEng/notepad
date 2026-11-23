#!/usr/bin/env node
// Brings pull requests opened on GitHub (github.com/MariusEng/notepad) into Forgejo (git.1011.no/marius/notepad),
// where they are tested by .forgejo/workflows/ci.yml and merged. Run by .forgejo/workflows/github-prs.yml every
// 30 minutes (and by hand: Actions → github-prs → Run workflow).
//
//  - Each open GitHub pull request #N is pushed to the branch github-pr-N of the bot account's fork
//    (github-sync/notepad) and gets a Forgejo pull request "GitHub #N: <title>" into main, opened by the bot.
//    The bot only has read access to marius/notepad, so Forgejo treats these as untrusted: their CI runs only after
//    you approve it on the pull request, and without the repository's secrets.
//  - New commits on GitHub update the branch (and so the Forgejo pull request).
//  - Closed on GitHub without merging → the Forgejo pull request is closed and the branch deleted.
//  - Merged on Forgejo → the github-mirror workflow pushes main to GitHub, where a merge commit makes GitHub show the
//    pull request as merged by itself. After a squash or rebase merge it stays open there, so this script comments
//    with the commit and closes it (needs the GitHub App's "Pull requests: Read and write").
//
// Env: GH_APP_ID, GH_APP_PRIVATE_KEY (GitHub App), SYNC_BOT_TOKEN (the bot's Forgejo token), FORGEJO_URL
//      (default https://git.1011.no). DRY_RUN=1 only prints what it would do.
import { createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GH_REPO = process.env.GITHUB_REPO || "MariusEng/notepad";
const FJ = process.env.FORGEJO_URL || "https://git.1011.no";
const FJ_REPO = process.env.FORGEJO_REPO || "marius/notepad";
const BOT = process.env.FORGEJO_BOT || "github-sync";
const FORK = `${BOT}/${FJ_REPO.split("/")[1]}`;
const DRY = !!process.env.DRY_RUN;
const env = (k) => process.env[k] || fail(`${k} is not set`);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}
const log = (...a) => console.log(...a);
const b64url = (b) => Buffer.from(b).toString("base64url");

/** A one-hour installation token from the GitHub App. */
async function githubToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env("GH_APP_ID") }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(env("GH_APP_PRIVATE_KEY"), "base64url");
  const jwt = `${head}.${body}.${sig}`;
  const inst = await gh(`/repos/${GH_REPO}/installation`, {}, jwt);
  const tok = await gh(`/app/installations/${inst.id}/access_tokens`, { method: "POST", body: { repositories: [GH_REPO.split("/")[1]] } }, jwt);
  return tok.token;
}

let ghTok = "";
async function gh(path, { method = "GET", body } = {}, bearer = ghTok) {
  const r = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

async function fj(path, { method = "GET", body, ok404 = false } = {}) {
  const r = await fetch(`${FJ}/api/v1${path}`, {
    method,
    headers: { Authorization: `token ${env("SYNC_BOT_TOKEN")}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (ok404 && r.status === 404) return null;
  if (!r.ok) throw new Error(`Forgejo ${method} ${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

/** Every page of a Forgejo list. */
async function fjAll(path) {
  const out = [];
  for (let page = 1; ; page++) {
    const items = await fj(`${path}${path.includes("?") ? "&" : "?"}limit=50&page=${page}`);
    out.push(...items);
    if (items.length < 50) return out;
  }
}

const git = (...args) => execFileSync("git", args, { cwd: work, stdio: ["ignore", "pipe", "inherit"] }).toString().trim();
const work = mkdtempSync(join(tmpdir(), "prsync-"));
git("init", "-q", "--bare");
// The bot's token as git credentials for its fork (never printed: passed as a header from the environment).
const pushAuth = () => ["-c", `http.extraheader=Authorization: basic ${Buffer.from(`${BOT}:${env("SYNC_BOT_TOKEN")}`).toString("base64")}`];

const branchOf = (n) => `github-pr-${n}`;
const numberOf = (ref) => Number(/^github-pr-(\d+)$/.exec(ref ?? "")?.[1] ?? NaN);

function prBody(pr, files) {
  const ci = files.filter((f) => f.filename.startsWith(".forgejo/") || f.filename.startsWith(".github/"));
  const warn = ci.length
    ? `> **⚠ This pull request changes CI workflows** (${ci.map((f) => `\`${f.filename}\``).join(", ")}). ` +
      `Read those changes before approving its workflows: they run on your runners.\n\n`
    : "";
  return (
    warn +
    `From GitHub: ${pr.html_url} by [${pr.user.login}](${pr.user.html_url}).\n` +
    `Synced by scripts/github-pr-sync.mjs; review and merge it here, not on GitHub. New commits on GitHub update this pull request (every 30 minutes).\n\n---\n\n` +
    (pr.body || "_No description._")
  );
}

async function main() {
  ghTok = await githubToken();
  const ghOpen = new Map();
  for (let page = 1; ; page++) {
    const list = await gh(`/repos/${GH_REPO}/pulls?state=open&per_page=100&page=${page}`);
    for (const pr of list) ghOpen.set(pr.number, pr);
    if (list.length < 100) break;
  }
  // The bot's pull requests on Forgejo, by GitHub number (newest first, so a reopened one wins).
  const fjPrs = (await fjAll(`/repos/${FJ_REPO}/pulls?state=all&sort=newest`)).filter(
    (p) => p.head?.repo?.full_name === FORK && Number.isFinite(numberOf(p.head.ref)),
  );
  const fjByNumber = new Map();
  for (const p of fjPrs) if (!fjByNumber.has(numberOf(p.head.ref))) fjByNumber.set(numberOf(p.head.ref), p);
  log(`GitHub: ${ghOpen.size} open pull request(s). Forgejo: ${fjPrs.length} synced pull request(s).`);

  // 1. Open on GitHub: push the branch, open or update the Forgejo pull request.
  for (const [n, pr] of ghOpen) {
    const cur = fjByNumber.get(n);
    if (cur?.merged) continue; // merged here: GitHub catches up through the mirror (step 2)
    const branch = branchOf(n);
    const sha = pr.head.sha;
    const existing = await fj(`/repos/${FORK}/branches/${branch}`, { ok404: true });
    if (existing?.commit?.id !== sha) {
      log(`#${n}: ${existing ? "update" : "push"} ${branch} → ${sha.slice(0, 7)}`);
      if (!DRY) {
        git("fetch", "-q", `https://github.com/${GH_REPO}.git`, `+refs/pull/${n}/head:refs/heads/${branch}`);
        git(...pushAuth(), "push", "-q", "--force", `${FJ}/${FORK}.git`, `refs/heads/${branch}:refs/heads/${branch}`);
      }
    }
    const files = await gh(`/repos/${GH_REPO}/pulls/${n}/files?per_page=100`);
    const title = `GitHub #${n}: ${pr.title}`;
    const body = prBody(pr, files);
    if (!cur) {
      log(`#${n}: open a Forgejo pull request`);
      if (!DRY) {
        const made = await fj(`/repos/${FJ_REPO}/pulls`, { method: "POST", body: { head: `${BOT}:${branch}`, base: "main", title, body } });
        log(`   ${made.html_url}`);
      }
    } else if (cur.state === "closed") {
      log(`#${n}: reopen ${cur.html_url}`);
      if (!DRY) await fj(`/repos/${FJ_REPO}/pulls/${cur.number}`, { method: "PATCH", body: { state: "open", title, body } });
    } else if (cur.title !== title || cur.body !== body) {
      log(`#${n}: update the title/description of ${cur.html_url}`);
      if (!DRY) await fj(`/repos/${FJ_REPO}/pulls/${cur.number}`, { method: "PATCH", body: { title, body } });
    }
  }

  // 2. Synced pull requests that are no longer open on GitHub, or were merged on Forgejo.
  for (const [n, cur] of fjByNumber) {
    if (ghOpen.has(n) && !cur.merged) continue;
    const pr = ghOpen.get(n) ?? (await gh(`/repos/${GH_REPO}/pulls/${n}`));
    if (cur.merged) {
      if (pr.state === "open") {
        // Merged here; a merge commit makes GitHub close it once the mirror has pushed main. Only when GitHub already
        // has the merge commit and still shows it open (squash/rebase merge) is it closed with a note.
        const sha = cur.merge_commit_sha;
        const there = await gh(`/repos/${GH_REPO}/commits/${sha}`).then(() => true, () => false);
        if (!there) {
          log(`#${n}: merged on Forgejo; waiting for the mirror to push ${sha.slice(0, 7)} to GitHub`);
          continue;
        }
        log(`#${n}: merged on Forgejo as ${sha.slice(0, 7)}; comment and close on GitHub`);
        if (!DRY) {
          try {
            await gh(`/repos/${GH_REPO}/issues/${n}/comments`, {
              method: "POST",
              body: { body: `Thank you! This was merged as ${sha} (merged on the main repository, then copied here).` },
            });
            await gh(`/repos/${GH_REPO}/pulls/${n}`, { method: "PATCH", body: { state: "closed" } });
          } catch (e) {
            log(`   could not close it on GitHub (does the GitHub App have "Pull requests: Read and write"?): ${e.message}`);
            continue;
          }
        }
      }
    } else if (cur.state === "open") {
      log(`#${n}: closed on GitHub; close ${cur.html_url}`);
      if (!DRY) await fj(`/repos/${FJ_REPO}/pulls/${cur.number}`, { method: "PATCH", body: { state: "closed" } });
    }
    // Done with it: remove the branch from the fork.
    if (await fj(`/repos/${FORK}/branches/${branchOf(n)}`, { ok404: true })) {
      log(`#${n}: delete ${FORK}:${branchOf(n)}`);
      if (!DRY) await fj(`/repos/${FORK}/branches/${branchOf(n)}`, { method: "DELETE" });
    }
  }
  log("Done.");
}

main().catch((e) => fail(e.stack || String(e)));
