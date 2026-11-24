import { describe, expect, it } from "vitest";
import { budgetPercent, tokensRemaining, tokenPercent, usageLevel, usagePercent } from "@/lib/usage";
import type { UsageSnapshot } from "@/types/usage";

const snap = (over: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  tokens_used: 0,
  tokens_limit: 10_000,
  cost_usd: 0,
  budget_usd: 50,
  provider: "claude-sdk",
  ...over,
});

describe("usageLevel", () => {
  it("is ok below 80%", () => {
    expect(usageLevel(snap({ tokens_used: 1234, cost_usd: 12.5 }))).toBe("ok");
    expect(usageLevel(snap({ cost_usd: 39.99 }))).toBe("ok");
  });

  it("warns from 80% and turns critical from 95%", () => {
    expect(usageLevel(snap({ cost_usd: 40 }))).toBe("warning");
    expect(usageLevel(snap({ cost_usd: 47.49 }))).toBe("warning");
    expect(usageLevel(snap({ cost_usd: 47.5 }))).toBe("critical");
    expect(usageLevel(snap({ cost_usd: 49.99 }))).toBe("critical");
  });

  it("is exceeded at 100% and beyond", () => {
    expect(usageLevel(snap({ cost_usd: 50 }))).toBe("exceeded");
    expect(usageLevel(snap({ cost_usd: 80 }))).toBe("exceeded");
  });

  it("uses whichever of tokens and budget is higher", () => {
    expect(usageLevel(snap({ tokens_used: 8000, cost_usd: 1 }))).toBe("warning");
    expect(usageLevel(snap({ tokens_used: 10_000, cost_usd: 1 }))).toBe("exceeded");
    expect(usagePercent(snap({ tokens_used: 5000, cost_usd: 40 }))).toBe(80);
  });

  it("treats a missing, zero or negative limit as no limit", () => {
    expect(usageLevel(snap({ budget_usd: 0, cost_usd: 5, tokens_limit: 0, tokens_used: 99 }))).toBe("ok");
    expect(budgetPercent(snap({ budget_usd: -1, cost_usd: 5 }))).toBe(0);
    expect(tokenPercent(snap({ tokens_limit: Number.NaN, tokens_used: 5 }))).toBe(0);
  });

  it("never reports a negative percentage", () => {
    expect(usagePercent(snap({ tokens_used: -5, cost_usd: -1 }))).toBe(0);
  });
});

describe("tokensRemaining", () => {
  it("is limit minus used, floored at 0", () => {
    expect(tokensRemaining(snap({ tokens_used: 1234 }))).toBe(8766);
    expect(tokensRemaining(snap({ tokens_used: 12_000 }))).toBe(0);
  });
});
