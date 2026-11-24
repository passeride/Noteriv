import type { PrismaClient } from "@prisma/client";
import path from "node:path";
import { tmpdir } from "node:os";
import { decryptJson } from "./crypto.js";
import { exportNotesToDir, importDirToNotes, importNewNotesOnly } from "./vaultFs.js";
import {
  ensureWorkingCopy,
  ensureGitignore,
  gitSyncCore,
  adoptRemoteTip,
  SyncConflictError,
  type GitCredentials,
} from "./gitSync.js";
import { webdavSyncCore, type WebdavConfig, type WebdavSyncState } from "./webdavSync.js";
import { exportAttachmentsToDir, importAttachmentsFromDir, type AttachmentSyncReport } from "./attachmentSync.js";
import { toRelativeLinks, fromRelativeLinks } from "./attachmentLinks.js";
import type { SyncJobMode } from "./syncQueue.js";

// Deliberately defaults to the OS temp dir, NOT a path inside the Noteriv repo:
// an earlier version of this pointed at `./.sync-scratch` relative to the server
// project, which lives inside the Noteriv git working tree. `git add -A` run from
// a subdirectory stages the *whole* enclosing repo, not just that subdirectory —
// so a scratch dir nested inside any git repo risks the sync engine committing
// and pushing unrelated files from that outer repo. Keeping it under the OS temp
// dir by default removes that whole class of mistake; SYNC_SCRATCH_DIR can still
// override it for an operator who's verified their chosen path isn't inside a repo.
export const SCRATCH_ROOT = process.env.SYNC_SCRATCH_DIR ?? path.join(tmpdir(), "noteriv-sync-scratch");

interface GitCredentialsBlob {
  username: string;
  token: string;
}
interface WebdavCredentialsBlob {
  username: string;
  password: string;
}

/** Writes the vault's notes AND attachments into `dir`, with note links made repo-relative. */
async function exportVaultToDir(
  prisma: PrismaClient,
  vaultId: string,
  dir: string,
  prune: boolean,
  report: AttachmentSyncReport,
  exportedHashes?: Map<string, string>
): Promise<void> {
  const pathById = await exportAttachmentsToDir(prisma, vaultId, dir, report, exportedHashes);
  await exportNotesToDir(prisma, vaultId, dir, {
    prune,
    transform: (notePath, content) => toRelativeLinks(vaultId, notePath, content, pathById),
  });
}

/** Registers the repo's attachments, then returns the link transform that maps their relative links back to web URLs. */
async function attachmentLinkTransform(
  prisma: PrismaClient,
  vaultId: string,
  dir: string,
  report: AttachmentSyncReport,
  exportedHashes?: Map<string, string>
): Promise<(notePath: string, content: string) => string> {
  const idByPath = await importAttachmentsFromDir(prisma, vaultId, dir, null, report, exportedHashes);
  return (notePath, content) => fromRelativeLinks(vaultId, notePath, content, idByPath);
}

/** Expands {date} {time} {count} in a commit message template (desktop parity). */
export function formatCommitMessage(template: string, changedCount: number, now = new Date()): string {
  const iso = now.toISOString();
  return (template || "Sync notes {date}")
    .replace(/\{date\}/g, iso.slice(0, 10))
    .replace(/\{time\}/g, iso.slice(11, 19))
    .replace(/\{count\}/g, String(changedCount));
}

/** A sync lock older than this is treated as abandoned (a crashed worker never released it). */
const SYNC_LOCK_STALE_MS = 30 * 60 * 1000;

/**
 * Runs one sync of a connection. Returns "skipped" without doing anything when another
 * sync of the same connection is already running: both would share one scratch
 * directory, and two imports racing each other can overwrite fresh content.
 */
export async function runSyncJob(
  prisma: PrismaClient,
  connectionId: string,
  mode: SyncJobMode = "sync"
): Promise<"done" | "skipped"> {
  const lock = await prisma.syncConnection.updateMany({
    where: {
      id: connectionId,
      OR: [{ syncLockedAt: null }, { syncLockedAt: { lt: new Date(Date.now() - SYNC_LOCK_STALE_MS) } }],
    },
    data: { syncLockedAt: new Date() },
  });
  if (lock.count === 0) return "skipped";
  try {
    await runLockedSyncJob(prisma, connectionId, mode);
    return "done";
  } finally {
    await prisma.syncConnection.update({ where: { id: connectionId }, data: { syncLockedAt: null } }).catch(() => undefined);
  }
}

async function runLockedSyncJob(prisma: PrismaClient, connectionId: string, mode: SyncJobMode): Promise<void> {
  const connection = await prisma.syncConnection.findUniqueOrThrow({ where: { id: connectionId } });

  const job = await prisma.syncJob.create({
    data: { syncConnectionId: connectionId, status: "running", startedAt: new Date() },
  });
  // Attachment (object storage) trouble is reported as a warning on a successful job, not as a failure.
  const attachmentReport: AttachmentSyncReport = { skipped: 0 };
  // Conflict copies (git merge or import) are also a warning on a successful job: nothing was lost.
  const conflictCopies: string[] = [];

  try {
    const dir = path.resolve(SCRATCH_ROOT, connectionId);

    let pushed = 0;
    let pulled = 0;

    if (connection.providerType === "webdav") {
      if (mode !== "sync") throw new Error("Conflict resolution only applies to git connections.");
      // Unaffected by the git-checkout ordering bug below (webdavSyncCore pulls
      // remote-only files into `dir` itself, after export's prune has already run
      // against whatever was on disk *before* anything remote was fetched — so
      // there's nothing on disk yet for prune to wrongly delete).
      const exportedAt = new Date();
      await exportNotesToDir(prisma, connection.vaultId, dir);
      const creds = decryptJson<WebdavCredentialsBlob>(connection.credentialsEncrypted);
      const cfg: WebdavConfig = {
        url: connection.webdavUrl!,
        remotePath: connection.webdavPath ?? "/",
        username: creds.username,
        password: creds.password,
      };
      const result = await webdavSyncCore(dir, cfg, (connection.syncState as WebdavSyncState | null) ?? {});
      pushed = result.pushed;
      pulled = result.pulled;
      conflictCopies.push(...result.conflictCopies);
      const imported = await importDirToNotes(prisma, connection.vaultId, dir, null, { exportedAt });
      conflictCopies.push(...imported.conflictCopies);
      await prisma.syncConnection.update({ where: { id: connectionId }, data: { syncState: result.state as object } });
    } else {
      const creds = decryptJson<GitCredentialsBlob>(connection.credentialsEncrypted);
      const gitCreds: GitCredentials | null = creds.token ? { username: creds.username, token: creds.token } : null;
      const remoteUrl = connection.remoteUrl!;
      const direction = connection.direction;
      const doPull = direction !== "push";
      const doPush = direction !== "pull";

      // Order matters here: `ensureWorkingCopy` must run on `dir` BEFORE
      // `exportNotesToDir` ever writes to it. On the very first sync of an
      // existing vault against a non-empty remote, `ensureWorkingCopy`'s
      // `git checkout -B branch FETCH_HEAD` refuses to overwrite untracked
      // files — and if the DB's content had already been exported onto `dir`
      // first, those exported files ARE the untracked files in the way,
      // failing every first sync against a non-empty remote. Calling it first
      // (on an empty/nonexistent `dir`, or a no-op on an already-established
      // repo) avoids that entirely. `importNewNotesOnly` then rescues any
      // remote-only paths into the DB before `exportNotesToDir`'s prune pass
      // would otherwise delete them for not being a known note path — it only
      // ever creates, never overwrites or deletes, so the existing "DB content
      // wins on conflict" rule for overlapping paths is unchanged.
      await ensureWorkingCopy(dir, remoteUrl, connection.branch, gitCreds);

      if (mode === "resolve-remote") {
        // Take the remote's content wholesale, then mirror it into the DB.
        await adoptRemoteTip(dir, remoteUrl, connection.branch, gitCreds, "hard");
        await importDirToNotes(prisma, connection.vaultId, dir, null, {
          transform: await attachmentLinkTransform(prisma, connection.vaultId, dir, attachmentReport),
        });
        pulled = 1;
      } else if (mode === "resolve-web") {
        // Keep the web's content: move to the remote tip but keep the DB export as the
        // working tree, so the commit below is a plain fast-forward push (no force).
        await adoptRemoteTip(dir, remoteUrl, connection.branch, gitCreds, "mixed");
        await exportVaultToDir(prisma, connection.vaultId, dir, true, attachmentReport);
        await ensureGitignore(dir);
        const result = await gitSyncCore(
          dir,
          connection.branch,
          gitCreds,
          (n) => formatCommitMessage(connection.commitTemplate, n),
          { pull: false, push: true }
        );
        pushed = result.pushedCommit ? 1 : 0;
      } else {
        const exportedAt = new Date();
        const exportedHashes = new Map<string, string>();
        if (doPull) {
          await importNewNotesOnly(prisma, connection.vaultId, dir, null, await attachmentLinkTransform(prisma, connection.vaultId, dir, attachmentReport));
        }
        if (doPush) {
          // Push-only never imports, so remote-only files must not be pruned either —
          // otherwise the push would delete notes the remote has but the vault doesn't.
          await exportVaultToDir(prisma, connection.vaultId, dir, doPull, attachmentReport, exportedHashes);
          await ensureGitignore(dir);
        }
        const result = await gitSyncCore(
          dir,
          connection.branch,
          gitCreds,
          (n) => formatCommitMessage(connection.commitTemplate, n),
          { pull: true, push: doPush }
        );
        pushed = result.pushedCommit ? 1 : 0;
        conflictCopies.push(...result.conflictCopies);
        // Pull-only never re-exports the DB, so the working tree is exactly the remote's.
        if (doPull) {
          // Re-scan: the pull may have brought new attachment files whose links the notes now reference.
          const imported = await importDirToNotes(prisma, connection.vaultId, dir, null, {
            transform: await attachmentLinkTransform(prisma, connection.vaultId, dir, attachmentReport, exportedHashes),
            exportedAt,
          });
          conflictCopies.push(...imported.conflictCopies);
        }
      }
    }

    const status = "success" as const;
    const warnings: string[] = [];
    if (conflictCopies.length > 0) {
      const names = conflictCopies.slice(0, 5).join(", ") + (conflictCopies.length > 5 ? ", …" : "");
      warnings.push(
        `Web và repo cùng sửa một chỗ: giữ bản web, bản kia lưu thành ${conflictCopies.length} ghi chú "(conflict …)" để bạn so sánh (${names}).`
      );
    }
    if (attachmentReport.problem) {
      warnings.push(`Đã đồng bộ note; bỏ qua ${attachmentReport.skipped} file đính kèm: ${attachmentReport.problem}.`);
    }
    const warning = warnings.length > 0 ? warnings.join(" ") : null;
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status,
        pushedCount: pushed,
        pulledCount: pulled,
        finishedAt: new Date(),
        errorMessage: warning,
        ...(conflictCopies.length > 0 ? { conflictFiles: conflictCopies } : {}),
      },
    });
    await prisma.syncConnection.update({
      where: { id: connectionId },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: {
          status,
          pushed,
          pulled,
          ...(warning ? { warning } : {}),
          ...(conflictCopies.length > 0 ? { conflictCopies } : {}),
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith("Sync paused:") ? ("conflict" as const) : ("error" as const);
    const conflictFiles = err instanceof SyncConflictError ? err.files : null;
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status,
        errorMessage: message,
        finishedAt: new Date(),
        ...(conflictFiles ? { conflictFiles } : {}),
      },
    });
    await prisma.syncConnection.update({
      where: { id: connectionId },
      data: { lastSyncStatus: { status, error: message, ...(conflictFiles ? { conflictFiles } : {}) } },
    });
    throw err;
  }
}
