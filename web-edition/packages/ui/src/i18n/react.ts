import { useSyncExternalStore } from "react";
import { getLocale, onLocaleChange, t } from "./index";
import type { Locale } from "./translate";

/** The current language; the component re-renders when it changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, getLocale, getLocale);
}

/** `t`, with the component subscribed to language changes. */
export function useT(): typeof t {
  useLocale();
  return t;
}
