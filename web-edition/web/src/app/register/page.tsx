"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { webApi, ApiError, apiErrorCode, type RegistrationMode } from "@/lib/webApi";
import { getLocale, t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import LanguageSwitch from "@/components/LanguageSwitch";
import TurnstileWidget from "@/components/TurnstileWidget";

export default function RegisterPage() {
  useLocale();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [acceptTerms, setAcceptTerms] = useState(false);
  // null until the server answers; "invite" is assumed on failure so the field is never hidden by mistake.
  const [mode, setMode] = useState<RegistrationMode | null>(null);
  // Set when the server asks for the bot check; the button waits for a passed check.
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    webApi.auth
      .registration()
      .then((r) => {
        setMode(r.mode);
        setSiteKey(r.turnstileSiteKey ?? null);
      })
      .catch(() => setMode("invite"));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!acceptTerms) return;
    setError(null);
    setLoading(true);
    try {
      const account = await webApi.auth.register({
        email,
        password,
        displayName,
        acceptTerms: true,
        // The verification email is written in the language of this page.
        locale: getLocale(),
        ...(captchaToken ? { captchaToken } : {}),
        ...(mode === "invite" ? { inviteCode: inviteCode.trim() } : {}),
      });
      await import("@/lib/offline-store").then((m) => m.claimOfflineData(account.id)).catch(() => undefined);
      // A new account starts with the "Getting started" vault in the language it signed up in. Best effort: the
      // account exists already, so a failure here only means an empty vault list.
      try {
        const { createSampleVault } = await import("@/lib/sample-vault");
        await createSampleVault(getLocale());
      } catch {
        /* the user can create a vault themselves */
      }
      router.replace("/vaults");
    } catch (err) {
      const code = apiErrorCode(err);
      // A check token works once: run it again for the next try.
      if (siteKey) setCaptchaReset((n) => n + 1);
      if (code === "captcha_failed") {
        setError(t("web.auth.captchaFailed"));
      } else if (code === "invalid_invite") {
        setError(t("web.auth.badInvite"));
      } else if (code === "registration_closed") {
        setError(t("web.auth.closed"));
      } else if (err instanceof ApiError && err.status === 409) {
        setError(t("web.auth.emailTaken"));
      } else if (err instanceof ApiError && err.status === 429) {
        setError(t("web.auth.tooMany"));
      } else {
        setError(t("web.auth.registerError"));
      }
    } finally {
      setLoading(false);
    }
  }

  if (mode === "closed") {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-80 flex flex-col gap-3 p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
          <h1 className="text-xl font-semibold mb-2">{t("web.auth.closedTitle")}</h1>
          <p className="text-sm text-[var(--text-secondary)]">{t("web.auth.closedDesc")}</p>
          <Link href="/login" className="text-sm text-[var(--accent)]">
            {t("web.auth.signIn")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center">
      <form onSubmit={onSubmit} className={`w-80 ${siteKey ? "sm:w-[22rem]" : ""} flex flex-col gap-3 p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]`}>
        <h1 className="text-xl font-semibold mb-2">{t("web.auth.registerTitle")}</h1>
        {mode !== "open" && (
          <input
            type="text"
            placeholder={t("web.auth.inviteCode")}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)] tracking-wider"
          />
        )}
        <input
          type="text"
          placeholder={t("web.auth.displayName")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
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
          placeholder={t("web.auth.newPassword")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <label className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={acceptTerms}
            onChange={(e) => setAcceptTerms(e.target.checked)}
            required
            className="mt-1"
          />
          <span>
            {t("web.auth.acceptBefore")}{" "}
            <Link href="/terms" target="_blank" className="text-[var(--accent)]">
              {t("web.auth.termsOfUse")}
            </Link>{" "}
            {t("web.auth.and")}{" "}
            <Link href="/privacy" target="_blank" className="text-[var(--accent)]">
              {t("web.auth.privacyPolicy")}
            </Link>
            .
          </span>
        </label>
        {siteKey && <TurnstileWidget siteKey={siteKey} onToken={setCaptchaToken} resetSignal={captchaReset} />}
        {error && <p className="text-sm text-[var(--red)]">{error}</p>}
        <button
          type="submit"
          disabled={loading || !acceptTerms || mode === null || (!!siteKey && !captchaToken)}
          className="px-3 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] font-medium disabled:opacity-50"
        >
          {loading ? t("web.auth.creating") : t("web.auth.signUp")}
        </button>
        <p className="text-sm text-[var(--text-secondary)] text-center">
          {t("web.auth.haveAccount")}{" "}
          <Link href="/login" className="text-[var(--accent)]">
            {t("web.auth.signIn")}
          </Link>
        </p>
        <LanguageSwitch />
      </form>
    </div>
  );
}
