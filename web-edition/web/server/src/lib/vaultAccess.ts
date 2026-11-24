import type { PrismaClient } from "@prisma/client";

export class VaultAccessError extends Error {
  constructor(public statusCode: 404 | 403, message: string) {
    super(message);
  }
}

/**
 * Confirms the user belongs to the workspace that owns this vault.
 * Throws VaultAccessError(404) if the vault doesn't exist, 403 if the user has no membership.
 */
export async function requireVaultAccess(
  prisma: PrismaClient,
  vaultId: string,
  userId: string
) {
  const vault = await prisma.vault.findUnique({ where: { id: vaultId } });
  if (!vault) {
    throw new VaultAccessError(404, "vault not found");
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: vault.workspaceId, userId } },
  });
  if (!membership) {
    throw new VaultAccessError(403, "forbidden");
  }

  return { vault, role: membership.role };
}
