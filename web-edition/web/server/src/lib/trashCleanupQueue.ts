import { Queue } from "bullmq";
import { Redis } from "ioredis";

const connection = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:56379", {
  maxRetriesPerRequest: null,
});

// Separate queue from "sync-jobs" (lib/syncQueue.ts) — trash cleanup is its own
// concern, not part of the git/WebDAV sync engine, even though both run on the
// same sync-worker process (docs/plans/2026-10-13-noteriv-web-full-parity.md Phase C1).
export const trashCleanupQueue = new Queue("trash-cleanup", { connection });
