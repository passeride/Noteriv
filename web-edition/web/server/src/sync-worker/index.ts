// Standalone sync worker process — run with `npm run dev:worker`. Separate
// from the API process per the plan (docs/plans/2026-10-12-noteriv-web-version.md
// §6): a slow/stuck git or WebDAV sync should never block API request handling.

import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";
import { runSyncJob } from "../lib/syncRunner.js";
import { warnIfGitMissing } from "../lib/gitSync.js";
import { syncQueue, type SyncJobData } from "../lib/syncQueue.js";
import { Queue } from "bullmq";
import { trashCleanupQueue } from "../lib/trashCleanupQueue.js";
import { cleanupExpiredTrash } from "../lib/trash.js";
import { noteSnapshotQueue } from "../lib/noteSnapshotQueue.js";
import { captureSnapshots } from "../lib/noteSnapshots.js";
import { pruneActivityDays } from "../lib/activity.js";
import { pruneExpiredRecords } from "../lib/retention.js";
import { captureError, flushSentry, initSentry } from "../lib/sentry.js";

initSentry("worker");

const connection = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:56379", {
  maxRetriesPerRequest: null,
});
const prisma = new PrismaClient();

const worker = new Worker<SyncJobData>(
  "sync-jobs",
  async (job) => {
    console.log(`[sync-worker] running sync for connection ${job.data.connectionId}`);
    await runSyncJob(prisma, job.data.connectionId, job.data.mode ?? "sync");
    console.log(`[sync-worker] finished sync for connection ${job.data.connectionId}`);
  },
  { connection, concurrency: 2 }
);

worker.on("failed", (job, err) => {
  console.error(`[sync-worker] job ${job?.id} failed:`, err.message);
  captureError(err, { tags: { queue: "sync-jobs" } });
});

// Trash cleanup (Phase C1) — separate queue/worker from sync-jobs above, same
// process. A stable jobId means re-registering the repeat schedule on every
// worker restart doesn't create duplicate schedulers.
const trashWorker = new Worker(
  "trash-cleanup",
  async () => {
    console.log("[sync-worker] running trash cleanup (purge past retention window)");
    await cleanupExpiredTrash(prisma);
    await pruneActivityDays(prisma);
    const pruned = await pruneExpiredRecords(prisma);
    console.log(`[sync-worker] pruned ${pruned.auditLogs} audit entries, ${pruned.refreshTokens + pruned.emailTokens} expired tokens`);
  },
  { connection, concurrency: 1 }
);
trashWorker.on("failed", (job, err) => {
  console.error(`[sync-worker] trash cleanup job ${job?.id} failed:`, err.message);
  captureError(err, { tags: { queue: "trash-cleanup" } });
});
await trashCleanupQueue.add(
  "purge-expired-trash",
  {},
  { repeat: { every: 24 * 60 * 60 * 1000 }, jobId: "purge-expired-trash" }
);

// Note snapshots (Phase D5) — every 10 minutes, only notes whose content
// changed since their last snapshot get a new row (see captureSnapshots).
const snapshotWorker = new Worker(
  "note-snapshots",
  async () => {
    console.log("[sync-worker] capturing note snapshots");
    await captureSnapshots(prisma);
  },
  { connection, concurrency: 1 }
);
snapshotWorker.on("failed", (job, err) => {
  console.error(`[sync-worker] snapshot job ${job?.id} failed:`, err.message);
  captureError(err, { tags: { queue: "note-snapshots" } });
});
await noteSnapshotQueue.add(
  "capture-snapshots",
  {},
  { repeat: { every: 10 * 60 * 1000 }, jobId: "capture-snapshots" }
);

// Auto-sync (parity plan v2, Pha 2): one 60s tick looks at every connection with
// autoSync on and enqueues those whose interval has elapsed. A per-connection
// repeatable job would need schedule bookkeeping every time a connection is
// edited; a single tick re-reads the current settings on every pass instead.
const autoSyncQueue = new Queue("auto-sync-tick", { connection });
const autoSyncWorker = new Worker(
  "auto-sync-tick",
  async () => {
    const conns = await prisma.syncConnection.findMany({
      where: { autoSync: true },
      select: { id: true, direction: true, syncIntervalMinutes: true, lastSyncedAt: true },
    });
    const now = Date.now();
    for (const c of conns) {
      const latest = await prisma.syncJob.findFirst({
        where: { syncConnectionId: c.id },
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true },
      });
      if (latest && (latest.status === "running" || latest.status === "queued")) continue;
      // Don't hammer a connection that needs a human (conflict) or keeps failing:
      // wait a full interval from the last attempt, whatever its outcome.
      const lastAttempt = Math.max(c.lastSyncedAt?.getTime() ?? 0, latest?.createdAt.getTime() ?? 0);
      if (now - lastAttempt < Math.max(1, c.syncIntervalMinutes) * 60_000) continue;
      if (latest?.status === "conflict") continue;
      await syncQueue.add("sync", { connectionId: c.id, mode: "sync" }, { removeOnComplete: 50, removeOnFail: 50 });
    }
  },
  { connection, concurrency: 1 }
);
autoSyncWorker.on("failed", (job, err) => {
  console.error(`[sync-worker] auto-sync tick ${job?.id} failed:`, err.message);
  captureError(err, { tags: { queue: "auto-sync-tick" } });
});
await autoSyncQueue.add("tick", {}, { repeat: { every: 60 * 1000 }, jobId: "auto-sync-tick" });

// Liveness signal for the diagnostics screen: the API can't see worker processes, but it can read this key.
export const WORKER_HEARTBEAT_KEY = "noteriv:worker:heartbeat";
const beat = () => connection.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), "EX", 120).catch(() => undefined);
void beat();
setInterval(beat, 30_000).unref();

console.log("noteriv sync-worker started");
void warnIfGitMissing((m) => console.error(`[sync-worker] ${m}`));

process.on("SIGTERM", async () => {
  await worker.close();
  await trashWorker.close();
  await snapshotWorker.close();
  await autoSyncWorker.close();
  await prisma.$disconnect();
  await flushSentry();
  process.exit(0);
});
