import type { PrismaClient, Prisma } from "@prisma/client";

interface AuditEntry {
  userId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/** Fire-and-forget: a logging failure must never fail the request it's logging. */
export function logAudit(prisma: PrismaClient, entry: AuditEntry): void {
  prisma.auditLog
    .create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata as Prisma.InputJsonValue | undefined,
        ip: entry.ip,
      },
    })
    .catch(() => undefined);
}
