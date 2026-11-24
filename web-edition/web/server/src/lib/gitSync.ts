// Shells out to the `git` binary. Ports desktop/src-tauri/src/commands_git.rs's
// `git_sync` core (and its hard-won recovery logic) from Rust to Node — see that
// file for the full original comments on *why* each guard exists.
//
// Credentials never travel on the git command line: they are answered through a
// short-lived GIT_ASKPASS helper (see runGit), so a `ps` listing or git's own
// error text can't leak the token.

import { spawn } from "node:child_process";
import { writeFile, rm, mkdir, realpath, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isSafeBranch } from "./vaultPaths.js";
import { assertPublicRemote, privateRemotesAllowed } from "./remoteHost.js";
import { randomBytes } from "node:crypto";

export interface GitCredentials {
  username: string;
  token: string;
}

interface GitRunResult {
  stdout: string;
  stderr: string;
  success: boolean;
}

/** Thrown when a pull/rebase hit conflicts; `files` lists the unmerged paths. */
export class SyncConflictError extends Error {
  constructor(message: string, public files: string[]) {
    super(message);
    this.name = "SyncConflictError";
  }
}

function shQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/** Builds the askpass script body: "Username…" prompts get the user, anything else the token. */
export function askpassBody(creds: GitCredentials, isWin: boolean): string {
  const user = creds.username || "oauth2";
  if (isWin) {
    return `@echo off\r\necho %~1| findstr /i "Username" >nul && (echo ${user}) || (echo ${creds.token})\r\n`;
  }
  return [
    "#!/bin/sh",
    'case "$1" in',
    `  *sername*) printf '%s\\n' ${shQuote(user)} ;;`,
    `  *) printf '%s\\n' ${shQuote(creds.token)} ;;`,
    "esac",
    "",
  ].join("\n");
}

const GIT_IDENTITY = {
  name: process.env.SYNC_GIT_AUTHOR_NAME ?? "Noteriv Sync",
  email: process.env.SYNC_GIT_AUTHOR_EMAIL ?? "sync@noteriv.local",
};

/** Friendly text for the failure modes operators actually hit; everything else passes through. */
function explainSpawnError(message: string): string {
  return /ENOENT/.test(message) ? "Máy chủ chưa cài git (spawn git ENOENT) — liên hệ quản trị viên." : message;
}

/**
 * The parent environment minus anything that injects git config (`GIT_CONFIG_COUNT`/`_KEY_n`/`_VALUE_n`,
 * `GIT_CONFIG_PARAMETERS`) or a credential prompt. A tool that launched the server can set e.g.
 * `credential.interactive=false` this way, which makes git skip our askpass and fail with
 * "unable to get password from user".
 */
export function hostEnvForGit(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    if (/^GIT_CONFIG_/i.test(key) || /^GIT_ASKPASS$/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}

function runGit(args: string[], cwd: string, creds?: GitCredentials | null, timeoutMs?: number): Promise<GitRunResult> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = {
      ...hostEnvForGit(process.env),
      // Ignore the host's global and system git config too: on a dev machine ~/.gitconfig can hold a
      // URL-specific credential helper (e.g. `gh auth git-credential` for github.com) that `-c credential.helper=`
      // does not reset, so git would push with the developer's account instead of the connection's token.
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      // Sync reads git's messages ("couldn't find remote ref", "unrelated histories"); keep them in English.
      LC_ALL: "C",
      LANGUAGE: "C",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new",
      GIT_TERMINAL_PROMPT: "0",
      SSH_ASKPASS: "",
      // A container has no global git identity (a dev machine usually does), and
      // `git commit` refuses to run without one. Setting it through the environment keeps
      // sync independent of whatever ~/.gitconfig the host happens to have.
      GIT_AUTHOR_NAME: GIT_IDENTITY.name,
      GIT_AUTHOR_EMAIL: GIT_IDENTITY.email,
      GIT_COMMITTER_NAME: GIT_IDENTITY.name,
      GIT_COMMITTER_EMAIL: GIT_IDENTITY.email,
    };

    // autocrlf=false: note content must round-trip byte-for-byte; a host git configured
    // with core.autocrlf=true (Windows) would otherwise rewrite line endings in the working copy.
    const fullArgs = [
      "-c", "credential.helper=",
      "-c", "core.askPass=",
      "-c", "credential.modalPrompt=false",
      "-c", "core.autocrlf=false",
      "-c", "core.safecrlf=false",
      // A symlink committed to a remote repository is checked out as a plain file holding its target, so the
      // import never reads through it into this machine's files.
      "-c", "core.symlinks=false",
      // Remotes are reached over HTTPS only: no file:// or local paths into this machine, no ext:: commands.
      // The sync scenarios script runs against local bare repositories and opens file:// with this variable.
      "-c", "protocol.allow=never",
      "-c", "protocol.https.allow=always",
      // ...and never follows a redirect, which could lead it to an internal address after the host check.
      "-c", "http.followRedirects=false",
      ...(privateRemotesAllowed() ? ["-c", "protocol.http.allow=always"] : []),
      ...(process.env.SYNC_ALLOW_LOCAL_REMOTES === "1" ? ["-c", "protocol.file.allow=always"] : []),
      ...args,
    ];

    const useCreds = !!creds?.token;
    if (useCreds && (/[\r\n]/.test(creds!.token) || /[\r\n]/.test(creds!.username ?? ""))) {
      resolve({ stdout: "", stderr: "credentials contain a line break", success: false });
      return;
    }

    let askpassFile: string | null = null;
    const isWin = process.platform === "win32";
    if (useCreds) {
      askpassFile = path.join(tmpdir(), `noteriv-askpass-${process.pid}-${randomBytes(6).toString("hex")}.${isWin ? "bat" : "sh"}`);
      env.GIT_ASKPASS = askpassFile;
    }

    const timeout = timeoutMs ?? (useCreds ? 60_000 : 30_000);

    const launch = async () => {
      if (askpassFile) {
        await writeFile(askpassFile, askpassBody(creds!, isWin), { mode: isWin ? undefined : 0o700 });
      }

      const child = spawn("git", fullArgs, { cwd, env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      const timer = setTimeout(() => {
        child.kill();
        resolve({ stdout: "", stderr: `git command timed out after ${timeout / 1000}s`, success: false });
      }, timeout);

      child.on("close", async (code) => {
        clearTimeout(timer);
        if (askpassFile) await rm(askpassFile, { force: true }).catch(() => undefined);
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), success: code === 0 });
      });
      child.on("error", async (err) => {
        clearTimeout(timer);
        if (askpassFile) await rm(askpassFile, { force: true }).catch(() => undefined);
        resolve({ stdout: "", stderr: explainSpawnError(err.message), success: false });
      });
    };

    launch();
  });
}

function okOrThrow(r: GitRunResult): string {
  if (r.success) return r.stdout;
  throw new Error(r.stderr || "git command failed");
}

async function rebaseInProgress(dir: string): Promise<boolean> {
  const r = await runGit(["rev-parse", "--git-dir"], dir);
  const gitDir = r.success && r.stdout ? path.join(dir, r.stdout) : path.join(dir, ".git");
  return existsSync(path.join(gitDir, "rebase-merge")) || existsSync(path.join(gitDir, "rebase-apply"));
}

async function mergeInProgress(dir: string): Promise<boolean> {
  const r = await runGit(["rev-parse", "--git-dir"], dir);
  const gitDir = r.success && r.stdout ? path.join(dir, r.stdout) : path.join(dir, ".git");
  return existsSync(path.join(gitDir, "MERGE_HEAD"));
}

/**
 * Sibling path for the losing side of a conflict: `notes/a.md` →
 * `notes/a (conflict 2026-10-17 0153).md`, numbered if that is taken too. `taken`
 * says whether a candidate path is already used (on disk, in the DB, …).
 */
export function conflictCopyPath(relPath: string, taken: (candidate: string) => boolean, now = new Date()): string {
  const slash = relPath.lastIndexOf("/");
  const dirPart = slash === -1 ? "" : relPath.slice(0, slash + 1);
  const file = slash === -1 ? relPath : relPath.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  const iso = now.toISOString();
  const stamp = `${iso.slice(0, 10)} ${iso.slice(11, 13)}${iso.slice(14, 16)}`;
  for (let n = 1; ; n++) {
    const candidate = `${dirPart}${stem} (conflict ${stamp}${n > 1 ? ` ${n}` : ""})${ext}`;
    if (!taken(candidate)) return candidate;
  }
}

/**
 * Resolves every unmerged path of an in-progress merge without losing either side:
 * - both sides changed → the local (web) version stays at the path, the remote version
 *   is written next to it as a conflict copy;
 * - deleted locally, changed remotely → the deletion stands, the remote version becomes a conflict copy;
 * - changed locally, deleted remotely → the local version stays.
 * Returns the repo-relative paths of the conflict copies it created.
 */
async function resolveConflictsKeepBoth(dir: string): Promise<string[]> {
  const unmerged = await runGit(["ls-files", "-u", "-z"], dir);
  okOrThrow(unmerged);
  const stagesByPath = new Map<string, Set<number>>();
  for (const entry of unmerged.stdout.split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const stage = Number(entry.slice(0, tab).split(" ")[2]);
    const p = entry.slice(tab + 1);
    if (!stagesByPath.has(p)) stagesByPath.set(p, new Set());
    stagesByPath.get(p)!.add(stage);
  }

  const copies: string[] = [];
  const now = new Date();
  for (const [p, stages] of stagesByPath) {
    const full = path.join(dir, p.replace(/\//g, path.sep));
    const hasOurs = stages.has(2);
    const hasTheirs = stages.has(3);
    if (hasTheirs) {
      okOrThrow(await runGit(["checkout", "--theirs", "--", p], dir));
      const copy = conflictCopyPath(p, (c) => existsSync(path.join(dir, c.replace(/\//g, path.sep))), now);
      const copyFull = path.join(dir, copy.replace(/\//g, path.sep));
      await mkdir(path.dirname(copyFull), { recursive: true });
      await rename(full, copyFull);
      okOrThrow(await runGit(["add", "--", copy], dir));
      copies.push(copy);
    }
    if (hasOurs) {
      okOrThrow(await runGit(["checkout", "--ours", "--", p], dir));
      okOrThrow(await runGit(["add", "--", p], dir));
    } else {
      okOrThrow(await runGit(["rm", "--cached", "--quiet", "--ignore-unmatch", "--", p], dir));
      await rm(full, { force: true });
    }
  }

  const left = await runGit(["ls-files", "-u"], dir);
  if (!left.success || left.stdout.length > 0) {
    throw new Error("Sync paused: some conflicts could not be resolved automatically and need manual attention.");
  }
  return copies;
}

async function onBranch(dir: string): Promise<boolean> {
  return (await runGit(["symbolic-ref", "--quiet", "HEAD"], dir)).success;
}

/**
 * Converts an ssh:// or git@host:path remote to plain https. Credentials are NOT
 * embedded (they go through GIT_ASKPASS, see runGit). Remotes that are already
 * https, or local paths / file:// (used by tests), are returned unchanged.
 */
export function toHttpsUrl(remoteUrl: string): string {
  const scpMatch = remoteUrl.match(/^git@([^:]+):(.+)$/);
  if (scpMatch) return `https://${scpMatch[1]}/${scpMatch[2]}`;
  if (remoteUrl.startsWith("ssh://")) return "https://" + remoteUrl.slice("ssh://".length).replace(/^[^@]*@/, "");
  return remoteUrl;
}

/** The URL actually handed to git: normalised to https when we hold credentials. */
function effectiveUrl(remote: string, creds: GitCredentials | null): string {
  return creds?.token ? toHttpsUrl(remote) : remote;
}

/** A branch name git cannot read as an option or a path trick (see isSafeBranch). */
function assertSafeBranch(branch: string): void {
  if (!isSafeBranch(branch)) throw new Error(`invalid branch name: ${JSON.stringify(branch)}`);
}

export async function gitIsInstalled(): Promise<boolean> {
  return (await runGit(["--version"], process.cwd())).success;
}

export async function gitVersion(): Promise<string | null> {
  const r = await runGit(["--version"], process.cwd());
  return r.success ? r.stdout : null;
}

/** Called at startup by the API and the worker so a missing git shows up in the logs immediately, not on the first user sync. */
export async function warnIfGitMissing(log: (msg: string) => void): Promise<void> {
  if (!(await gitIsInstalled())) {
    log("WARNING: `git` is not installed in this container — Git sync and note history will fail. Add it to the image (apk add git).");
  }
}

/** Lightweight connectivity check — doesn't clone, just lists remote refs. */
export async function testGitRemote(
  remoteUrl: string,
  creds: GitCredentials | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertPublicRemote(remoteUrl);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  // No --exit-code: a reachable but empty repo (no refs yet) exits 0 here, which is a
  // working connection; only network/auth failures exit non-zero.
  const r = await runGit(["ls-remote", "--", effectiveUrl(remoteUrl, creds)], process.cwd(), creds, 20_000);
  return r.success ? { ok: true } : { ok: false, error: r.stderr || "could not reach remote" };
}

/**
 * True only if `dir` itself has a `.git` entry — i.e. it is a repo root, not merely
 * *inside* one. `git rev-parse --is-inside-work-tree` is NOT safe for this check: it
 * walks up to any ancestor `.git` and reports true from inside someone else's repo
 * (this bit a real incident during development — see syncRunner.ts's SCRATCH_ROOT
 * comment for why the scratch dir now also lives outside any repo as a second guard).
 */
function hasOwnGitDir(dir: string): boolean {
  return existsSync(path.join(dir, ".git"));
}

/**
 * Refuses to proceed unless `dir` really is its own repo's top level — the hard
 * backstop against ever running `add -A`/`commit`/`push` against an ancestor
 * repository (such as the Noteriv project's own working copy) if `ensureWorkingCopy`
 * was skipped or its detection was ever fooled again.
 */
async function assertIsOwnRepoRoot(dir: string): Promise<void> {
  const r = await runGit(["rev-parse", "--show-toplevel"], dir);
  if (!r.success) {
    throw new Error(`refusing to sync: "${dir}" is not a git repo at all.`);
  }
  // realpath canonicalizes both Windows short-form (DUONGS~1) vs long-form
  // (duongsinh) path segments and symlinks, which raw string comparison
  // doesn't — a naive compare false-positived on exactly this during testing.
  const [resolvedDir, toplevel] = await Promise.all([
    realpath(dir).catch(() => path.resolve(dir)),
    realpath(r.stdout).catch(() => path.resolve(r.stdout)),
  ]);
  const normalize = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  if (normalize(resolvedDir) !== normalize(toplevel)) {
    throw new Error(
      `refusing to sync: "${dir}" is not its own git repo root (found top-level "${r.stdout}"). ` +
        "This guards against ever running git commands against the wrong repository."
    );
  }
}

/** Clones the repo into `dir` if it isn't already a git working copy there. */
export async function ensureWorkingCopy(
  dir: string,
  remoteUrl: string,
  branch: string,
  creds: GitCredentials | null
): Promise<void> {
  assertSafeBranch(branch);
  await assertPublicRemote(remoteUrl);
  await mkdir(dir, { recursive: true });
  if (hasOwnGitDir(dir)) {
    const existing = await runGit(["remote", "get-url", "origin"], dir);
    if (!existing.success) {
      okOrThrow(await runGit(["remote", "add", "origin", remoteUrl], dir));
    } else if (existing.stdout !== remoteUrl) {
      okOrThrow(await runGit(["remote", "set-url", "origin", remoteUrl], dir));
    }
    return;
  }

  okOrThrow(await runGit(["init"], dir));
  okOrThrow(await runGit(["remote", "add", "origin", remoteUrl], dir));
  okOrThrow(await runGit(["checkout", "-b", branch], dir));

  // Try to fetch+checkout the branch if it already exists on the remote (repo
  // isn't necessarily empty — the user may be connecting an existing vault).
  const fetch = await runGit(["fetch", "--", effectiveUrl(remoteUrl, creds), branch], dir, creds);
  if (fetch.success) {
    okOrThrow(await runGit(["checkout", "-B", branch, "FETCH_HEAD"], dir));
  } else if (!isMissingRemoteBranch(fetch.stderr)) {
    // Only an empty remote (or one without this branch) may start a fresh history here. On any other failure
    // (auth, network) keeping the new repo would make the next sync commit the vault as a root unrelated to the
    // remote's history; start over next time instead.
    await rm(path.join(dir, ".git"), { recursive: true, force: true });
    throw new Error(`Sync failed: could not fetch the remote. ${fetch.stderr || "unknown git fetch error"}`);
  }
}

/** git's answer when the remote is empty or lacks the branch: a fresh history is then correct. */
function isMissingRemoteBranch(stderr: string): boolean {
  return /couldn't find remote ref/i.test(stderr);
}

const DEFAULT_GITIGNORE = [".DS_Store", "Thumbs.db", ".trash/", "*.tmp", ""].join("\n");

/** Writes desktop's default .gitignore if the working copy has none. */
export async function ensureGitignore(dir: string): Promise<void> {
  const file = path.join(dir, ".gitignore");
  if (!existsSync(file)) await writeFile(file, DEFAULT_GITIGNORE, "utf8");
}

export interface GitSyncOptions {
  /**
   * Fetch + rebase remote changes into the working copy (default true). A push-only
   * connection still needs this at the git level (a push is rejected if the remote moved
   * ahead); "push-only" only means remote changes are never imported into the vault.
   */
  pull?: boolean;
  /** Commit local changes and push them (default true). */
  push?: boolean;
}

export interface GitSyncResult {
  pushedCommit: boolean;
  /** Conflict copies created while merging remote changes (repo-relative paths). */
  conflictCopies: string[];
}

/**
 * Core sync cycle: recover from a half-finished rebase/merge, commit the local state,
 * fetch and merge the remote branch (git's 3-way merge combines edits to different
 * parts of a note), keep both sides of any real conflict, commit, push.
 * Assumes `dir` already has the vault's current state materialized onto disk
 * (the caller exports DB notes into `dir` before calling this).
 *
 * Local changes are committed before merging rather than stashed: the old
 * stash → pull --rebase → stash pop sequence ignored a failed pop, so when both sides
 * edited the same note the conflict markers were committed, pushed and imported.
 */
export async function gitSyncCore(
  dir: string,
  branch: string,
  creds: GitCredentials | null,
  message: string | ((changedCount: number) => string),
  opts: GitSyncOptions = {}
): Promise<GitSyncResult> {
  assertSafeBranch(branch);
  const doPull = opts.pull !== false;
  const doPush = opts.push !== false;
  const commitMessage = (changed: number) => (typeof message === "function" ? message(changed) : message);

  await assertIsOwnRepoRoot(dir);

  if (await rebaseInProgress(dir)) {
    await runGit(["rebase", "--abort"], dir);
  }
  if (await mergeInProgress(dir)) {
    await runGit(["merge", "--abort"], dir);
  }

  const remoteR = await runGit(["remote", "get-url", "origin"], dir);
  const remote = remoteR.success ? remoteR.stdout : null;

  let pushedCommit = false;
  const conflictCopies: string[] = [];

  /** Stages everything; commits if anything changed. Returns whether a commit was made. */
  const commitAll = async (msg: (changed: number) => string): Promise<boolean> => {
    okOrThrow(await runGit(["add", "-A"], dir));
    const status = await runGit(["status", "--porcelain"], dir);
    if (!status.success || status.stdout.length === 0) return false;
    const changed = status.stdout.split("\n").filter(Boolean).length;
    okOrThrow(await runGit(["commit", "-m", msg(changed)], dir));
    return true;
  };

  if (remote && doPull) {
    const pullUrl = effectiveUrl(remote, creds);
    if (doPush) {
      // The working tree is the DB export: commit it so the merge below has a common base.
      if (await commitAll(commitMessage)) pushedCommit = true;
    } else {
      // Nothing local is ever pushed in this mode; drop stray working-tree changes so the merge is clean.
      await runGit(["reset", "--hard", "HEAD"], dir);
    }

    // An empty remote (no branch yet) fails here; there is simply nothing to merge.
    const fetch = await runGit(["fetch", "--", pullUrl, branch], dir, creds);
    if (fetch.success) {
      let merge = await runGit(["merge", "--no-edit", "FETCH_HEAD"], dir);
      if (!merge.success && /unrelated histories/i.test(merge.stderr)) {
        // A working copy whose first fetch failed (before ensureWorkingCopy stopped allowing that) started its own
        // history. Join the two: notes on both sides with different content become conflict copies below.
        merge = await runGit(["merge", "--no-edit", "--allow-unrelated-histories", "FETCH_HEAD"], dir);
      }
      if (!merge.success) {
        if (!(await mergeInProgress(dir))) {
          throw new Error(`Sync paused: could not merge remote changes. ${merge.stderr}`);
        }
        conflictCopies.push(...(await resolveConflictsKeepBoth(dir)));
        okOrThrow(
          await runGit(["commit", "--no-edit", "-m", `Noteriv: merge remote changes (${conflictCopies.length} conflict copies)`], dir)
        );
      }
    }
  }

  if (!(await onBranch(dir))) {
    throw new Error("Sync paused: repository is in a detached HEAD state and needs manual attention.");
  }

  if (doPush) {
    if (await commitAll(commitMessage)) pushedCommit = true;
    if (conflictCopies.length > 0) pushedCommit = true;

    if (remote) {
      const push = await runGit(["push", "-u", "--", effectiveUrl(remote, creds), branch], dir, creds);
      if (!push.success) {
        // Unreachable host, bad credentials, and non-fast-forward rejections all land
        // here — this result was previously discarded entirely, which is how a sync
        // job against a nonexistent remote + fake token could still report "success".
        const rejected = /\[rejected\]|non-fast-forward|fetch first|stale info/i.test(push.stderr);
        throw new Error(
          rejected
            ? `Sync paused: remote has changes that weren't merged locally; push was rejected. ${push.stderr}`
            : `Sync failed: could not push to remote. ${push.stderr || "unknown git push error"}`
        );
      }
    }
  }

  return { pushedCommit, conflictCopies };
}

/**
 * Conflict resolution helper: moves the working copy's branch to the remote tip.
 *  - "hard"  : working tree becomes the remote's content (caller then imports it
 *              into the DB — "take remote").
 *  - "mixed" : branch moves to the remote tip but the working tree keeps what the
 *              caller already exported from the DB, so the next add/commit/push is a
 *              plain fast-forward carrying the web's content ("keep web"). No force push.
 */
export async function adoptRemoteTip(
  dir: string,
  remote: string,
  branch: string,
  creds: GitCredentials | null,
  mode: "hard" | "mixed"
): Promise<void> {
  assertSafeBranch(branch);
  await assertIsOwnRepoRoot(dir);
  if (await rebaseInProgress(dir)) await runGit(["rebase", "--abort"], dir);
  if (await mergeInProgress(dir)) await runGit(["merge", "--abort"], dir);
  okOrThrow(await runGit(["fetch", "--", effectiveUrl(remote, creds), branch], dir, creds));
  okOrThrow(await runGit(["reset", mode === "hard" ? "--hard" : "--mixed", "FETCH_HEAD"], dir));
}

export interface RemoteState {
  /** Remote tip differs from what the working copy last saw. */
  remoteChanged: boolean;
  remoteReachable: boolean;
  error?: string;
}

/** Cheap "is there something new on the remote?" check — one ls-remote, no fetch. */
export async function getRemoteState(
  dir: string,
  remoteUrl: string,
  branch: string,
  creds: GitCredentials | null
): Promise<RemoteState> {
  assertSafeBranch(branch);
  await assertPublicRemote(remoteUrl);
  const ls = await runGit(["ls-remote", "--", effectiveUrl(remoteUrl, creds), `refs/heads/${branch}`], process.cwd(), creds, 20_000);
  if (!ls.success) return { remoteChanged: false, remoteReachable: false, error: ls.stderr || "could not reach remote" };
  const remoteSha = ls.stdout.split(/\s+/)[0] ?? "";
  if (!hasOwnGitDir(dir)) return { remoteChanged: !!remoteSha, remoteReachable: true };
  const local = await runGit(["rev-parse", "HEAD"], dir);
  const localSha = local.success ? local.stdout : "";
  return { remoteChanged: !!remoteSha && remoteSha !== localSha, remoteReachable: true };
}
