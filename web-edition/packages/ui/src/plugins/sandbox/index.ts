// Community-plugin tier of Plugin API v1: sandboxed iframes, RPC over postMessage, default-deny permissions.
export { useSandboxPluginHost, type SandboxPluginHost, type SandboxPluginHostOptions, type SandboxHostLabels } from "./use-sandbox-plugin-host";
export { default as PluginMirror } from "./PluginMirror";
export { mountMirror, sanitizeCss, type MirrorEvent, type MirrorPayload } from "./mirror";
export type {
  SandboxPluginRecord,
  PluginCommandRef,
  PluginStatusItem,
  PluginPanelRef,
  PluginNotice,
  PluginEventName,
  PluginPermission,
  EditorBridge,
  EditorSnapshot,
} from "./types";
