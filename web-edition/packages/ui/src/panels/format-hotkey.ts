/** Shortcut text for display: on macOS Ctrl/Shift/Alt become the ⌘ ⇧ ⌥ symbols. */
export function formatHotkey(keys: string, platform: string): string {
  if (!keys) return "";
  if (platform === "darwin") {
    return keys
      .replace(/Ctrl/g, "⌘")
      .replace(/Shift/g, "⇧")
      .replace(/Alt/g, "⌥")
      .replace(/\+/g, "");
  }
  return keys;
}
