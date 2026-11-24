import type { PrismaClient } from "@prisma/client";
import { syncQueue } from "./syncQueue.js";

/** How long to wait after the first save before syncing, so a burst of edits becomes one sync. */
const SYNC_ON_SAVE_DELAY_MS = 30_000;

/**
 * "Sync on save": queue one delayed sync per opted-in connection. A fixed jobId
 * makes BullMQ ignore further adds while one is still waiting, so ten saves in
 * thirty seconds produce a single sync. Best-effort — a Redis hiccup must never
 * fail the note save itself.
 */
export async function scheduleSyncOnSave(prisma: PrismaClient, vaultId: string): Promise<void> {
  try {
    const conns = await prisma.syncConnection.findMany({
      where: { vaultId, syncOnSave: true, direction: { not: "pull" } },
      select: { id: true },
    });
    for (const c of conns) {
      await syncQueue.add(
        "sync",
        { connectionId: c.id, mode: "sync" },
        { jobId: `save-${c.id}`, delay: SYNC_ON_SAVE_DELAY_MS, removeOnComplete: true, removeOnFail: true }
      );
    }
  } catch {
    // intentionally swallowed, see above
  }
}
