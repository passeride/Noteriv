"use client";

import { useState } from "react";
import { webApi, ApiError, apiErrorCode, type ApiUser } from "@/lib/webApi";
import { getLocale, t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

/** What a failed email request means to the user; the server's codes are in web/server/src/routes/users.ts. */
function emailError(err: unknown): string {
  const code = apiErrorCode(err);
  if (code === "wrong_password") return t("web.vaultList.wrongPassword");
  if (code === "same_email") return t("web.vaultList.sameEmail");
  if (code === "email_taken") return t("web.auth.emailTaken");
  if (code === "throttled") return t("web.vaultList.tooSoon");
  if (code === "email_disabled") return t("web.vaultList.emailOff");
  if (code === "email_failed") return t("web.vaultList.emailFailed");
  if (err instanceof ApiError && err.status === 429) return t("web.auth.tooMany");
  return t("web.auth.error");
}

const linkButton = "text-left px-3 py-2 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]";
const field = "px-3 py-2 rounded-lg text-sm bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]";

/** The account's address on "Your vaults": whether it is verified, sending the link again, and changing it. */
export default function AccountEmail({ user }: { user: ApiUser }) {
  useLocale();
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");

  async function resend() {
    setBusy(true);
    setNotice(null);
    try {
      await webApi.users.resendVerification(getLocale());
      setNotice({ text: t("web.vaultList.verificationSent"), ok: true });
    } catch (err) {
      setNotice({ text: emailError(err), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const address = newEmail.trim();
      await webApi.users.changeEmail({ newEmail: address, password, locale: getLocale() });
      setNotice({ text: t("web.vaultList.changeEmailSent", { email: address }), ok: true });
      setChanging(false);
      setNewEmail("");
      setPassword("");
    } catch (err) {
      setNotice({ text: emailError(err), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="px-3 text-sm text-[var(--text-secondary)]">{t("web.vaultList.signedInAs", { email: user.email })}</p>
      {user.emailVerified === false && (
        <div className="px-3 flex flex-col gap-1">
          <p className="text-sm text-[var(--yellow)]">{t("web.vaultList.unverified")}</p>
          <button onClick={resend} disabled={busy} className="self-start text-sm text-[var(--accent)] hover:underline disabled:opacity-50">
            {t("web.vaultList.resendVerification")}
          </button>
        </div>
      )}
      {changing ? (
        <form onSubmit={changeEmail} className="px-3 flex flex-col gap-2">
          <input
            type="email"
            placeholder={t("web.vaultList.newEmail")}
            aria-label={t("web.vaultList.newEmail")}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
            autoComplete="email"
            className={field}
          />
          <input
            type="password"
            placeholder={t("web.vaultList.currentPassword")}
            aria-label={t("web.vaultList.currentPassword")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className={field}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-2 rounded-lg text-sm bg-[var(--accent)] text-[var(--bg-primary)] font-medium disabled:opacity-50"
            >
              {t("web.vaultList.sendConfirmation")}
            </button>
            <button type="button" onClick={() => setChanging(false)} className={linkButton}>
              {t("web.vaultList.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setChanging(true)} className={linkButton}>
          {t("web.vaultList.changeEmail")}
        </button>
      )}
      {notice && (
        <p className={`px-3 text-sm ${notice.ok ? "text-[var(--text-secondary)]" : "text-[var(--red)]"}`} role="status">
          {notice.text}
        </p>
      )}
    </div>
  );
}
