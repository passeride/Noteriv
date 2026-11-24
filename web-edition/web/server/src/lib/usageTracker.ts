import type { PrismaClient } from "@prisma/client";
import { costUsd, normalizeTier, TIER_DEFAULTS, type Tier } from "./pricing.js";

// Records one usage event per AI chat request and sums them for the monthly counter.

/** The wire format of GET /api/v1/usage/current. A limit of 0 means "no limit" (the UI treats <= 0 that way). */
export interface UsageSnapshot {
  tokens_used: number;
  tokens_limit: number;
  cost_usd: number;
  budget_usd: number;
  provider: string;
}

export interface UsageInput {
  userId: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export const USAGE_CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 5_000;
/** Reported when the user has not used any AI this month. */
const NO_PROVIDER = "none";

/** First instant of the month containing `now`, in UTC (usage resets at 00:00 UTC on the 1st). */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const cache = new Map<string, { expires: number; value: UsageSnapshot }>();

/** Drop a user's cached counter so the next read sees a just-recorded event. */
export function invalidateUsageCache(userId: string): void {
  cache.delete(userId);
}

/** Test hook. */
export function clearUsageCache(): void {
  cache.clear();
}

const toCount = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** Appends an event. Returns false (and writes nothing) when there were no tokens to record. */
export async function recordUsage(prisma: PrismaClient, input: UsageInput): Promise<boolean> {
  const tokensIn = toCount(input.tokensIn);
  const tokensOut = toCount(input.tokensOut);
  if (tokensIn === 0 && tokensOut === 0) return false;
  const model = input.model || "default";
  await prisma.usageEvent.create({
    data: {
      userId: input.userId,
      provider: input.provider,
      model,
      tokensIn,
      tokensOut,
      costUsd: costUsd(input.provider, model, tokensIn, tokensOut),
    },
  });
  invalidateUsageCache(input.userId);
  return true;
}

/** The user's limits: their subscription row, with a null column falling back to the tier default. */
export async function limitsFor(
  prisma: PrismaClient,
  userId: string,
): Promise<{ tier: Tier; budgetUsd: number | null; tokens: number | null }> {
  const sub = await prisma.userSubscription.findUnique({ where: { userId } });
  const tier = normalizeTier(sub?.tier);
  const defaults = TIER_DEFAULTS[tier];
  return {
    tier,
    budgetUsd: sub?.monthlyBudgetUsd != null ? Number(sub.monthlyBudgetUsd) : defaults.budgetUsd,
    tokens: sub?.monthlyLimitTokens ?? defaults.tokens,
  };
}

/** Sums this month's events (indexed on user + time) and attaches the limits. Cached per user for 30 s. */
export async function currentUsage(prisma: PrismaClient, userId: string, now: Date = new Date()): Promise<UsageSnapshot> {
  const hit = cache.get(userId);
  if (hit && hit.expires > now.getTime()) return hit.value;

  const since = monthStart(now);
  const where = { userId, createdAt: { gte: since, lte: now } };
  const [sum, latest, limits] = await Promise.all([
    prisma.usageEvent.aggregate({ where, _sum: { tokensIn: true, tokensOut: true, costUsd: true } }),
    prisma.usageEvent.findFirst({ where, orderBy: { createdAt: "desc" }, select: { provider: true } }),
    limitsFor(prisma, userId),
  ]);

  const value: UsageSnapshot = {
    tokens_used: (sum._sum.tokensIn ?? 0) + (sum._sum.tokensOut ?? 0),
    tokens_limit: limits.tokens ?? 0,
    cost_usd: Math.round(Number(sum._sum.costUsd ?? 0) * 1e6) / 1e6,
    budget_usd: limits.budgetUsd ?? 0,
    provider: latest?.provider ?? NO_PROVIDER,
  };

  if (cache.size >= CACHE_MAX_ENTRIES) {
    for (const [key, entry] of cache) if (entry.expires <= now.getTime()) cache.delete(key);
    if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(userId, { expires: now.getTime() + USAGE_CACHE_TTL_MS, value });
  return value;
}
