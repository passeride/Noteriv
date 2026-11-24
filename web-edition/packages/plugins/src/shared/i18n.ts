import type { PluginApi } from "@noteriv/plugin-api";

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * `t` for one plugin's group in the shared catalog (`plugins.<group>.*` in packages/ui/src/i18n/locales).
 * Call it while building labels in `onload`, never at module scope: the host reloads plugins when the language changes.
 */
export function pluginT(api: PluginApi, group: string): Translate {
  return (key, params) => api.i18n.t(`plugins.${group}.${key}`, params);
}

/** A list kept in the catalog as one comma-separated string (month or weekday abbreviations). */
export function listOf(t: Translate, key: string): string[] {
  return t(key).split(",").map((s) => s.trim());
}
