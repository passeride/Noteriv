import type { PluginApi } from "@noteriv/plugin-api";
import type { CorePluginDef } from "@noteriv/core/plugin-registry";
import type { VaultAdapter } from "@noteriv/core/vault-adapter";
import { settingsKeyStateStore, type CorePluginHostConfig } from "@noteriv/ui/plugins";

/**
 * Core plugins shipped with the web app. `load` must stay a dynamic import(): it is what keeps a disabled plugin's
 * code out of the page bundle (Next splits it into its own chunk). Names and descriptions are in the i18n catalog
 * (`plugins.<camelCaseId>.name` / `.description`, shared with desktop).
 */
export const CORE_PLUGINS: CorePluginDef<PluginApi>[] = [
  {
    id: "word-count",
    load: () => import("@noteriv/plugins/word-count"),
  },
  {
    id: "flashcards",
    defaultEnabled: true,
    load: () => import("@noteriv/plugins/flashcards"),
  },
  {
    id: "calendar",
    defaultEnabled: true,
    load: () => import("@noteriv/plugins/calendar"),
  },
  {
    id: "templates",
    defaultEnabled: true,
    load: () => import("@noteriv/plugins/templates"),
  },
  {
    id: "note-composer",
    load: () => import("@noteriv/plugins/note-composer"),
  },
  {
    id: "vault-insights",
    load: () => import("@noteriv/plugins/vault-insights"),
  },
  {
    id: "markdown-lint",
    load: () => import("@noteriv/plugins/markdown-lint"),
  },
  {
    id: "audio-recorder",
    load: () => import("@noteriv/plugins/audio-recorder"),
  },
  {
    id: "graph",
    defaultEnabled: true,
    load: () => import("@noteriv/plugins/graph"),
  },
  {
    id: "slides",
    load: () => import("@noteriv/plugins/slides"),
  },
  {
    id: "note-history",
    defaultEnabled: true,
    load: () => import("@noteriv/plugins/note-history"),
  },
  {
    id: "board",
    load: () => import("@noteriv/plugins/board"),
  },
  {
    id: "mermaid",
    defaultEnabled: true,
    load: () => import("@noteriv/plugins/mermaid"),
  },
  {
    id: "chessboard",
    load: () => import("@noteriv/plugins/chessboard"),
  },
  {
    id: "dataview",
    load: () => import("@noteriv/plugins/dataview"),
  },
  {
    id: "views",
    load: () => import("@noteriv/plugins/views"),
  },
  {
    id: "footnotes",
    load: () => import("@noteriv/plugins/footnotes"),
  },
  {
    id: "unique-note",
    load: () => import("@noteriv/plugins/unique-note"),
  },
  {
    id: "canvas",
    load: () => import("@noteriv/plugins/canvas"),
  },
  {
    id: "drawing",
    load: () => import("@noteriv/plugins/drawing"),
  },
  {
    id: "pdf-viewer",
    defaultEnabled: true,
    load: () => import("@noteriv/plugins/pdf-viewer"),
  },
];

/** Vault settings key holding each core plugin's own settings blob. On/off lives under `corePlugins`. */
const SETTINGS_KEY = "corePluginSettings";

type SettingsBlobs = Record<string, Record<string, unknown>>;

/** Host config for one vault: state and plugin settings live in the vault's settings (DB) via the adapter. */
export function webCorePluginConfig(adapter: VaultAdapter): CorePluginHostConfig {
  return {
    adapter,
    platform: "web",
    vaultPath: null,
    plugins: CORE_PLUGINS,
    storage: {
      stateStore: settingsKeyStateStore(
        () => adapter.getSettings(),
        (s) => adapter.saveSettings(s)
      ),
      async loadPluginSettings(id) {
        const settings = await adapter.getSettings();
        const own = (settings[SETTINGS_KEY] as SettingsBlobs | undefined)?.[id];
        // Bridge for data from before flashcards became a plugin (phase 2.2): until the plugin has saved once, hand
        // it the old `flashcardReviews` key to import. The old key is never written again and stays as a backup.
        if (!own && id === "flashcards" && settings.flashcardReviews) return { legacyReviews: settings.flashcardReviews };
        return own ?? {};
      },
      async savePluginSettings(id, data) {
        const current = await adapter.getSettings();
        const all = (current[SETTINGS_KEY] as SettingsBlobs | undefined) ?? {};
        await adapter.saveSettings({ ...current, [SETTINGS_KEY]: { ...all, [id]: data } });
      },
    },
  };
}
