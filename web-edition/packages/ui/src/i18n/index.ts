/**
 * App-wide language for web and desktop (and the core plugins they host).
 *
 * English is bundled and is the fallback for every key; other catalogs load on demand (`setLocale`), or an app that
 * must show one on its first paint registers it up front (`registerCatalog`). Components re-render on a change
 * through `useLocale` (./react.ts); everything else calls `t` when it needs the text, never at module load.
 */

import en from "./locales/en.json";
import {
  createTranslator,
  flattenMessages,
  type FlatCatalog,
  type Locale,
  type Messages,
  type Params,
  type Translate,
} from "./translate";

export * from "./translate";

const catalogs = new Map<Locale, FlatCatalog>([["en", flattenMessages(en)]]);

const loaders: Record<Locale, () => Promise<Messages>> = {
  en: async () => en,
  vi: () => import("./locales/vi.json").then((m) => m.default as Messages),
};

const reported = new Set<string>();
function reportMissing(key: string) {
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(`[i18n] missing key: ${key}`);
}

let current: Locale = "en";
let translate: Translate = createTranslator("en", catalogs.get("en")!, undefined, reportMissing);
let requested: Locale = "en";
const listeners = new Set<() => void>();

function apply(locale: Locale) {
  current = locale;
  translate = createTranslator(locale, catalogs.get(locale)!, catalogs.get("en"), reportMissing);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  for (const l of Array.from(listeners)) l();
}

export function getLocale(): Locale {
  return current;
}

/** Adds (or replaces) a catalog without loading it lazily; switches the text at once if it is the current locale. */
export function registerCatalog(locale: Locale, messages: Messages): void {
  catalogs.set(locale, flattenMessages(messages));
  if (locale === current) apply(locale);
}

/**
 * Switches the language. Synchronous when the catalog is already there (bundled or registered), otherwise it
 * resolves once the catalog has loaded; of several quick calls, the last one wins.
 */
export async function setLocale(locale: Locale): Promise<void> {
  requested = locale;
  if (!catalogs.has(locale)) {
    const messages = await loaders[locale]();
    catalogs.set(locale, flattenMessages(messages));
    if (requested !== locale) return;
  }
  if (locale !== current) apply(locale);
}

/** Called after every language change. Returns the unsubscribe function. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The text for `key` in the current language (English when the key is not translated). */
export function t(key: string, params?: Params): string {
  return translate(key, params);
}

/**
 * `t(key)` when the catalogs have the key, otherwise `fallback`: for text that may come from outside them (an app's
 * hotkey table naming an action the catalog does not know).
 */
export function tOr(key: string, fallback: string, params?: Params): string {
  return catalogs.get("en")!.has(key) ? translate(key, params) : fallback;
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(current, options).format(value);
}

export function formatDate(value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(current, options).format(value);
}
