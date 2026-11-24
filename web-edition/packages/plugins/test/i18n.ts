import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { I18nApi } from "@noteriv/plugin-api";
// Core plugins never import @noteriv/ui (they get `api.i18n` from the host); the tests read the same catalogs the
// host uses, so a plugin asking for a key the catalog lacks fails here.
import { createTranslator, flattenMessages, type Locale, type Messages } from "../../ui/src/i18n/translate";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui", "src", "i18n", "locales");

function catalog(locale: Locale) {
  return flattenMessages(JSON.parse(readFileSync(join(localesDir, `${locale}.json`), "utf8")) as Messages);
}

/** The language each app shows during the stage-4 transition: web Vietnamese, desktop English. */
export function platformI18n(platform: "web" | "desktop"): I18nApi {
  return testI18n(platform === "web" ? "vi" : "en");
}

/** `api.i18n` as the host builds it, for `locale`; a missing key throws instead of showing the key. */
export function testI18n(locale: Locale = "en"): I18nApi {
  const t = createTranslator(locale, catalog(locale), catalog("en"), (key) => {
    throw new Error(`missing i18n key: ${key}`);
  });
  return { locale, t };
}
