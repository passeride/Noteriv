// Cost estimates and tier defaults for the AI usage counter.
//
// ESTIMATES, not invoices: the claude-sdk and antigravity-cli providers run on the user's own logged-in CLI
// subscription, so there is no per-token bill. The rates below only give the counter a comparable dollar figure.
// Check them against each vendor's price page before relying on them for anything but the counter.

/** USD per 1 million tokens. */
export interface Rate {
  in: number;
  out: number;
}

/** Longest matching prefix of the lowercase model id wins, so "claude-sonnet-5-5-high" matches "claude-sonnet". */
const MODEL_RATES: Array<[prefix: string, rate: Rate]> = [
  ["claude-opus", { in: 15, out: 75 }],
  ["opus", { in: 15, out: 75 }],
  ["claude-sonnet", { in: 3, out: 15 }],
  ["sonnet", { in: 3, out: 15 }],
  ["claude-haiku", { in: 1, out: 5 }],
  ["haiku", { in: 1, out: 5 }],
  ["gemini", { in: 0.3, out: 2.5 }],
  ["gpt-oss", { in: 0.15, out: 0.6 }],
];

/** Used when the model is unknown (including the CLI's "default"), per provider. */
const PROVIDER_FALLBACK_RATES: Record<string, Rate> = {
  "claude-sdk": { in: 3, out: 15 },
  "antigravity-cli": { in: 0.3, out: 2.5 },
};
const GENERIC_FALLBACK_RATE: Rate = { in: 3, out: 15 };

export function rateFor(provider: string, model: string): Rate {
  const id = model.toLowerCase();
  let best: { len: number; rate: Rate } | null = null;
  for (const [prefix, rate] of MODEL_RATES) {
    if (id.startsWith(prefix) && (!best || prefix.length > best.len)) best = { len: prefix.length, rate };
  }
  return best?.rate ?? PROVIDER_FALLBACK_RATES[provider] ?? GENERIC_FALLBACK_RATE;
}

/** cost = tokensIn * rate_in + tokensOut * rate_out, rounded to the 6 decimals the column stores. */
export function costUsd(provider: string, model: string, tokensIn: number, tokensOut: number): number {
  const rate = rateFor(provider, model);
  const cost = (Math.max(0, tokensIn) * rate.in + Math.max(0, tokensOut) * rate.out) / 1_000_000;
  return Math.round(cost * 1e6) / 1e6;
}

export type Tier = "free" | "pro" | "max";

/** null means unlimited. */
export interface TierLimits {
  budgetUsd: number | null;
  tokens: number | null;
}

export const TIER_DEFAULTS: Record<Tier, TierLimits> = {
  free: { budgetUsd: 10, tokens: 100_000 },
  pro: { budgetUsd: 50, tokens: 1_000_000 },
  max: { budgetUsd: null, tokens: null },
};

/** An unknown tier string (a typo in the database) is treated as "free" rather than unlimited. */
export function normalizeTier(tier: string | null | undefined): Tier {
  return tier === "pro" || tier === "max" ? tier : "free";
}
