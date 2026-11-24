"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { webApi, ApiError } from "@/lib/webApi";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import LanguageSwitch from "@/components/LanguageSwitch";
import { forgetLinkToken, readLinkToken } from "@/lib/link-token";
import { clearCachedPages } from "@/components/ServiceWorkerRegister";
import { clearOfflineData } from "@/lib/offline-store";

export default function ResetPasswordPage() {
  useLocale();
  // undefined until read on the client; null when the address has no token.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Read once: the second run of a dev StrictMode effect would find the address already cleaned.
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    setToken(readLinkToken());
    forgetLinkToken();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setLoading(true);
    try {
      await webApi.auth.resetPassword({ token, password });
      // The server signed this browser out too; what it kept for the old session goes with it.
      clearCachedPages();
      await clearOfflineData().catch(() => undefined);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) setError(t("web.auth.badLink"));
      else if (err instanceof ApiError && err.status === 429) setError(t("web.auth.tooMany"));
      else setError(t("web.auth.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center">
      <form onSubmit={onSubmit} className="w-80 flex flex-col gap-3 p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
        <h1 className="text-xl font-semibold mb-2">{t("web.auth.resetTitle")}</h1>
        {done ? (
          <p className="text-sm text-[var(--text-secondary)]" role="status">
            {t("web.auth.resetDone")}
          </p>
        ) : token === null ? (
          <p className="text-sm text-[var(--red)]">{t("web.auth.badLink")}</p>
        ) : (
          <>
            <input
              type="password"
              placeholder={t("web.auth.newPassword")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
              className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
            {error && <p className="text-sm text-[var(--red)]">{error}</p>}
            <button
              type="submit"
              disabled={loading || !token}
              className="px-3 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] font-medium disabled:opacity-50"
            >
              {loading ? t("web.auth.saving") : t("web.auth.resetSubmit")}
            </button>
          </>
        )}
        <p className="text-sm text-center">
          {done || token === null ? (
            <Link href={done ? "/login" : "/forgot-password"} className="text-[var(--accent)]">
              {done ? t("web.auth.signIn") : t("web.auth.forgotLink")}
            </Link>
          ) : (
            <Link href="/login" className="text-[var(--accent)]">
              {t("web.auth.backToSignIn")}
            </Link>
          )}
        </p>
        <LanguageSwitch />
      </form>
    </div>
  );
}
