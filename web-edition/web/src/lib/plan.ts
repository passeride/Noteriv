import { t } from "@noteriv/ui/i18n";
import { formatFileSize } from "@/lib/attachment-utils";
import { CONTACT_EMAIL } from "@/lib/legal";
import { planLimit } from "@/lib/webApi";

/** Where "need more?" leads until there is a pricing page (stage 6): an email to the operator, subject filled in. */
export const UPGRADE_MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Noteriv: more room")}`;

/** A plain sentence for a refused action because of a plan limit (web/server/src/lib/plans.ts), or null. */
export function planLimitText(err: unknown): string | null {
  const info = planLimit(err);
  if (!info) return null;
  const max = info.limit === "attachmentBytes" ? formatFileSize(info.max) : String(info.max);
  return t(`web.plan.limit.${info.limit}`, { max });
}
