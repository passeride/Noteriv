// How long records about people are kept, beyond the account itself. The privacy page (web/src/app/privacy/page.tsx)
// states these periods: change both together. Usage days have their own period in activity.ts, deleted notes in trash.ts.

import type { PrismaClient } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The security log (sign-ins, failed sign-ins, admin actions, with IP addresses): 12 months, then it goes. */
export const AUDIT_RETENTION_DAYS = 365;
/** Expired sign-in sessions and email links are useless after they expire; kept a month for investigating abuse. */
export const EXPIRED_TOKEN_RETENTION_DAYS = 30;

/** Run by the worker's daily cleanup job. */
export async function pruneExpiredRecords(prisma: PrismaClient, now = new Date()): Promise<{ auditLogs: number; refreshTokens: number; emailTokens: number }> {
  const auditCutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * DAY_MS);
  const tokenCutoff = new Date(now.getTime() - EXPIRED_TOKEN_RETENTION_DAYS * DAY_MS);
  const [auditLogs, refreshTokens, emailTokens] = await Promise.all([
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
    prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: tokenCutoff } } }),
    prisma.emailToken.deleteMany({ where: { expiresAt: { lt: tokenCutoff } } }),
  ]);
  return { auditLogs: auditLogs.count, refreshTokens: refreshTokens.count, emailTokens: emailTokens.count };
}
