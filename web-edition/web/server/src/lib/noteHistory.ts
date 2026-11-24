// D6 — Note History via git log. Deliberately does NOT create a hidden git
// repo per vault just for this (per the plan's recommendation): a vault only
// gets history once it has a real git sync-connection AND that connection has
// actually synced at least once (its scratch working copy, see
// syncRunner.ts's SCRATCH_ROOT, only comes into existence inside a sync job
// run). No connection / never synced => history is simply unavailable, the
// frontend hides the feature entirely rather than showing an error.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { SCRATCH_ROOT } from "./syncRunner.js";

function runGit(args: string[], cwd: string): Promise<{ stdout: string; success: boolean }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.on("close", (code) => resolve({ stdout, success: code === 0 }));
    child.on("error", () => resolve({ stdout: "", success: false }));
  });
}

export interface HistoryEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

async function findGitWorkingCopy(
  prisma: PrismaClient,
  vaultId: string
): Promise<{ dir: string; notePathInRepo: (notePath: string) => string } | null> {
  const connections = await prisma.syncConnection.findMany({
    where: { vaultId, providerType: { not: "webdav" } },
    select: { id: true },
  });
  for (const conn of connections) {
    const dir = path.resolve(SCRATCH_ROOT, conn.id);
    if (existsSync(path.join(dir, ".git"))) {
      return { dir, notePathInRepo: (notePath) => notePath };
    }
  }
  return null;
}

const LOG_SEP = "\u001f"; // unit separator, won't appear in commit messages

export async function getNoteGitHistory(
  prisma: PrismaClient,
  vaultId: string,
  notePath: string
): Promise<{ available: boolean; entries: HistoryEntry[] }> {
  const repo = await findGitWorkingCopy(prisma, vaultId);
  if (!repo) return { available: false, entries: [] };

  const relPath = repo.notePathInRepo(notePath);
  const r = await runGit(
    ["log", "--follow", `--format=%H${LOG_SEP}%an${LOG_SEP}%aI${LOG_SEP}%s`, "--", relPath],
    repo.dir
  );
  if (!r.success) return { available: true, entries: [] };

  const entries: HistoryEntry[] = r.stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [hash, author, date, message] = line.split(LOG_SEP);
      return { hash, author: author ?? "", date: date ?? "", message: message ?? "" };
    });
  return { available: true, entries };
}

export async function getNoteContentAtCommit(
  prisma: PrismaClient,
  vaultId: string,
  notePath: string,
  commitHash: string
): Promise<string | null> {
  const repo = await findGitWorkingCopy(prisma, vaultId);
  if (!repo) return null;
  // Guard against shell/argument injection via a crafted hash — only accept
  // what `git log` itself could have produced (hex) plus git's own revision
  // syntax for safety margin, never pass user input straight into `cwd`.
  if (!/^[0-9a-fA-F]+$/.test(commitHash)) return null;

  const relPath = repo.notePathInRepo(notePath);
  const r = await runGit(["show", `${commitHash}:${relPath}`], repo.dir);
  return r.success ? r.stdout : null;
}
