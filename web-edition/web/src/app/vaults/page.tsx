"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, webApi, type ApiUser, type ApiVault } from "@/lib/webApi";
import AccountEmail from "@/components/AccountEmail";
import StatusLink from "@/components/StatusLink";
import TermsGate from "@/components/TermsGate";
import { deleteMyAccount, downloadMyData } from "@/lib/account-actions";
import { planLimitNotice } from "@/components/PlanLimitNotice";
import { clearCachedPages } from "@/components/ServiceWorkerRegister";
import { isNetworkError } from "@/lib/offline";
import { claimOfflineData, clearOfflineData, kvGet, kvSet, pendingEdits } from "@/lib/offline-store";
import { flushPending } from "@/lib/offline-sync";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import { applyLanguage } from "@/lib/i18n";

export default function VaultsPage() {
  useLocale();
  const router = useRouter();
  const [vaults, setVaults] = useState<ApiVault[] | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [me, setMe] = useState<ApiUser | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  /** Edits kept on this device that signing out would lose; set when the first click on Sign out found some. */
  const [unsentEdits, setUnsentEdits] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [createError, setCreateError] = useState<React.ReactNode>(null);

  useEffect(() => {
    webApi.vaults
      .list()
      .then((list) => {
        setVaults(list);
        void kvSet("vaults", list);
        // Edits kept on this device from an offline session go out now, whichever vault they belong to.
        void flushPending();
      })
      // Only a refused session means "sign in again"; no network (the installed app opened offline) does not: the
      // list kept on this device shows instead.
      .catch(async (err) => {
        if (err instanceof ApiError && err.status === 401) return router.replace("/login");
        setUnreachable(true);
        if (isNetworkError(err)) {
          const kept = await kvGet<ApiVault[]>("vaults");
          if (kept) setVaults(kept);
        }
      });
    webApi.auth
      .me()
      .then((u) => {
        setMe(u);
        void claimOfflineData(u.id);
      })
      .catch(() => undefined);
    // The account's language, so this page (and the next ones) shows it even on a device that never opened a vault.
    webApi.preferences
      .get()
      .then((prefs) => applyLanguage((prefs.editorSettings as { language?: unknown } | undefined)?.language))
      .catch(() => undefined);
  }, [router]);

  async function createVault(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const vault = await webApi.vaults.create({ name: newName.trim() });
      router.push(`/vaults/${vault.id}`);
    } catch (err) {
      setCreateError(planLimitNotice(err) ?? t("web.newVaultGithub.createFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function logout() {
    // Signing out forgets what this device kept, including edits not sent yet: say so once before doing it.
    const unsent = (await pendingEdits()).length;
    if (unsent > 0 && unsentEdits === 0) {
      setUnsentEdits(unsent);
      return;
    }
    try {
      await webApi.auth.logout();
    } catch (err) {
      // The session lives on the server: without a connection it cannot be ended, so nothing is forgotten either.
      if (isNetworkError(err)) return setNotice(t("web.offline.needsNetwork"));
      throw err;
    }
    clearCachedPages();
    await clearOfflineData();
    router.replace("/login");
  }

  async function deleteAccount() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    const password = window.prompt(t("web.vaultList.deletePasswordPrompt") || "Enter your password to confirm account deletion:");
    if (!password) {
      setConfirmDelete(false);
      return;
    }
    setDeletingAccount(true);
    try {
      await deleteMyAccount(password);
      router.replace("/login");
    } catch {
      setConfirmDelete(false);
      setNotice(t("web.vaultList.wrongPassword") || "Wrong password.");
    } finally {
      setDeletingAccount(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center gap-6 pt-20 pb-12 px-4">
      <div className="flex items-center justify-between w-full max-w-md">
        <h1 className="text-2xl font-semibold">{t("web.vaultList.title")}</h1>
        <button onClick={logout} className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          {t("web.vaultList.signOut")}
        </button>
      </div>

      <div className="w-full max-w-md flex flex-col gap-2">
        {vaults === null && !unreachable && <p className="text-[var(--text-secondary)]">{t("web.vaultList.loading")}</p>}
        {unreachable && <p className="text-[var(--text-secondary)]">{vaults?.length ? t("web.offline.vaultListKept") : t("web.vaultList.unreachable")}</p>}
        {unsentEdits > 0 && <p className="text-sm text-[var(--yellow)]">{t("web.offline.signOutUnsent", { count: unsentEdits })}</p>}
        {notice && <p className="text-sm text-[var(--yellow)]">{notice}</p>}
        {vaults?.length === 0 && (
          <>
            <p className="text-[var(--text-secondary)]">{t("web.vaultList.empty")}</p>
            <p className="text-sm text-[var(--text-muted)]">{t("web.vaultList.emptyHint")}</p>
          </>
        )}
        {vaults?.map((v) => (
          <button
            key={v.id}
            onClick={() => router.push(`/vaults/${v.id}`)}
            className="text-left px-4 py-3 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] border border-[var(--border)]"
          >
            {v.name}
          </button>
        ))}
      </div>

      <form onSubmit={createVault} className="w-full max-w-md flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("web.vaults.newPlaceholder")}
          className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <button
          type="submit"
          disabled={creating}
          className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] font-medium disabled:opacity-50"
        >
          {t("web.vaultList.create")}
        </button>
      </form>
      {createError && <p className="w-full max-w-md text-sm text-[var(--red)]">{createError}</p>}

      <div className="w-full max-w-md flex gap-4 text-sm">
        <Link href="/quick" className="text-[var(--accent)] hover:underline">
          {t("web.quick.open")}
        </Link>
        <Link href="/install" className="text-[var(--accent)] hover:underline">
          {t("web.install.link")}
        </Link>
      </div>

      <div className="w-full max-w-md flex flex-col gap-2 mt-8 pt-6 border-t border-[var(--border)]">
        <h2 className="text-sm font-medium text-[var(--text-secondary)]">{t("web.vaultList.account")}</h2>
        {me && <AccountEmail user={me} />}
        {me?.isAdmin && (
          <Link
            href="/admin"
            className="px-3 py-2 rounded-lg text-sm text-[var(--accent)] hover:bg-[var(--bg-secondary)]"
          >
            {t("web.vaultList.admin")}
          </Link>
        )}
        <button
          onClick={downloadMyData}
          className="text-left px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        >
          {t("web.vaultList.export")}
        </button>
        <button
          onClick={deleteAccount}
          onBlur={() => setConfirmDelete(false)}
          disabled={deletingAccount}
          className="text-left px-3 py-2 rounded-lg text-sm text-[var(--red)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
        >
          {confirmDelete ? t("web.vaultList.deleteConfirm") : t("web.vaultList.delete")}
        </button>
        <p className="px-3 text-xs text-[var(--text-secondary)]">
          <Link href="/terms" className="hover:text-[var(--text-primary)]">
            {t("web.auth.termsOfUse")}
          </Link>
          {" · "}
          <Link href="/privacy" className="hover:text-[var(--text-primary)]">
            {t("web.auth.privacyPolicy")}
          </Link>
          <StatusLink />
        </p>
      </div>
      <TermsGate />
    </div>
  );
}
