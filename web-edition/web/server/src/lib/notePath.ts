import type { PrismaClient } from "@prisma/client";

/** Resolves the full vault-relative path for a note/folder given its parent folder id and own name. */
export async function resolvePath(
  prisma: PrismaClient,
  vaultId: string,
  folderId: string | null | undefined,
  name: string
): Promise<string> {
  if (!folderId) return name;
  const folder = await prisma.folder.findFirst({ where: { id: folderId, vaultId } });
  if (!folder) throw new Error("folder_not_found");
  return `${folder.path}/${name}`;
}
