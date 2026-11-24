/**
 * Plugin command accelerators such as `Mod+Alt+W`. `Mod` is Ctrl on Windows/Linux and Cmd on macOS; `Ctrl`, `Cmd`
 * (`Meta`), `Alt` (`Option`) and `Shift` may be named explicitly. The last part is the key.
 */

interface ParsedHotkey {
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export function parseHotkey(accel: string, isMac: boolean): ParsedHotkey | null {
  const parts = accel.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const out: ParsedHotkey = { ctrl: false, meta: false, alt: false, shift: false, key: key.toLowerCase() };
  for (const p of parts.map((x) => x.toLowerCase())) {
    if (p === "mod") out[isMac ? "meta" : "ctrl"] = true;
    else if (p === "ctrl" || p === "control") out.ctrl = true;
    else if (p === "cmd" || p === "meta") out.meta = true;
    else if (p === "alt" || p === "option") out.alt = true;
    else if (p === "shift") out.shift = true;
    else return null;
  }
  return out;
}

/** Physical key name: letters and digits come from `code`, because Alt/Option changes `key` on macOS. */
function eventKey(e: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  return e.key.toLowerCase();
}

export function matchesHotkey(e: KeyboardEvent, accel: string, isMac: boolean): boolean {
  const h = parseHotkey(accel, isMac);
  if (!h) return false;
  return (
    e.ctrlKey === h.ctrl && e.metaKey === h.meta && e.altKey === h.alt && e.shiftKey === h.shift && eventKey(e) === h.key
  );
}

export function isMacPlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}
