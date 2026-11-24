"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { webApi, type ApiUsageStats } from "@/lib/webApi";
import AdminNav from "@/components/AdminNav";
import { formatFileSize } from "@/lib/attachment-utils";
import { formatDate, formatNumber, t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

const percent = (share: number | null) => (share === null ? "—" : formatNumber(share, { style: "percent", maximumFractionDigits: 0 }));

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
      {hint && <span className="text-xs text-[var(--text-secondary)]">{hint}</span>}
    </div>
  );
}

/**
 * Usage counted from our own database (web/server/src/lib/activity.ts), no browser tracking: accounts, active
 * accounts, content, and per sign-up week how many came back in their second and fifth week.
 */
export default function AdminStatsPage() {
  useLocale();
  const router = useRouter();
  const [stats, setStats] = useState<ApiUsageStats | null>(null);

  useEffect(() => {
    webApi.admin
      .stats()
      .then(setStats)
      .catch(() => router.replace("/vaults"));
  }, [router]);

  const num = (v: number) => formatNumber(v);

  return (
    <div className="min-h-screen flex flex-col items-center gap-5 py-16 px-4">
      <AdminNav active="stats" />

      {!stats ? (
        <p className="w-full max-w-5xl text-sm text-[var(--text-secondary)]">{t("web.vaultList.loading")}</p>
      ) : (
        <>
          <div className="w-full max-w-5xl grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile
              label={t("web.admin.stats.users")}
              value={num(stats.users.total)}
              hint={t("web.admin.stats.usersHint", { verified: num(stats.users.verified), locked: num(stats.users.locked) })}
            />
            <Tile
              label={t("web.admin.stats.newUsers")}
              value={num(stats.users.new7)}
              hint={t("web.admin.stats.newUsersHint", { count: num(stats.users.new30) })}
            />
            <Tile
              label={t("web.admin.stats.active")}
              value={num(stats.active.day7)}
              hint={t("web.admin.stats.activeHint", { today: num(stats.active.day1), month: num(stats.active.day30) })}
            />
            <Tile
              label={t("web.admin.stats.content")}
              value={formatFileSize(stats.content.attachmentBytes)}
              hint={t("web.admin.stats.contentHint", { vaults: num(stats.content.vaults), notes: num(stats.content.notes) })}
            />
          </div>

          <div className="w-full max-w-5xl overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="text-left text-[var(--text-secondary)] bg-[var(--bg-secondary)]">
                <tr>
                  <th className="px-3 py-2">{t("web.admin.stats.week")}</th>
                  <th className="px-3 py-2 text-right">{t("web.admin.stats.signups")}</th>
                  <th className="px-3 py-2 text-right">{t("web.admin.stats.activeWeek")}</th>
                  <th className="px-3 py-2 text-right">{t("web.admin.stats.retention1")}</th>
                  <th className="px-3 py-2 text-right">{t("web.admin.stats.retention4")}</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.weeks].reverse().map((w) => (
                  <tr key={w.week} data-week={w.week} className="border-t border-[var(--border)]">
                    <td className="px-3 py-2 whitespace-nowrap">{formatDate(new Date(`${w.week}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}</td>
                    <td className="px-3 py-2 text-right" data-col="signups">{num(w.signups)}</td>
                    <td className="px-3 py-2 text-right" data-col="active">{num(w.active)}</td>
                    <td className="px-3 py-2 text-right">{percent(w.retentionWeek1)}</td>
                    <td className="px-3 py-2 text-right">{percent(w.retentionWeek4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="w-full max-w-5xl text-xs text-[var(--text-secondary)]">{t("web.admin.stats.explain")}</p>
        </>
      )}
    </div>
  );
}
