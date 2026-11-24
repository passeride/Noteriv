"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { webApi, apiErrorCode, type ApiAdminUser } from "@/lib/webApi";
import { formatFileSize } from "@/lib/attachment-utils";
import AdminNav from "@/components/AdminNav";
import { formatDate, t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

/** What a refused admin action means (web/server/src/routes/admin.ts). */
function failure(err: unknown): string {
  const code = apiErrorCode(err);
  if (code === "email_disabled") return t("web.admin.emailOff");
  if (code === "throttled") return t("web.vaultList.tooSoon");
  if (code === "not_on_yourself") return t("web.admin.notOnYourself");
  if (code === "env_admin") return t("web.admin.envAdminHint");
  if (code === "is_admin") return t("web.admin.removeAdminFirst");
  return t("web.auth.error");
}

const badge = "inline-block px-1.5 py-0.5 rounded text-[11px] leading-none";
const action = "text-[var(--accent)] hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed";

export default function AdminUsersPage() {
  useLocale();
  const router = useRouter();
  const [me, setMe] = useState<string | null>(null);
  const [q, setQ] = useState("");
  /** The search actually run: set on Enter, not on every key. */
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ users: ApiAdminUser[]; total: number; pageSize: number } | null>(null);
  const [plans, setPlans] = useState<{ id: string; name: string }[]>([]);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The user whose Delete was clicked once; a second click deletes. */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await webApi.admin.users.list(search, page));
    } catch {
      // Not signed in, or not an admin (403): this page is not for them.
      router.replace("/vaults");
    }
  }, [search, page, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    webApi.auth.me().then((u) => setMe(u.id)).catch(() => undefined);
    webApi.admin.plans().then(setPlans).catch(() => undefined);
  }, []);

  async function run(userId: string, work: () => Promise<unknown>, done?: string) {
    setBusy(userId);
    setNotice(null);
    try {
      await work();
      if (done) setNotice({ text: done, ok: true });
      await load();
    } catch (err) {
      setNotice({ text: failure(err), ok: false });
    } finally {
      setBusy(null);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="min-h-screen flex flex-col items-center gap-5 py-16 px-4">
      <AdminNav active="users" />

      <form
        className="w-full max-w-5xl flex gap-3 items-center"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearch(q.trim());
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("web.admin.search")}
          aria-label={t("web.admin.search")}
          className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        {data && <span className="text-sm text-[var(--text-secondary)]">{t("web.admin.total", { count: data.total })}</span>}
      </form>

      {notice && (
        <p className={`w-full max-w-5xl text-sm ${notice.ok ? "text-[var(--text-secondary)]" : "text-[var(--red)]"}`} role="status">
          {notice.text}
        </p>
      )}

      <div className="w-full max-w-5xl overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="text-left text-[var(--text-secondary)] bg-[var(--bg-secondary)]">
            <tr>
              <th className="px-3 py-2">{t("web.admin.col.user")}</th>
              <th className="px-3 py-2">{t("web.admin.col.plan")}</th>
              <th className="px-3 py-2">{t("web.admin.col.usage")}</th>
              <th className="px-3 py-2">{t("web.admin.col.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {data === null && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-[var(--text-secondary)]">
                  {t("web.vaultList.loading")}
                </td>
              </tr>
            )}
            {data?.users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-[var(--text-secondary)]">
                  {t("web.admin.none")}
                </td>
              </tr>
            )}
            {data?.users.map((u) => {
              const self = u.id === me;
              const working = busy === u.id;
              return (
                <tr key={u.id} className="border-t border-[var(--border)] align-top" data-user-email={u.email}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{u.email}</div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {u.displayName} · {formatDate(new Date(u.createdAt), { dateStyle: "medium" })}
                    </div>
                    <div className="flex gap-1 mt-1">
                      {u.isAdmin && <span className={`${badge} bg-[var(--accent)] text-[var(--bg-primary)]`}>{t("web.admin.badge.admin")}</span>}
                      {u.locked && <span className={`${badge} bg-[var(--red)] text-[var(--bg-primary)]`}>{t("web.admin.badge.locked")}</span>}
                      {!u.emailVerified && <span className={`${badge} bg-[var(--bg-tertiary)]`}>{t("web.admin.badge.unverified")}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={u.planId}
                      disabled={working}
                      aria-label={t("web.admin.col.plan")}
                      onChange={(e) => run(u.id, () => webApi.admin.users.update(u.id, { planId: e.target.value }))}
                      className="px-2 py-1 rounded bg-[var(--bg-tertiary)]"
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      {!plans.some((p) => p.id === u.planId) && <option value={u.planId}>{u.planId}</option>}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-xs text-[var(--text-secondary)] whitespace-nowrap">
                    {t("web.admin.usage", {
                      vaults: u.usage.vaults,
                      storage: formatFileSize(u.usage.attachmentBytes),
                      sync: u.usage.syncConnections,
                    })}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <button
                        className={action}
                        disabled={working || self}
                        onClick={() => run(u.id, () => webApi.admin.users.update(u.id, { locked: !u.locked }))}
                      >
                        {u.locked ? t("web.admin.unlock") : t("web.admin.lock")}
                      </button>
                      <button
                        className={action}
                        disabled={working || self || u.envAdmin}
                        title={u.envAdmin ? t("web.admin.envAdminHint") : undefined}
                        onClick={() => run(u.id, () => webApi.admin.users.update(u.id, { role: u.role === "admin" ? "user" : "admin" }))}
                      >
                        {u.role === "admin" || u.envAdmin ? t("web.admin.removeAdmin") : t("web.admin.makeAdmin")}
                      </button>
                      <button className={action} disabled={working} onClick={() => run(u.id, () => webApi.admin.users.passwordReset(u.id), t("web.admin.resetSent"))}>
                        {t("web.admin.sendReset")}
                      </button>
                      {!u.emailVerified && (
                        <button className={action} disabled={working} onClick={() => run(u.id, () => webApi.admin.users.verifyEmail(u.id))}>
                          {t("web.admin.markVerified")}
                        </button>
                      )}
                      <button
                        className={`${action} !text-[var(--red)]`}
                        disabled={working || self || u.isAdmin}
                        title={u.isAdmin ? t("web.admin.removeAdminFirst") : undefined}
                        onBlur={() => setConfirmDelete((c) => (c === u.id ? null : c))}
                        onClick={() => {
                          if (confirmDelete !== u.id) return setConfirmDelete(u.id);
                          setConfirmDelete(null);
                          void run(u.id, () => webApi.admin.users.remove(u.id), t("web.admin.deleted"));
                        }}
                      >
                        {confirmDelete === u.id ? t("web.admin.deleteConfirm") : t("web.admin.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="w-full max-w-5xl flex items-center justify-end gap-3 text-sm">
          <button className={action} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("web.admin.prev")}
          </button>
          <span className="text-[var(--text-secondary)]">{t("web.admin.pageOf", { page, pages })}</span>
          <button className={action} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t("web.admin.next")}
          </button>
        </div>
      )}
    </div>
  );
}
