"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { webApi, type ApiAuditEntry } from "@/lib/webApi";
import AdminNav from "@/components/AdminNav";
import { formatDate, t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

const input = "px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]";

/** Metadata as one short line; the full value is in the tooltip. */
function details(meta: unknown): string {
  if (meta === null || meta === undefined) return "";
  const s = JSON.stringify(meta);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/** The audit log, newest first: who did what, from where. Filters match part of the action or of the user's email. */
export default function AdminAuditPage() {
  useLocale();
  const router = useRouter();
  const [action, setAction] = useState("");
  const [email, setEmail] = useState("");
  const [filter, setFilter] = useState<{ action?: string; email?: string }>({});
  const [entries, setEntries] = useState<ApiAuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);

  const load = useCallback(
    async (before?: string) => {
      try {
        const page = await webApi.admin.audit({ ...filter, before });
        setEntries((prev) => (before && prev ? [...prev, ...page.entries] : page.entries));
        setNext(page.next);
      } catch {
        router.replace("/vaults");
      }
    },
    [filter, router]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen flex flex-col items-center gap-5 py-16 px-4">
      <AdminNav active="audit" />

      <form
        className="w-full max-w-5xl flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ action: action.trim() || undefined, email: email.trim() || undefined });
        }}
      >
        <input value={action} onChange={(e) => setAction(e.target.value)} placeholder={t("web.admin.audit.action")} aria-label={t("web.admin.audit.action")} className={`${input} flex-1 min-w-40`} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("web.admin.audit.email")} aria-label={t("web.admin.audit.email")} className={`${input} flex-1 min-w-40`} />
        <button type="submit" className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] font-medium">
          {t("web.admin.audit.filter")}
        </button>
      </form>

      <div className="w-full max-w-5xl overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--text-secondary)] bg-[var(--bg-secondary)]">
            <tr>
              <th className="px-3 py-2">{t("web.admin.audit.time")}</th>
              <th className="px-3 py-2">{t("web.admin.audit.actionCol")}</th>
              <th className="px-3 py-2">{t("web.admin.audit.who")}</th>
              <th className="px-3 py-2">{t("web.admin.audit.target")}</th>
              <th className="px-3 py-2">IP</th>
              <th className="px-3 py-2">{t("web.admin.audit.details")}</th>
            </tr>
          </thead>
          <tbody>
            {entries === null && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-[var(--text-secondary)]">
                  {t("web.vaultList.loading")}
                </td>
              </tr>
            )}
            {entries?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-[var(--text-secondary)]">
                  {t("web.admin.none")}
                </td>
              </tr>
            )}
            {entries?.map((e) => (
              <tr key={e.id} className="border-t border-[var(--border)] align-top">
                <td className="px-3 py-2 whitespace-nowrap text-[var(--text-secondary)]">
                  {formatDate(new Date(e.createdAt), { dateStyle: "short", timeStyle: "medium" })}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{e.action}</td>
                <td className="px-3 py-2">{e.userEmail ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--text-secondary)]">
                  {e.resourceType ? `${e.resourceType} ${e.resourceId?.slice(0, 8) ?? ""}` : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--text-secondary)]">{e.ip ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--text-secondary)]" title={e.metadata ? JSON.stringify(e.metadata) : undefined}>
                  {details(e.metadata)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {next && (
        <button onClick={() => load(next)} className="text-sm text-[var(--accent)] hover:underline">
          {t("web.admin.audit.more")}
        </button>
      )}
    </div>
  );
}
