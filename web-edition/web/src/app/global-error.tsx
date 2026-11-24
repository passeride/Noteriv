"use client";

import { useEffect } from "react";
import { t } from "@noteriv/ui/i18n";
import { reportError } from "@/lib/error-reporting";

/**
 * Fallback when the root layout itself crashes. It replaces the whole document, so the app's styles are not loaded:
 * plain inline styles in the default dark theme's colours.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError(error);
  }, [error]);
  return (
    <html>
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1e1e2e", color: "#cdd6f4", fontFamily: "system-ui, sans-serif" }}>
        <div role="alert" style={{ maxWidth: 320, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 18 }}>{t("web.errorPage.title")}</h1>
          <p style={{ fontSize: 14, opacity: 0.8 }}>{t("web.errorPage.body")}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#89b4fa", color: "#1e1e2e", fontWeight: 600, cursor: "pointer" }}
          >
            {t("web.errorPage.reload")}
          </button>
        </div>
      </body>
    </html>
  );
}
