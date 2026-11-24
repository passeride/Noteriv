"use client";

import { useEffect } from "react";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import { reportError } from "@/lib/error-reporting";

/** Fallback when a page crashes while rendering: reports the error (when reporting is on) and offers a retry. */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useLocale();
  useEffect(() => {
    reportError(error);
  }, [error]);
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div role="alert" className="w-80 flex flex-col gap-3 p-6 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] text-center">
        <h1 className="text-lg font-semibold">{t("web.errorPage.title")}</h1>
        <p className="text-sm text-[var(--text-secondary)]">{t("web.errorPage.body")}</p>
        <button onClick={() => retry()} className="py-2 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] font-medium">
          {t("web.errorPage.retry")}
        </button>
      </div>
    </div>
  );
}
