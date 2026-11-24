/**
 * Web's hotkey system — ported utility functions from
 * desktop/src/lib/hotkeys.ts (matchesHotkey/formatHotkey/eventToKeyString are
 * pure and copied near-verbatim), but with a *curated*, web-scoped action
 * list rather than desktop's full ~60-action set.
 *
 * Why curated rather than a 1:1 port: desktop/src/lib/hotkeys.ts lists
 * actions for features the web app doesn't have yet (Canvas, Drawing,
 * File Recovery, Note Composer, Audio Recorder, Trash, Vault Insights, ...
 * see docs/plans/2026-10-13-noteriv-web-full-parity.md Phase C/D). Listing
 * them here would put dead entries in the Command Palette and Shortcuts
 * settings tab — this list grows as each phase actually wires up the
 * corresponding feature, instead of pre-declaring actions that do nothing.
 */

export type HotkeyAction =
  | "save"
  | "newNote"
  | "closeTab"
  | "closeAllTabs"
  | "closeOtherTabs"
  | "togglePinTab"
  | "quickOpen"
  | "commandPalette"
  | "findInVault"
  | "toggleSidebar"
  | "toggleViewMode"
  | "settings"
  | "toggleOutline"
  | "toggleTags"
  | "toggleBacklinks"
  | "toggleOutgoingLinks"
  | "toggleProperties"
  | "toggleCollab"
  | "exportPDF"
  | "previewPDF"
  | "pluginManager"
  | "cssSnippets"
  | "gitSync"
  | "splitEditor"
  | "closeSplit"
  // Phase C additions (docs/plans/2026-10-13-noteriv-web-full-parity.md) —
  // formatting toggles ported from editor-commands.ts/FormattingToolbar.tsx
  // (previously only reachable by clicking the toolbar, not via hotkey or
  // Command Palette), plus the new Trash/Bookmarks/Templates/Note
  // Composer/Vault Insights features.
  | "toggleBold"
  | "toggleItalic"
  | "toggleStrikethrough"
  | "toggleCode"
  | "insertLink"
  | "insertImage"
  | "insertBlockquote"
  | "insertCodeBlock"
  | "insertTaskList"
  | "insertTable"
  | "insertHorizontalRule"
  | "toggleBookmark"
  | "openTrash"
  // Phase 1 discoverability (parity plan v2): entries that already existed as
  // ribbon/settings paths but had no palette/menu action.
  | "syncSettings"
  | "themePicker"
  | "importVault"
  | "exportVault"
  | "importNewVault"
  | "importFromApp"
  | "newVaultFromGithub"
  | "randomNote"
  | "zenMode"
  | "focusMode"
  | "reloadApp"
  | "diagnostics"
  | "devToolsHint"
  | "printNote";

export interface HotkeyBinding {
  action: HotkeyAction;
  label: string;
  keys: string; // e.g. "Ctrl+S", "Ctrl+Shift+F"
  category: string;
}

export const DEFAULT_HOTKEYS: HotkeyBinding[] = [
  { action: "save", label: "Save now", keys: "Ctrl+S", category: "File" },
  { action: "newNote", label: "New Note", keys: "Ctrl+N", category: "File" },
  { action: "closeTab", label: "Close Tab", keys: "Ctrl+W", category: "File" },
  { action: "closeAllTabs", label: "Close All Tabs", keys: "Ctrl+Shift+W", category: "File" },
  { action: "closeOtherTabs", label: "Close Other Tabs", keys: "", category: "File" },
  { action: "togglePinTab", label: "Pin/Unpin Tab", keys: "Ctrl+Shift+T", category: "File" },

  { action: "quickOpen", label: "Quick Open", keys: "Ctrl+K", category: "Navigation" },
  { action: "commandPalette", label: "Command Palette", keys: "Ctrl+Shift+P", category: "Navigation" },
  { action: "findInVault", label: "Find in Vault", keys: "Ctrl+Shift+F", category: "Search" },

  { action: "toggleSidebar", label: "Toggle Sidebar", keys: "Ctrl+B", category: "View" },
  { action: "toggleViewMode", label: "Cycle Edit/View/Source", keys: "Ctrl+E", category: "View" },
  { action: "settings", label: "Settings", keys: "Ctrl+,", category: "View" },
  { action: "toggleOutline", label: "Toggle Outline", keys: "Ctrl+Shift+O", category: "View" },
  { action: "toggleTags", label: "Toggle Tag Pane", keys: "", category: "View" },
  { action: "toggleBacklinks", label: "Toggle Backlinks", keys: "", category: "View" },
  { action: "toggleOutgoingLinks", label: "Toggle Outgoing links", keys: "", category: "View" },
  { action: "toggleProperties", label: "Toggle All properties", keys: "", category: "View" },
  { action: "toggleCollab", label: "Toggle Collaboration", keys: "", category: "View" },
  { action: "splitEditor", label: "Split Editor", keys: "Ctrl+\\", category: "View" },
  { action: "closeSplit", label: "Close Split", keys: "Ctrl+Shift+\\", category: "View" },

  { action: "previewPDF", label: "Preview PDF", keys: "", category: "File" },
  { action: "exportPDF", label: "Download PDF", keys: "", category: "File" },
  { action: "printNote", label: "Print… (the browser's print dialog)", keys: "", category: "File" },
  { action: "pluginManager", label: "Plugin Manager", keys: "", category: "Ecosystem" },
  { action: "cssSnippets", label: "CSS Snippets", keys: "", category: "Ecosystem" },
  { action: "gitSync", label: "Sync Now", keys: "Ctrl+Shift+G", category: "Sync" },
  { action: "syncSettings", label: "Sync Settings (Git / WebDAV)", keys: "", category: "Sync" },
  { action: "themePicker", label: "Themes", keys: "", category: "Ecosystem" },
  { action: "importVault", label: "Import folder / zip into this vault…", keys: "", category: "File" },
  { action: "importNewVault", label: "Import folder / zip as a new vault…", keys: "", category: "File" },
  { action: "importFromApp", label: "Import from Notion, Evernote, HTML…", keys: "", category: "File" },
  { action: "newVaultFromGithub", label: "New vault from GitHub repo…", keys: "", category: "File" },
  { action: "randomNote", label: "Open Random Note", keys: "", category: "Navigation" },
  { action: "zenMode", label: "Zen Mode (hide all chrome)", keys: "Ctrl+Shift+Z", category: "View" },
  { action: "focusMode", label: "Focus Mode (dim other lines)", keys: "", category: "View" },
  { action: "reloadApp", label: "Reload page (saves first)", keys: "", category: "Developer" },
  { action: "diagnostics", label: "Diagnostics (server, sync, plugins)…", keys: "", category: "Developer" },
  { action: "devToolsHint", label: "Open browser developer tools (F12)", keys: "", category: "Developer" },
  { action: "exportVault", label: "Export vault as zip", keys: "", category: "File" },

  { action: "toggleBold", label: "Bold", keys: "", category: "Formatting" },
  { action: "toggleItalic", label: "Italic", keys: "Ctrl+I", category: "Formatting" },
  { action: "toggleStrikethrough", label: "Strikethrough", keys: "", category: "Formatting" },
  { action: "toggleCode", label: "Inline Code", keys: "Ctrl+`", category: "Formatting" },
  { action: "insertLink", label: "Insert Link", keys: "", category: "Formatting" },
  { action: "insertImage", label: "Insert Image", keys: "", category: "Formatting" },
  { action: "insertBlockquote", label: "Blockquote", keys: "", category: "Formatting" },
  { action: "insertCodeBlock", label: "Code Block", keys: "", category: "Formatting" },
  { action: "insertTaskList", label: "Task List", keys: "", category: "Formatting" },
  { action: "insertTable", label: "Insert Table", keys: "", category: "Formatting" },
  { action: "insertHorizontalRule", label: "Horizontal Rule", keys: "", category: "Formatting" },

  { action: "toggleBookmark", label: "Toggle Bookmark", keys: "Ctrl+Shift+B", category: "File" },
  { action: "openTrash", label: "Open Trash", keys: "", category: "File" },
];

/** Parse a key combo string like "Ctrl+Shift+F" and check if a KeyboardEvent matches it. */
export function matchesHotkey(e: KeyboardEvent, keys: string): boolean {
  if (!keys) return false;
  const parts = keys.toLowerCase().split("+").map((p) => p.trim());
  const needCtrl = parts.includes("ctrl") || parts.includes("cmd");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");
  const key = parts.find((p) => p !== "ctrl" && p !== "cmd" && p !== "shift" && p !== "alt");
  if (!key) return false;

  const mod = e.metaKey || e.ctrlKey;
  if (needCtrl && !mod) return false;
  if (!needCtrl && mod) return false;
  if (needShift !== e.shiftKey) return false;
  if (needAlt !== e.altKey) return false;

  const eventKey = e.key.toLowerCase();
  if (key === "tab") return eventKey === "tab";
  if (key === ",") return eventKey === ",";
  return eventKey === key;
}

/** Format a key combo for display — replaces Ctrl with Cmd on macOS. */
export { formatHotkey } from "@noteriv/ui/panels/format-hotkey";

/** Convert a KeyboardEvent to a key combo string. Used when recording a new binding. */
export function eventToKeyString(e: KeyboardEvent): string | null {
  const key = e.key;
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  let keyName = key;
  if (key === " ") keyName = "Space";
  else if (key.length === 1) keyName = key.toUpperCase();
  else if (key === "ArrowUp") keyName = "Up";
  else if (key === "ArrowDown") keyName = "Down";
  else if (key === "ArrowLeft") keyName = "Left";
  else if (key === "ArrowRight") keyName = "Right";

  parts.push(keyName);
  return parts.join("+");
}

/** Merge a saved per-user override map (action -> keys) over the defaults. */
export function mergeHotkeys(overrides: Record<string, string>): HotkeyBinding[] {
  return DEFAULT_HOTKEYS.map((def) => ({ ...def, keys: overrides[def.action] ?? def.keys }));
}

/** Extract just the action->keys entries that differ from default, for persisting. */
export function hotkeysToOverrideMap(bindings: HotkeyBinding[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const b of bindings) {
    const def = DEFAULT_HOTKEYS.find((d) => d.action === b.action);
    if (def && b.keys !== def.keys) result[b.action] = b.keys;
  }
  return result;
}

export function detectPlatform(): string {
  if (typeof navigator === "undefined") return "web";
  return /Mac/.test(navigator.platform) ? "darwin" : "web";
}
