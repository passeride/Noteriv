"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { webApi, ApiError, apiErrorCode } from "@/lib/webApi";
import { CONTACT_EMAIL } from "@/lib/legal";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import LanguageSwitch from "@/components/LanguageSwitch";
import StatusLink from "@/components/StatusLink";
import { safeNext } from "@/lib/safe-next";
import { claimOfflineData } from "@/lib/offline-store";

export default function LoginPage() {
  useLocale();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // "Forgot password?" only where the server can send the email.
  const [emailEnabled, setEmailEnabled] = useState(false);

  useEffect(() => {
    webApi.auth
      .registration()
      .then((r) => setEmailEnabled(!!r.emailEnabled))
      .catch(() => undefined);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await webApi.auth.login({ email, password });
      // What this device kept offline belongs to one account; another one starts from nothing.
      await webApi.auth.me().then((u) => claimOfflineData(u.id)).catch(() => undefined);
      // Back to where the sign-in was asked for (e.g. /quick from the home-screen shortcut).
      router.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch (err) {
      if (apiErrorCode(err) === "account_locked") setError(t("web.auth.locked", { email: CONTACT_EMAIL }));
      else setError(err instanceof ApiError ? t("web.auth.badLogin") : t("web.auth.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center">
      <form onSubmit={onSubmit} className="w-80 flex flex-col gap-3 p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
        <h1 className="text-xl font-semibold mb-2">{t("web.auth.loginTitle")}</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <input
          type="password"
          placeholder={t("web.auth.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        {error && <p className="text-sm text-[var(--red)]">{error}</p>}
        {emailEnabled && (
          <Link href="/forgot-password" className="text-sm text-[var(--accent)] self-end">
            {t("web.auth.forgotLink")}
          </Link>
        )}
        <button
          type="submit"
          disabled={loading}
          className="px-3 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] font-medium disabled:opacity-50"
        >
          {loading ? t("web.auth.signingIn") : t("web.auth.signIn")}
        </button>
        <p className="text-sm text-[var(--text-secondary)] text-center">
          {t("web.auth.noAccount")}{" "}
          <Link href="/register" className="text-[var(--accent)]">
            {t("web.auth.signUp")}
          </Link>
        </p>
        <p className="text-xs text-[var(--text-secondary)] text-center">
          <Link href="/terms" className="hover:text-[var(--text-primary)]">
            {t("web.auth.terms")}
          </Link>
          {" · "}
          <Link href="/privacy" className="hover:text-[var(--text-primary)]">
            {t("web.auth.privacy")}
          </Link>
          {" · "}
          <Link href="/install" className="hover:text-[var(--text-primary)]">
            {t("web.install.link")}
          </Link>
          <StatusLink />
        </p>
        <LanguageSwitch />
      </form>
    </div>
  );
}
