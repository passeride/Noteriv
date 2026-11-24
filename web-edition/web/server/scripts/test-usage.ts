// Unit checks for the usage counter (no database): `npx tsx scripts/test-usage.ts`.
// Uses a small fake of the Prisma calls usageTracker.ts makes.
import assert from "node:assert/strict";
import { costUsd, normalizeTier, rateFor, TIER_DEFAULTS } from "../src/lib/pricing.js";
import { clearUsageCache, currentUsage, monthStart, recordUsage, USAGE_CACHE_TTL_MS } from "../src/lib/usageTracker.js";

// pricing
assert.equal(costUsd("claude-sdk", "sonnet", 1_000_000, 1_000_000), 18);
assert.equal(costUsd("claude-sdk", "claude-opus-5-5-high", 1000, 0), 0.015);
assert.deepEqual(rateFor("antigravity-cli", "gemini-3.8-flash-high"), rateFor("antigravity-cli", "gemini-x"));
assert.deepEqual(rateFor("claude-sdk", "default"), { in: 3, out: 15 }, "unknown model uses the provider fallback");
assert.equal(costUsd("claude-sdk", "sonnet", -5, -5), 0);
assert.equal(normalizeTier("max"), "max");
assert.equal(normalizeTier("enterprise"), "free", "an unknown tier is never unlimited");
assert.deepEqual(TIER_DEFAULTS.free, { budgetUsd: 10, tokens: 100_000 });
assert.deepEqual(TIER_DEFAULTS.pro, { budgetUsd: 50, tokens: 1_000_000 });
assert.deepEqual(TIER_DEFAULTS.max, { budgetUsd: null, tokens: null });

// month boundary is UTC
assert.equal(monthStart(new Date("2026-10-31T23:59:59Z")).toISOString(), "2026-10-01T00:00:00.000Z");
assert.equal(monthStart(new Date("2026-12-15T00:00:00Z")).toISOString(), "2026-12-01T00:00:00.000Z");

// tracker against a fake prisma
type Row = { userId: string; provider: string; tokensIn: number; tokensOut: number; costUsd: number; createdAt: Date };
function fakePrisma(sub: { tier: string; monthlyBudgetUsd: number | null; monthlyLimitTokens: number | null } | null) {
  const rows: Row[] = [];
  let aggregates = 0;
  const prisma: any = {
    usageEvent: {
      create: async ({ data }: any) => void rows.push({ ...data, createdAt: data.createdAt ?? new Date() }),
      aggregate: async ({ where }: any) => {
        aggregates++;
        const hit = rows.filter((r) => r.userId === where.userId && r.createdAt >= where.createdAt.gte && r.createdAt <= where.createdAt.lte);
        const sum = (f: (r: Row) => number) => (hit.length ? hit.reduce((a, r) => a + f(r), 0) : null);
        return { _sum: { tokensIn: sum((r) => r.tokensIn), tokensOut: sum((r) => r.tokensOut), costUsd: sum((r) => r.costUsd) } };
      },
      findFirst: async ({ where }: any) => {
        const hit = rows.filter((r) => r.userId === where.userId && r.createdAt >= where.createdAt.gte);
        return hit.length ? { provider: hit[hit.length - 1].provider } : null;
      },
    },
    userSubscription: { findUnique: async () => sub },
  };
  return { prisma, rows, aggregateCalls: () => aggregates };
}

const now = new Date("2026-10-15T12:00:00Z");

{
  clearUsageCache();
  const { prisma, rows } = fakePrisma(null);
  assert.deepEqual(await currentUsage(prisma, "u1", now), {
    tokens_used: 0, tokens_limit: 100_000, cost_usd: 0, budget_usd: 10, provider: "none",
  }, "no events and no subscription: free defaults");

  assert.equal(await recordUsage(prisma, { userId: "u1", provider: "claude-sdk", model: "sonnet", tokensIn: 0, tokensOut: 0 }), false);
  assert.equal(rows.length, 0, "an empty event is not written");

  await recordUsage(prisma, { userId: "u1", provider: "claude-sdk", model: "sonnet", tokensIn: 1000, tokensOut: 500 });
  rows[0].createdAt = new Date("2026-09-30T23:59:59Z"); // last month: must not count
  await recordUsage(prisma, { userId: "u1", provider: "claude-sdk", model: "sonnet", tokensIn: 2000, tokensOut: 1000 });
  rows[1].createdAt = new Date("2026-10-02T00:00:00Z");
  await recordUsage(prisma, { userId: "u2", provider: "claude-sdk", model: "sonnet", tokensIn: 9999, tokensOut: 9999 });
  rows[2].createdAt = new Date("2026-10-03T00:00:00Z");

  const snap = await currentUsage(prisma, "u1", now);
  assert.equal(snap.tokens_used, 3000, "only this month and only this user");
  assert.equal(snap.cost_usd, costUsd("claude-sdk", "sonnet", 2000, 1000));
  assert.equal(snap.provider, "claude-sdk");
}

{
  // cache: a second read inside 30 s does not query; recording invalidates it; it expires after the TTL
  clearUsageCache();
  const { prisma, aggregateCalls } = fakePrisma(null);
  await currentUsage(prisma, "u1", now);
  await currentUsage(prisma, "u1", new Date(now.getTime() + 1000));
  assert.equal(aggregateCalls(), 1, "cached");
  await recordUsage(prisma, { userId: "u1", provider: "claude-sdk", model: "sonnet", tokensIn: 10, tokensOut: 10 });
  await currentUsage(prisma, "u1", new Date(now.getTime() + 2000));
  assert.equal(aggregateCalls(), 2, "recording invalidated the cache");
  await currentUsage(prisma, "u1", new Date(now.getTime() + 2000 + USAGE_CACHE_TTL_MS + 1));
  assert.equal(aggregateCalls(), 3, "expired");
}

{
  clearUsageCache();
  assert.deepEqual(
    await currentUsage(fakePrisma({ tier: "max", monthlyBudgetUsd: null, monthlyLimitTokens: null }).prisma, "u1", now),
    { tokens_used: 0, tokens_limit: 0, cost_usd: 0, budget_usd: 0, provider: "none" },
    "max is unlimited: limits are 0, which the UI reads as no limit",
  );
  clearUsageCache();
  const pro = await currentUsage(fakePrisma({ tier: "pro", monthlyBudgetUsd: null, monthlyLimitTokens: 5000 }).prisma, "u1", now);
  assert.equal(pro.budget_usd, 50, "null column falls back to the tier default");
  assert.equal(pro.tokens_limit, 5000, "explicit column overrides the tier default");
}

console.log("usage tests passed");
