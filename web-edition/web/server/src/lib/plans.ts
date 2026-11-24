import type { FastifyReply } from "fastify";
import type { Plan, PrismaClient } from "@prisma/client";

// Plans and their limits (session 5.3). A limit belongs to the OWNER of the workspace a vault is in, whoever is
// acting; null means no limit. Checked on the server where something is added; nothing already there is removed when a
// plan shrinks, except old history versions past the new per-note count.

export type LimitKind = "vaults" | "attachmentBytes" | "syncConnections";

export interface PlanLimits {
  vaults: number | null;
  attachmentBytes: number | null;
  syncConnections: number | null;
  snapshotsPerNote: number | null;
}

export interface PlanUsage {
  vaults: number;
  attachmentBytes: number;
  syncConnections: number;
}

/** Kept for history versions when a plan sets none (and the fallback if a note's owner cannot be found). */
export const DEFAULT_SNAPSHOTS_PER_NOTE = 50;

export function limitsOf(plan: Plan): PlanLimits {
  return {
    vaults: plan.maxVaults,
    // BigInt in the database; a byte count far below 2^53, so a JS number is exact.
    attachmentBytes: plan.maxAttachmentBytes === null ? null : Number(plan.maxAttachmentBytes),
    syncConnections: plan.maxSyncConnections,
    snapshotsPerNote: plan.maxSnapshotsPerNote,
  };
}

export async function planForUser(prisma: PrismaClient, userId: string): Promise<Plan> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { plan: true } });
  return user.plan;
}

/** The user whose plan counts for this vault: the owner of its workspace. */
export async function ownerOfVault(prisma: PrismaClient, vaultId: string): Promise<string | null> {
  const vault = await prisma.vault.findUnique({ where: { id: vaultId }, select: { workspace: { select: { ownerId: true } } } });
  return vault?.workspace.ownerId ?? null;
}

const ownedVaults = (userId: string) => ({ workspace: { ownerId: userId } });

export async function usageFor(prisma: PrismaClient, userId: string): Promise<PlanUsage> {
  const [vaults, bytes, syncConnections] = await Promise.all([
    prisma.vault.count({ where: ownedVaults(userId) }),
    prisma.attachment.aggregate({ where: { vault: ownedVaults(userId) }, _sum: { size: true } }),
    prisma.syncConnection.count({ where: { vault: ownedVaults(userId) } }),
  ]);
  return { vaults, attachmentBytes: Number(bytes._sum.size ?? 0), syncConnections };
}

export class PlanLimitError extends Error {
  constructor(
    public limit: LimitKind,
    public max: number,
    public used: number
  ) {
    super(`plan limit reached: ${limit}`);
  }
}

/**
 * Throws PlanLimitError when adding `adding` (one vault, one connection, a file's bytes) to what `ownerId` already has
 * would go past their plan. A null limit always passes.
 */
export async function checkLimit(prisma: PrismaClient, ownerId: string, kind: LimitKind, adding = 1): Promise<void> {
  const max = limitsOf(await planForUser(prisma, ownerId))[kind];
  if (max === null) return;
  const used = (await usageFor(prisma, ownerId))[kind];
  if (used + adding > max) throw new PlanLimitError(kind, max, used);
}

/** The one answer for every limit: the page shows a plain message and the upgrade (contact) link from it. */
export function planLimitReply(reply: FastifyReply, err: PlanLimitError) {
  return reply.code(403).send({ error: "plan_limit", limit: err.limit, max: err.max, used: err.used });
}

/** How many history versions to keep for a note: its vault owner's plan. */
export async function snapshotLimitForNote(prisma: PrismaClient, noteId: string): Promise<number> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: { vault: { select: { workspace: { select: { owner: { select: { plan: { select: { maxSnapshotsPerNote: true } } } } } } } } },
  });
  return snapshotCap(note?.vault.workspace.owner.plan.maxSnapshotsPerNote);
}

/** Null (no limit set) still keeps a bounded history: unbounded snapshots would grow the table forever. */
export function snapshotCap(value: number | null | undefined): number {
  return value ?? DEFAULT_SNAPSHOTS_PER_NOTE;
}
