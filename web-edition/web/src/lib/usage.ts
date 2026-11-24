import type { UsageLevel, UsageSnapshot } from "@/types/usage";

export const USAGE_WARNING_PERCENT = 80;
export const USAGE_CRITICAL_PERCENT = 95;

/** used / limit as a percentage. A missing, zero or negative limit means "no limit" and counts as 0%. */
function ratioPercent(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(0, (used / limit) * 100);
}

export const tokenPercent = (u: UsageSnapshot): number => ratioPercent(u.tokens_used, u.tokens_limit);
export const budgetPercent = (u: UsageSnapshot): number => ratioPercent(u.cost_usd, u.budget_usd);

/** The higher of the token and budget percentages, unrounded and uncapped (can exceed 100). */
export const usagePercent = (u: UsageSnapshot): number => Math.max(tokenPercent(u), budgetPercent(u));

export function usageLevel(u: UsageSnapshot): UsageLevel {
  const percent = usagePercent(u);
  if (percent >= 100) return "exceeded";
  if (percent >= USAGE_CRITICAL_PERCENT) return "critical";
  if (percent >= USAGE_WARNING_PERCENT) return "warning";
  return "ok";
}

/** Tokens left this month, never negative. */
export const tokensRemaining = (u: UsageSnapshot): number => Math.max(0, u.tokens_limit - u.tokens_used);
