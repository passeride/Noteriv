"use client";

import { t, type Locale } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import { applyLanguage } from "@/lib/i18n";

/** Each language named in itself, so it can be found whatever the current language is. */
const LANGUAGES: { locale: Locale; name: string }[] = [
  { locale: "en", name: "English" },
  { locale: "vi", name: "Tiếng Việt" },
];

/**
 * Language links for the pages shown before sign-in (no Settings yet). The choice is kept on this device and becomes
 * the account's language the first time a vault opens.
 */
export default function LanguageSwitch() {
  const current = useLocale();
  return (
    <p className="text-xs text-[var(--text-secondary)] text-center" aria-label={t("web.auth.language")}>
      {LANGUAGES.map((l, i) => (
        <span key={l.locale}>
          {i > 0 && " · "}
          <button
            type="button"
            lang={l.locale}
            onClick={() => applyLanguage(l.locale)}
            aria-pressed={current === l.locale}
            className={current === l.locale ? "text-[var(--text-primary)]" : "hover:text-[var(--text-primary)]"}
          >
            {l.name}
          </button>
        </span>
      ))}
    </p>
  );
}
