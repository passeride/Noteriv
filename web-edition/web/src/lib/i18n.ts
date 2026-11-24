import { isLocale, registerCatalog, resolveLocale, setLocale, type Locale } from "@noteriv/ui/i18n";
import vi from "@noteriv/ui/i18n/locales/vi.json";

/**
 * Language of the web app.
 *
 * Order: the developer override, the user's choice (the account preference, mirrored in this browser for the pages
 * shown before it loads, such as login), the browser's languages, then English. The server renders English; a small
 * script in the page head (`LOCALE_BOOT_SCRIPT`) hides the page until the client has switched when the language will
 * not be English, so nobody sees English text flash before their own language.
 *
 * Every catalog this app offers is bundled, so switching is synchronous once the page has mounted. Importing this
 * module sets the language, so a page that shows catalog text imports it (directly or through `applyLanguage`).
 */
export const DEFAULT_LOCALE: Locale = "en";

/** The user's choice on this device: a copy of the account preference, or what was picked on the login page. */
export const LOCALE_STORAGE_KEY = "noteriv.locale";
/** Developer override to try a language: `localStorage["noteriv.locale.dev"] = "vi"`. */
export const DEV_LOCALE_STORAGE_KEY = "noteriv.locale.dev";
/** Class on <html> while the page waits for its language (see LOCALE_BOOT_SCRIPT). */
export const LOCALE_PENDING_CLASS = "i18n-pending";

registerCatalog("vi", vi);
void setLocale(DEFAULT_LOCALE);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice still applies to this page */
  }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

/** Developer override, then the saved choice, then the browser's languages, then English. */
export function chooseLocale(saved?: unknown, preferred: readonly string[] = browserLanguages()): Locale {
  const dev = read(DEV_LOCALE_STORAGE_KEY);
  if (isLocale(dev)) return dev;
  return resolveLocale({ saved, preferred, fallback: DEFAULT_LOCALE });
}

function apply(saved: unknown): void {
  void setLocale(chooseLocale(saved)).finally(() => {
    if (typeof document !== "undefined") document.documentElement.classList.remove(LOCALE_PENDING_CLASS);
  });
}

/** Applies the language chosen on this device (call once mounted: the server rendered English). */
export function applyStoredLanguage(): void {
  apply(read(LOCALE_STORAGE_KEY));
}

/**
 * Applies the account's language preference and keeps a copy on this device. A preference that is not set leaves
 * the device's own choice in place (for example one made on the login page).
 */
export function applyLanguage(saved: unknown): void {
  if (isLocale(saved)) write(LOCALE_STORAGE_KEY, saved);
  apply(isLocale(saved) ? saved : read(LOCALE_STORAGE_KEY));
}

/** The language picked on this device (login page or an earlier preference), if any. */
export function storedLanguage(): Locale | undefined {
  const value = read(LOCALE_STORAGE_KEY);
  return isLocale(value) ? value : undefined;
}

/** The user picked "follow the browser": forget the device's choice and use the browser's languages. */
export function applyAutomaticLanguage(): void {
  write(LOCALE_STORAGE_KEY, null);
  apply(undefined);
}

/**
 * Runs in the page head before the first paint and repeats `chooseLocale` without the bundle (keep the two in step).
 * When the page will not be English it sets `lang` and hides the body until LocaleSync has switched (at most 1 s).
 */
export const LOCALE_BOOT_SCRIPT = `(function(){try{
var s=function(k){try{return localStorage.getItem(k)}catch(e){return null}};
var ok=function(l){return l==="en"||l==="vi"};
var l=s(${JSON.stringify(DEV_LOCALE_STORAGE_KEY)});
if(!ok(l)){l=s(${JSON.stringify(LOCALE_STORAGE_KEY)});}
if(!ok(l)){l=null;var p=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];for(var i=0;i<p.length;i++){var b=String(p[i]||"").toLowerCase().split("-")[0];if(ok(b)){l=b;break}}}
if(l&&l!==${JSON.stringify(DEFAULT_LOCALE)}){var h=document.documentElement;h.lang=l;h.classList.add(${JSON.stringify(LOCALE_PENDING_CLASS)});setTimeout(function(){h.classList.remove(${JSON.stringify(LOCALE_PENDING_CLASS)})},1000);}
}catch(e){}})();`;
