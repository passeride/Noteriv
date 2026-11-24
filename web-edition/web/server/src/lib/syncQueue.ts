import { Queue } from "bullmq";
import { Redis } from "ioredis";

const connection = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:56379", {
  maxRetriesPerRequest: null,
});

/**
 * mode "sync" is the normal cycle. The two resolve-* modes recover from a
 * `conflict` job: "resolve-web" keeps the web's notes (new commit on top of the
 * remote tip, no force push), "resolve-remote" replaces the web's notes with the
 * remote's. See syncRunner.ts.
 */
export type SyncJobMode = "sync" | "resolve-web" | "resolve-remote";

export interface SyncJobData {
  connectionId: string;
  mode?: SyncJobMode;
}

export const syncQueue = new Queue<SyncJobData>("sync-jobs", { connection });
