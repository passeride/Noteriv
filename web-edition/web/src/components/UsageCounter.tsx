"use client";

import { memo } from "react";
import { formatNumber, t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import { tokensRemaining, usageLevel, usagePercent } from "@/lib/usage";
import type { UsageLevel, UsageSnapshot } from "@/types/usage";

/*
 * Usage example (see ChatLayout.tsx, which owns the polling):
 *
 *   const { usage } = useUsageTracking({ enabled: chatOpen });
 *   <UsageCounter usage={usage} model={provider.model} />
 */

export interface UsageCounterProps {
  /** Latest snapshot; renders nothing while null (loading, endpoint missing, or first request failed). */
  usage: UsageSnapshot | null;
  /** Model the chat is using right now (the snapshot only knows the provider it was billed to). */
  model?: string;
}

// Colors come from the app's theme variables (same fallbacks as ContextUsageMeter), so every theme and
// dark mode work without `dark:` variants.
const BAR_COLOR: Record<UsageLevel, string> = {
  ok: "bg-[var(--accent,#3b82f6)]",
  warning: "bg-[var(--color-warning,#f59e0b)]",
  critical: "bg-[var(--color-danger,#ef4444)]",
  exceeded: "bg-[var(--color-danger,#ef4444)]",
};

const MESSAGE_COLOR: Record<UsageLevel, string> = {
  ok: "",
  warning: "text-[var(--color-warning,#f59e0b)] border-[var(--color-warning,#f59e0b)]",
  critical: "text-[var(--color-danger,#ef4444)] border-[var(--color-danger,#ef4444)]",
  exceeded: "text-[var(--color-danger,#ef4444)] border-[var(--color-danger,#ef4444)]",
};

const usd = (value: number): string => formatNumber(value, { style: "currency", currency: "USD" });

function UsageCounterImpl({ usage, model }: UsageCounterProps) {
  useLocale(); // re-render on language change

  if (!usage) return null;

  const level = usageLevel(usage);
  // floor, not round: 79.6% must not read "80%" while the 80% warning has not fired yet.
  const percent = Math.floor(usagePercent(usage));
  const barWidth = Math.min(100, percent);
  const tokens = t("web.usage.tokens", { used: formatNumber(usage.tokens_used), limit: formatNumber(usage.tokens_limit) });
  const remaining = t("web.usage.remaining", { remaining: formatNumber(tokensRemaining(usage)) });
  const budget = t("web.usage.budget", { cost: usd(usage.cost_usd), budget: usd(usage.budget_usd) });
  const progress = t("web.usage.progress", { percent });
  const modelLabel = t("web.usage.model", { model: [usage.provider, model].filter(Boolean).join(" / ") });
  const message = level === "ok" ? null : t(`web.usage.${level}`, { percent });

  return (
    <section
      aria-label={t("web.usage.label")}
      title={[tokens, remaining, budget, modelLabel].join("\n")}
      className="px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)] text-[11px] leading-tight text-[var(--text-secondary)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-medium text-[var(--text-primary)]">{budget}</span>
        <span className="font-mono tabular-nums">{percent}%</span>
      </div>

      <div
        role="progressbar"
        aria-label={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={barWidth}
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]"
      >
        <div className={`h-full rounded-full transition-[width] duration-300 ${BAR_COLOR[level]}`} style={{ width: `${barWidth}%` }} />
      </div>

      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-mono tabular-nums">
          {tokens} <span className="text-[var(--text-muted)]">({remaining})</span>
        </span>
        <span className="min-w-0 truncate">{modelLabel}</span>
      </div>

      {message && (
        <p role={level === "exceeded" ? "alert" : "status"} className={`mt-1.5 border-l-2 pl-2 ${MESSAGE_COLOR[level]}`}>
          {message}
        </p>
      )}
    </section>
  );
}

export const UsageCounter = memo(UsageCounterImpl);
export default UsageCounter;
