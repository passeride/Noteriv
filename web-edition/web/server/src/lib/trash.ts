import type { PrismaClient } from "@prisma/client";

/** How long a trashed note/folder is kept before the cleanup job purges it for good. */
export const TRASH_RETENTION_DAYS = 30;

/** Soft-deletes a single note. */
export async function trashNote(prisma: PrismaClient, noteId: string): Promise<void> {
  await prisma.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
}

function collectDescendantFolderIds(
  all: Array<{ id: string; parentId: string | null }>,
  rootId: string
): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const f of all) {
    if (!f.parentId) continue;
    const list = childrenByParent.get(f.parentId) ?? [];
    list.push(f.id);
    childrenByParent.set(f.parentId, list);
  }
  const result: string[] = [];
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    result.push(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
}

/**
 * Soft-deletes a folder and every descendant folder/note nested inside it, all
 * stamped with the exact same `deletedAt` timestamp so a single later restore
 * call can bring the whole subtree back together (see restoreFolder).
 */
export async function trashFolder(prisma: PrismaClient, vaultId: string, folderId: string): Promise<void> {
  const allFolders = await prisma.folder.findMany({
    where: { vaultId, deletedAt: null },
    select: { id: true, parentId: true },
  });
  const descendantIds = collectDescendantFolderIds(allFolders, folderId);
  const allFolderIds = [folderId, ...descendantIds];
  const deletedAt = new Date();

  await prisma.$transaction([
    prisma.folder.updateMany({ where: { id: { in: allFolderIds } }, data: { deletedAt } }),
    prisma.note.updateMany({ where: { vaultId, folderId: { in: allFolderIds } }, data: { deletedAt } }),
  ]);
}

/**
 * Restores a single note. If its parent folder is itself still trashed, the
 * note is moved to vault root instead of being left pointing at a folder that
 * no longer shows up anywhere in the UI.
 */
export async function restoreNote(prisma: PrismaClient, vaultId: string, noteId: string): Promise<void> {
  const note = await prisma.note.findFirst({ where: { id: noteId, vaultId } });
  if (!note) return;

  let folderId = note.folderId;
  if (folderId) {
    const folder = await prisma.folder.findUnique({ where: { id: folderId } });
    if (!folder || folder.deletedAt) folderId = null;
  }
  await prisma.note.update({ where: { id: noteId }, data: { deletedAt: null, folderId } });
}

/**
 * Restores a folder together with everything trashed in the same batch (same
 * `deletedAt` instant — see trashFolder). A millisecond-timestamp collision
 * with an unrelated, separately-trashed item is vanishingly unlikely and
 * accepted as a known v1 simplification.
 */
export async function restoreFolder(prisma: PrismaClient, vaultId: string, folderId: string): Promise<void> {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, vaultId } });
  if (!folder || !folder.deletedAt) return;
  const batchTime = folder.deletedAt;

  await prisma.$transaction([
    prisma.folder.updateMany({ where: { vaultId, deletedAt: batchTime }, data: { deletedAt: null } }),
    prisma.note.updateMany({ where: { vaultId, deletedAt: batchTime }, data: { deletedAt: null } }),
  ]);
}

export async function listTrash(prisma: PrismaClient, vaultId: string) {
  const [notes, folders] = await Promise.all([
    prisma.note.findMany({
      where: { vaultId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: { id: true, name: true, path: true, deletedAt: true },
    }),
    prisma.folder.findMany({
      where: { vaultId, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      select: { id: true, name: true, path: true, deletedAt: true },
    }),
  ]);
  return { notes, folders };
}

/** Permanently empties the trash for one vault (user-triggered "Empty Trash"). */
export async function emptyTrash(prisma: PrismaClient, vaultId: string): Promise<void> {
  await prisma.note.deleteMany({ where: { vaultId, deletedAt: { not: null } } });
  await prisma.folder.deleteMany({ where: { vaultId, deletedAt: { not: null } } });
}

/** Recurring cleanup job (see sync-worker) — purges anything past the retention window, across all vaults. */
export async function cleanupExpiredTrash(prisma: PrismaClient): Promise<void> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.note.deleteMany({ where: { deletedAt: { not: null, lt: cutoff } } });
  await prisma.folder.deleteMany({ where: { deletedAt: { not: null, lt: cutoff } } });
}
