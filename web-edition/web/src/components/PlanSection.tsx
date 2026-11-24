"use client";

import { useEffect, useState } from "react";
import { webApi, type ApiPlan } from "@/lib/webApi";
import { formatFileSize } from "@/lib/attachment-utils";
import { UPGRADE_MAILTO } from "@/lib/plan";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

/** One limit: what is used next to the plan's maximum, with a bar when there is a maximum. */
function Meter({ label, used, max, format = String }: { label: string; used: number; max: number | null; format?: (n: number) => string }) {
  const pct = max ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div className="st-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span className="st-row-label">{label}</span>
        <span className="st-row-desc">
          {max === null ? `${format(used)} · ${t("web.plan.unlimited")}` : t("web.plan.of", { used: format(used), max: format(max) })}
        </span>
      </div>
      {max !== null && (
        <div style={{ height: 4, borderRadius: 2, background: "var(--bg-tertiary)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: pct >= 90 ? "var(--red)" : "var(--accent)" }} />
        </div>
      )}
    </div>
  );
}

/** Settings → Plan and usage: the account's plan, its limits and what is used (web/server/src/lib/plans.ts). */
export default function PlanSection() {
  useLocale();
  const [data, setData] = useState<ApiPlan | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    webApi.users
      .plan()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <div className="st-section st-row-desc">{t("web.plan.loadFailed")}</div>;
  if (!data) return <div className="st-section" />;

  const { plan, limits, usage } = data;
  return (
    <div className="st-section">
      <div className="st-row">
        <div className="st-row-info">
          <span className="st-row-label">{t("web.plan.current")}</span>
          <span className="st-row-desc">{t("web.plan.hint")}</span>
        </div>
        <div className="st-row-control" style={{ fontWeight: 600 }}>
          {plan.name}
        </div>
      </div>
      <div className="st-divider" />
      <Meter label={t("web.plan.vaults")} used={usage.vaults} max={limits.vaults} />
      <Meter label={t("web.plan.storage")} used={usage.attachmentBytes} max={limits.attachmentBytes} format={formatFileSize} />
      <Meter label={t("web.plan.sync")} used={usage.syncConnections} max={limits.syncConnections} />
      <div className="st-row">
        <span className="st-row-label">{t("web.plan.history")}</span>
        <span className="st-row-desc">{limits.snapshotsPerNote}</span>
      </div>
      <div className="st-divider" />
      <a href={UPGRADE_MAILTO} className="st-test-btn" style={{ display: "inline-block" }}>
        {t("web.plan.needMore")}
      </a>
    </div>
  );
}
