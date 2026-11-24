import type { PluginEvent, PluginPermission } from "@noteriv/plugin-api";

export type { PluginPermission };

/**
 * One installed community plugin, as the sandbox host needs it. `id` is the install id the app uses (web: DB row id;
 * desktop: plugin folder name) and is what the `pluginDbId` fields below refer to.
 */
export interface SandboxPluginRecord {
  id: string;
  /** Manifest id, used to namespace code-block processors. */
  pluginId: string;
  enabled: boolean;
  /** What the user granted. Default-deny: anything else is refused at run time. */
  permissions: PluginPermission[];
  mainJs: string;
  settings: Record<string, unknown>;
}

export interface PluginCommandRef {
  pluginDbId: string;
  pluginId: string;
  id: string;
  name: string;
  icon?: string;
}

export interface PluginStatusItem {
  pluginDbId: string;
  pluginId: string;
  id: string;
  text: string;
  title?: string;
  clickable: boolean;
}

/** Everything a plugin may read synchronously via api.editor.* / api.app.currentFile. */
export interface EditorSnapshot {
  content: string | null;
  selection: string;
  cursor: { line: number; ch: number };
  currentFile: string | null;
}

/** App events forwarded into the sandbox (the v0 set; plugin-loaded/unloaded stay inside the host). */
export type PluginEventName = Exclude<PluginEvent, "plugin-loaded" | "plugin-unloaded">;

/** A sidebar panel or settings tab a plugin registered; `html`/`css` is the sandbox's latest serialised render. */
export interface PluginPanelRef {
  pluginDbId: string;
  pluginId: string;
  kind: "sidebar" | "settings";
  id: string;
  title: string;
  icon?: string;
  html: string;
  css: string;
}

export interface PluginNotice {
  key: string;
  message: string;
}

/** What the page must provide so plugins' `api.editor.*` calls have something real to act on. */
export interface EditorBridge {
  getContent: () => string | null;
  setContent: (content: string) => void;
  insertAtCursor: (text: string) => void;
  getSelection: () => string;
  replaceSelection: (text: string) => void;
}
