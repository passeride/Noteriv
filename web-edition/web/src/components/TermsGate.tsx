"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, apiErrorCode, webApi } from "@/lib/webApi";
import { TERMS_VERSION } from "@/lib/legal";
import { deleteMyAccount, downloadMyData } from "@/lib/account-actions";
import { clearCachedPages } from "@/components/ServiceWorkerRegister";
import { clearOfflineData, pendingEdits } from "@/lib/offline-store";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

const secondary = "text-left px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50";

/**
 * Asks a signed-in account to accept the Terms and Privacy Policy again after TERMS_VERSION changed (web/src/lib/legal.ts,
 * web/server/src/lib/registration.ts). It covers the app pages until the user accepts; the other ways out are the ones
 * the Privacy Policy promises: download the data, delete the account, or sign out. Only the pages ask: the API keeps
 * answering, so sync, collaboration and the web clipper are not cut off meanwhile. Without a network nothing shows.
 */
export default function TermsGate() {
  useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Edits kept on this device that signing out would lose; set when the first click on Sign out found some. */
  const [unsentEdits, setUnsentEdits] = useState(0);

  useEffect(() => {
    let cancelled = false;
    webApi.auth
      .me()
      .then((u) => {
        if (!cancelled) setOpen(u.termsAccepted === false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!open) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      // The server has a newer text than this page shows: load the page again so the user reads that one.
      if (apiErrorCode(err) === "terms_outdated") return window.location.reload();
      setError(err instanceof ApiError && err.status === 429 ? t("web.auth.tooMany") : t("web.termsGate.failed"));
    } finally {
      setBusy(false);
    }
  }

  const accept = () =>
    run(async () => {
      await webApi.users.acceptTerms(TERMS_VERSION);
      setOpen(false);
    });

  const remove = () => {
    if (!confirmDelete) return setConfirmDelete(true);
    const password = window.prompt(t("web.vaultList.deletePasswordPrompt") || "Enter your password to confirm account deletion:");
    if (!password) {
      setConfirmDelete(false);
      return;
    }
    return run(async () => {
      try {
        await deleteMyAccount(password);
        router.replace("/login");
      } catch {
        setConfirmDelete(false);
        setError(t("web.vaultList.wrongPassword") || "Wrong password.");
      }
    });
  };

  const signOut = async () => {
    const unsent = (await pendingEdits()).length;
    if (unsent > 0 && unsentEdits === 0) return setUnsentEdits(unsent);
    return run(async () => {
      await webApi.auth.logout();
      clearCachedPages();
      await clearOfflineData();
      router.replace("/login");
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.6)" }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terms-gate-title"
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col gap-3 p-6 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-xl"
      >
        <h2 id="terms-gate-title" className="text-lg font-semibold">
          {t("web.termsGate.title")}
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">{t("web.termsGate.intro")}</p>
        <ul className="list-disc pl-5 text-sm text-[var(--text-secondary)] flex flex-col gap-1">
          <li>{t("web.termsGate.change1")}</li>
          <li>{t("web.termsGate.change2")}</li>
          <li>{t("web.termsGate.change3")}</li>
          <li>{t("web.termsGate.change4")}</li>
        </ul>
        <p className="text-sm">
          {t("web.termsGate.readBefore")}{" "}
          <Link href="/terms" target="_blank" className="text-[var(--accent)] hover:underline">
            {t("web.auth.termsOfUse")}
          </Link>{" "}
          {t("web.auth.and")}{" "}
          <Link href="/privacy" target="_blank" className="text-[var(--accent)] hover:underline">
            {t("web.auth.privacyPolicy")}
          </Link>
          .
        </p>
        {error && (
          <p className="text-sm text-[var(--red)]" role="alert">
            {error}
          </p>
        )}
        <button
          onClick={accept}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] font-medium disabled:opacity-50"
        >
          {busy ? t("web.termsGate.accepting") : t("web.termsGate.accept")}
        </button>
        <div className="flex flex-col gap-1 pt-3 border-t border-[var(--border)]">
          <p className="px-3 text-xs text-[var(--text-muted)]">{t("web.termsGate.otherwise")}</p>
          <button onClick={() => run(downloadMyData)} disabled={busy} className={secondary}>
            {t("web.vaultList.export")}
          </button>
          <button onClick={remove} onBlur={() => setConfirmDelete(false)} disabled={busy} className={`${secondary} !text-[var(--red)]`}>
            {confirmDelete ? t("web.vaultList.deleteConfirm") : t("web.vaultList.delete")}
          </button>
          {unsentEdits > 0 && <p className="px-3 text-sm text-[var(--yellow)]">{t("web.offline.signOutUnsent", { count: unsentEdits })}</p>}
          <button onClick={signOut} disabled={busy} className={secondary}>
            {t("web.vaultList.signOut")}
          </button>
        </div>
      </div>
    </div>
  );
}
