import type { PrismaClient } from "@prisma/client";
import { snapshotCap, snapshotLimitForNote } from "./plans.js";

/**
 * Recurring job body (see sync-worker) — for every non-trashed note whose
 * content changed since its last snapshot (or has none yet), writes a new
 * NoteSnapshot row, then prunes anything past the note's limit (oldest first):
 * the plan of the vault's owner (lib/plans.ts; desktop keeps its own fixed
 * MAX_SNAPSHOTS_PER_FILE). Runs across all vaults in one pass, same shape as
 * cleanupExpiredTrash in lib/trash.ts.
 */
export async function captureSnapshots(prisma: PrismaClient): Promise<void> {
  // Postgres compares each note with its latest snapshot and returns only the ids that
  // changed. Loading every note's content into the worker instead (the first version)
  // ran a 384 MB container out of heap once production held ~90 MB of notes, and the
  // worker crash-looped on start-up because this job runs right away.
  const changed = await prisma.$queryRaw<{ id: string }[]>`
    SELECT n.id
    FROM notes n
    LEFT JOIN LATERAL (
      SELECT s.content FROM note_snapshots s
      WHERE s.note_id = n.id
      ORDER BY s.created_at DESC
      LIMIT 1
    ) latest ON true
    WHERE n.deleted_at IS NULL
      AND n.content <> ''
      AND (latest.content IS NULL OR latest.content <> n.content)
    ORDER BY n.id`;

  for (let i = 0; i < changed.length; i += SNAPSHOT_BATCH_SIZE) {
    const ids = changed.slice(i, i + SNAPSHOT_BATCH_SIZE).map((row) => row.id);
    const notes = await prisma.note.findMany({
      where: { id: { in: ids }, deletedAt: null, content: { not: "" } },
      select: {
        id: true,
        content: true,
        vault: { select: { workspace: { select: { owner: { select: { plan: { select: { maxSnapshotsPerNote: true } } } } } } } },
      },
    });

    for (const note of notes) {
      // Checked again: the note may have changed back since the query above.
      const latest = await prisma.noteSnapshot.findFirst({
        where: { noteId: note.id },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      });
      if (latest && latest.content === note.content) continue;

      await prisma.noteSnapshot.create({ data: { noteId: note.id, content: note.content } });

      const toPrune = await prisma.noteSnapshot.findMany({
        where: { noteId: note.id },
        orderBy: { createdAt: "desc" },
        skip: snapshotCap(note.vault.workspace.owner.plan.maxSnapshotsPerNote),
        select: { id: true },
      });
      if (toPrune.length > 0) {
        await prisma.noteSnapshot.deleteMany({ where: { id: { in: toPrune.map((s) => s.id) } } });
      }
    }
  }
}

/** Notes loaded with their content at a time; keeps the worker's heap small. */
const SNAPSHOT_BATCH_SIZE = 50;

/**
 * Saves the note's current content as a snapshot (unless the latest snapshot already
 * holds it) before something other than the user overwrites or trashes the note — a
 * sync import, for instance — so File Recovery can always bring it back.
 */
export async function snapshotBeforeOverwrite(prisma: PrismaClient, noteId: string, content: string): Promise<void> {
  if (!content) return;
  const latest = await prisma.noteSnapshot.findFirst({
    where: { noteId },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });
  if (latest && latest.content === content) return;
  await prisma.noteSnapshot.create({ data: { noteId, content } });
  const toPrune = await prisma.noteSnapshot.findMany({
    where: { noteId },
    orderBy: { createdAt: "desc" },
    skip: await snapshotLimitForNote(prisma, noteId),
    select: { id: true },
  });
  if (toPrune.length > 0) {
    await prisma.noteSnapshot.deleteMany({ where: { id: { in: toPrune.map((s) => s.id) } } });
  }
}

/** Metadata only (no content) — mirrors desktop's getSnapshots() shape. */
export async function listSnapshots(prisma: PrismaClient, noteId: string) {
  const rows = await prisma.noteSnapshot.findMany({
    where: { noteId },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    size: Buffer.byteLength(r.content, "utf8"),
  }));
}

export async function getSnapshotContent(prisma: PrismaClient, noteId: string, snapshotId: string): Promise<string | null> {
  const row = await prisma.noteSnapshot.findFirst({ where: { id: snapshotId, noteId }, select: { content: true } });
  return row?.content ?? null;
}
