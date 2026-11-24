"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { webApi, ApiError } from "@/lib/webApi";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import LanguageSwitch from "@/components/LanguageSwitch";
import { forgetLinkToken, readLinkToken } from "@/lib/link-token";
import { clearCachedPages } from "@/components/ServiceWorkerRegister";

type Outcome = "checking" | "verified" | "changed" | "badLink" | "emailTaken" | "error";

/** Opened from the sign-up verification email and from the "confirm new email" email; the server tells which. */
export default function VerifyEmailPage() {
  useLocale();
  const [outcome, setOutcome] = useState<Outcome>("checking");

  // Once: a token works a single time, and a dev StrictMode re-run would spend it and then report it as used.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = readLinkToken();
    forgetLinkToken();
    if (!token) return setOutcome("badLink");
    webApi.auth
      .verifyEmail(token)
      .then((r) => {
        if (r.purpose === "change_email") {
          // The server ended every session of the account; pages kept for it go too.
          clearCachedPages();
          setOutcome("changed");
        } else {
          setOutcome("verified");
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 400) setOutcome("badLink");
        else if (err instanceof ApiError && err.status === 409) setOutcome("emailTaken");
        else setOutcome("error");
      });
  }, []);

  const message: Record<Outcome, string> = {
    checking: t("web.auth.verifying"),
    verified: t("web.auth.verifyDone"),
    changed: t("web.auth.emailChangedDone"),
    badLink: t("web.auth.badLink"),
    emailTaken: t("web.auth.emailTaken"),
    error: t("web.auth.error"),
  };
  const failed = outcome === "badLink" || outcome === "emailTaken" || outcome === "error";

  return (
    <div className="h-screen flex items-center justify-center">
      <div className="w-80 flex flex-col gap-3 p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
        <h1 className="text-xl font-semibold mb-2">{t("web.auth.verifyTitle")}</h1>
        <p className={`text-sm ${failed ? "text-[var(--red)]" : "text-[var(--text-secondary)]"}`} role="status">
          {message[outcome]}
        </p>
        {outcome !== "checking" && (
          <Link href={outcome === "changed" ? "/login" : "/vaults"} className="text-sm text-[var(--accent)]">
            {outcome === "changed" ? t("web.auth.signIn") : t("web.auth.continue")}
          </Link>
        )}
        <LanguageSwitch />
      </div>
    </div>
  );
}
