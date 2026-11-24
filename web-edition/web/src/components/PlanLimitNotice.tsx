import type { ReactNode } from "react";
import { t } from "@noteriv/ui/i18n";
import { planLimitText, UPGRADE_MAILTO } from "@/lib/plan";

/**
 * The message for an action refused by a plan limit, with the "need more?" contact link; null for any other error.
 * Callers keep their own wording for other failures: `setError(planLimitNotice(err) ?? t("…failed"))`.
 */
export function planLimitNotice(err: unknown): ReactNode | null {
  const text = planLimitText(err);
  if (!text) return null;
  return (
    <span>
      {text}{" "}
      <a href={UPGRADE_MAILTO} className="text-[var(--accent)] hover:underline">
        {t("web.plan.needMore")}
      </a>
    </span>
  );
}
