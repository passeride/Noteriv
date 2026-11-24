import { Queue } from "bullmq";
import { Redis } from "ioredis";

const connection = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:56379", {
  maxRetriesPerRequest: null,
});

// Separate queue from "sync-jobs"/"trash-cleanup" — snapshot capture (Phase D5)
// is its own recurring concern, same pattern as trashCleanupQueue.ts.
export const noteSnapshotQueue = new Queue("note-snapshots", { connection });
