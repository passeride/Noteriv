// Usage counting from our own database, no browser tracking: one row per account per UTC day on which it signed up,
// signed in or refreshed a session (routes/auth.ts). The admin Stats tab (GET /admin/stats) is computed from it.

import type { PrismaClient } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;
/** About 13 months: enough for a year of weekly retention, then rows go (the privacy page states this). */
export const ACTIVITY_RETENTION_DAYS = 400;
const STATS_WEEKS = 12;

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Marks today as an active day of `userId`. Never throws: counting must not break signing in. */
export async function recordActivity(prisma: PrismaClient, userId: string, log: { warn: (o: object, m: string) => void }): Promise<void> {
  try {
    await prisma.userActivityDay.createMany({ data: [{ userId, day: utcDay(new Date()) }], skipDuplicates: true });
  } catch (err) {
    log.warn({ err: String(err) }, "recording activity failed");
  }
}

/** Run by the worker's daily cleanup job. */
export async function pruneActivityDays(prisma: PrismaClient): Promise<void> {
  const cutoff = new Date(utcDay(new Date()).getTime() - ACTIVITY_RETENTION_DAYS * DAY_MS);
  await prisma.userActivityDay.deleteMany({ where: { day: { lt: cutoff } } });
}

export interface WeekStats {
  /** Monday (UTC) the week starts on, YYYY-MM-DD. */
  week: string;
  signups: number;
  active: number;
  /** Share (0..1) of that week's sign-ups active on days 7–13 after signing up; null until every one of them is that old. */
  retentionWeek1: number | null;
  /** Same for days 28–34. */
  retentionWeek4: number | null;
}

export interface UsageStats {
  users: { total: number; verified: number; locked: number; new7: number; new30: number };
  active: { day1: number; day7: number; day30: number };
  content: { vaults: number; notes: number; attachmentBytes: number };
  weeks: WeekStats[];
}

const n = (v: unknown) => Number(v ?? 0);

/** Monday 00:00 UTC of the week `d` is in. */
function weekStart(d: Date): Date {
  const day = utcDay(d);
  return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
}

export async function usageStats(prisma: PrismaClient, now = new Date()): Promise<UsageStats> {
  const today = utcDay(now);
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
  // "Active in the last N days" counts today and the N-1 days before it.
  const activeSince = async (days: number) => {
    const rows = await prisma.userActivityDay.groupBy({ by: ["userId"], where: { day: { gte: new Date(today.getTime() - (days - 1) * DAY_MS) } } });
    return rows.length;
  };
  const firstWeek = new Date(weekStart(now).getTime() - (STATS_WEEKS - 1) * 7 * DAY_MS);

  const [total, verified, locked, new7, new30, day1, day7, day30, vaults, notes, attachments, signupRows, activeRows, retentionRows] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
      prisma.user.count({ where: { lockedAt: { not: null } } }),
      prisma.user.count({ where: { createdAt: { gte: since(7) } } }),
      prisma.user.count({ where: { createdAt: { gte: since(30) } } }),
      activeSince(1),
      activeSince(7),
      activeSince(30),
      prisma.vault.count(),
      prisma.note.count({ where: { deletedAt: null } }),
      prisma.attachment.aggregate({ _sum: { size: true } }),
      prisma.$queryRaw<{ week: Date; count: bigint }[]>`
        SELECT date_trunc('week', created_at)::date AS week, count(*) AS count
        FROM users WHERE created_at >= ${firstWeek} GROUP BY 1`,
      prisma.$queryRaw<{ week: Date; count: bigint }[]>`
        SELECT date_trunc('week', day::timestamp)::date AS week, count(DISTINCT user_id) AS count
        FROM user_activity_days WHERE day >= ${firstWeek}::date GROUP BY 1`,
      // For each sign-up week: how many of its accounts came back on days 7–13 and on days 28–34 after signing up.
      prisma.$queryRaw<{ week: Date; w1: bigint; w4: bigint }[]>`
        SELECT date_trunc('week', u.created_at)::date AS week,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_activity_days a WHERE a.user_id = u.id
            AND a.day BETWEEN u.created_at::date + 7 AND u.created_at::date + 13)) AS w1,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM user_activity_days a WHERE a.user_id = u.id
            AND a.day BETWEEN u.created_at::date + 28 AND u.created_at::date + 34)) AS w4
        FROM users u WHERE u.created_at >= ${firstWeek} GROUP BY 1`,
    ]);

  const byWeek = <T extends { week: Date }>(rows: T[]) => new Map(rows.map((r) => [isoDay(r.week), r]));
  const signups = byWeek(signupRows);
  const active = byWeek(activeRows);
  const retention = byWeek(retentionRows);

  const weeks: WeekStats[] = [];
  for (let i = 0; i < STATS_WEEKS; i++) {
    const start = new Date(firstWeek.getTime() + i * 7 * DAY_MS);
    const key = isoDay(start);
    const count = n(signups.get(key)?.count);
    const r = retention.get(key);
    // The week's last sign-up day is start + 6; its window ends 13 (or 34) days later and must be over.
    const done = (lastOffset: number) => today.getTime() > start.getTime() + (6 + lastOffset) * DAY_MS;
    const share = (v: unknown, lastOffset: number) => (count > 0 && done(lastOffset) ? n(v) / count : null);
    weeks.push({
      week: key,
      signups: count,
      active: n(active.get(key)?.count),
      retentionWeek1: share(r?.w1, 13),
      retentionWeek4: share(r?.w4, 34),
    });
  }

  return {
    users: { total, verified, locked, new7, new30 },
    active: { day1, day7, day30 },
    content: { vaults, notes, attachmentBytes: n(attachments._sum.size) },
    weeks,
  };
}
