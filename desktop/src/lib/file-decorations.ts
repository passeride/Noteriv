import { isWindowsPath } from "./file-path";

export const DECORATIONS_FILE = ".noteriv-decorations.json";

export interface FileDecoration {
  symbol?: string;
  color?: string;
}

export function decorationKey(root: string, path: string): string | null {
  const windows = isWindowsPath(root);
  const normalize = (value: string) => (windows ? value.replace(/\\/g, "/") : value).replace(/\/+$/, "");
  const base = normalize(root) + "/";
  const full = normalize(path);
  if (!(windows ? full.toLowerCase().startsWith(base.toLowerCase()) : full.startsWith(base))) return null;
  return full.slice(base.length) || null;
}

export function parseDecorationFile(text: string | null): Record<string, unknown> {
  if (text === null) return {};
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("File decorations must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function fileDecoration(value: unknown): FileDecoration {
  const entry = value && typeof value === "object" ? value as { symbol?: unknown; ringColor?: unknown } : {};
  return {
    symbol: typeof entry.symbol === "string" && entry.symbol.trim() ? entry.symbol : undefined,
    // Android stores its icon tint in color. A row or tab ring is opt-in.
    color: typeof entry.ringColor === "string" && /^#[\da-f]{6}$/i.test(entry.ringColor) ? entry.ringColor : undefined,
  };
}

export function updateDecoration(entries: Record<string, unknown>, path: string, decoration: FileDecoration) {
  const previous = Object.hasOwn(entries, path) ? entries[path] : undefined;
  const entry = previous && typeof previous === "object" ? { ...previous } : {};
  return { ...entries, [path]: { ...entry, symbol: decoration.symbol, ringColor: decoration.color } };
}
