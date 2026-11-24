/**
 * Pure translation helpers: no state, no catalog files. The app-wide store built on them is in ./index.ts.
 *
 * Catalogs are nested JSON objects; a leaf is either a string or a plural object (`{ "one": …, "other": … }`,
 * chosen with `Intl.PluralRules` from `params.count`). `{name}` in a string is replaced by `params.name`; a
 * placeholder without a matching param is left as written.
 */

export type Locale = "en" | "vi";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "vi"];

export type Messages = { readonly [key: string]: string | Messages };

export type Params = Record<string, string | number>;

export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

export type CatalogEntry = string | PluralForms;

/** Dotted key → entry, built once per catalog with `flattenMessages`. */
export type FlatCatalog = ReadonlyMap<string, CatalogEntry>;

export type Translate = (key: string, params?: Params) => string;

const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"]);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** A nested object counts as plural forms when it has `other` and only plural-category keys holding strings. */
export function isPluralForms(value: unknown): value is PluralForms {
  if (typeof value !== "object" || value === null) return false;
  const entries = Object.entries(value);
  return (
    typeof (value as { other?: unknown }).other === "string" &&
    entries.every(([k, v]) => PLURAL_CATEGORIES.has(k) && typeof v === "string")
  );
}

export function flattenMessages(messages: Messages, prefix = "", out = new Map<string, CatalogEntry>()): Map<string, CatalogEntry> {
  for (const [k, v] of Object.entries(messages)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string" || isPluralForms(v)) out.set(key, v as CatalogEntry);
    else flattenMessages(v, key, out);
  }
  return out;
}

/** Placeholder names used in a string (`"{count} words"` → `["count"]`). */
export function placeholders(text: string): string[] {
  return Array.from(text.matchAll(/\{(\w+)\}/g), (m) => m[1]);
}

function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

const pluralRules = new Map<Locale, Pick<Intl.PluralRules, "select">>();

/**
 * The rules of the two supported languages, for an engine without `Intl.PluralRules` (the Android app's Hermes
 * may lack it): English has "one" for exactly 1, Vietnamese has no plural forms.
 */
const BASIC_PLURALS: Record<Locale, (count: number) => Intl.LDMLPluralRule> = {
  en: (count) => (count === 1 ? "one" : "other"),
  vi: () => "other",
};

function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = typeof Intl !== "undefined" && typeof Intl.PluralRules === "function"
      ? new Intl.PluralRules(locale)
      : { select: BASIC_PLURALS[locale] };
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/** The text of one entry in `locale`, with params filled in. */
export function formatEntry(locale: Locale, entry: CatalogEntry, params?: Params): string {
  if (typeof entry === "string") return interpolate(entry, params);
  const count = Number(params?.count ?? 0);
  return interpolate(entry[pluralCategory(locale, count)] ?? entry.other, params);
}

/**
 * A `t` for one locale. A key missing from `catalog` comes from `fallback` (English), and a key missing from both
 * comes back as the key itself (reported once through `onMissing`), so a gap shows up without breaking the screen.
 */
export function createTranslator(
  locale: Locale,
  catalog: FlatCatalog,
  fallback?: FlatCatalog,
  onMissing?: (key: string) => void,
): Translate {
  return (key, params) => {
    const own = catalog.get(key);
    if (own !== undefined) return formatEntry(locale, own, params);
    const backup = fallback?.get(key);
    if (backup !== undefined) return formatEntry("en", backup, params);
    onMissing?.(key);
    return key;
  };
}

/**
 * The locale to use: the saved choice when it is supported, otherwise the first supported language the browser or
 * OS prefers (`vi-VN` → `vi`), otherwise `fallback`.
 */
export function resolveLocale(options: { saved?: unknown; preferred?: readonly string[]; fallback?: Locale }): Locale {
  if (isLocale(options.saved)) return options.saved;
  for (const tag of options.preferred ?? []) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return options.fallback ?? "en";
}
