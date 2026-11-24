import type { PrismaClient } from "@prisma/client";
import { deleteObjectsBestEffort } from "./attachments.js";

/**
 * Permanently deletes an account and everything it owns (workspaces, vaults, notes, plugins, sync connections,
 * attachment files). Irreversible: callers get explicit confirmation first. Used by DELETE /users/me and the admin
 * page. Returns how many attachment files there were and how many could not be removed from storage.
 */
export async function deleteAccount(prisma: PrismaClient, userId: string): Promise<{ attachmentFiles: number; failed: number }> {
  // Files of every vault in a workspace this user owns; read now, removed after the rows are gone.
  const keys = (
    await prisma.attachment.findMany({ where: { vault: { workspace: { ownerId: userId } } }, select: { storageKey: true } })
  ).map((a) => a.storageKey);

  await prisma.$transaction(async (tx) => {
    // Workspace->owner has no onDelete:Cascade (a workspace must always
    // have an explicit owner), so owned workspaces must be deleted before
    // the user row — this cascades down through Vault->Folder/Note/
    // Backlink/Plugin/SyncConnection/SyncJob automatically.
    await tx.workspace.deleteMany({ where: { ownerId: userId } });

    // Note.createdBy/updatedBy has no onDelete action either. By this
    // point every note in a workspace this user owned is already gone;
    // this only matters for notes in a workspace they were a non-owner
    // member of (not reachable via the app's UI yet, kept for safety).
    await tx.note.updateMany({ where: { createdById: userId }, data: { createdById: null } });
    await tx.note.updateMany({ where: { updatedById: userId }, data: { updatedById: null } });

    // RefreshToken, WorkspaceMember, EmailToken and ClipToken cascade on User delete.
    await tx.user.delete({ where: { id: userId } });
  });

  const failed = await deleteObjectsBestEffort(keys);
  return { attachmentFiles: keys.length, failed };
}
