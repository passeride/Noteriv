// Naming rules for Quick note, shared by the web app's /quick page (through the server) and the Android app.
// The server keeps its own copy in web/server/src/lib/quickNoteName.ts (its image cannot read packages/); the two
// must stay the same, and the test below checks this copy against the server's.

const MAX_NAME = 60;
const FORBIDDEN = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g;

/**
 * The note's name, without ".md": its first non-empty line with Markdown heading and list markers removed and
 * characters that cannot be in a file name (or would break a [[link]]) replaced, cut to 60 characters on a word
 * boundary when possible. An empty or unusable first line gives `fallback`.
 */
export function quickNoteName(content: string, fallback: string): string {
  const first = content.split(/\r?\n/).find((line) => line.trim()) ?? "";
  const cleaned = first
    .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s*|\d+[.)]\s+)/, "")
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  if (!cleaned) return fallback.replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim() || "Quick note";
  // Counted and cut by character, not UTF-16 unit: a cut through an emoji leaves half a surrogate pair, which
  // cannot be URL-encoded or written as a file name.
  const chars = Array.from(cleaned);
  if (chars.length <= MAX_NAME) return cleaned;
  const cut = chars.slice(0, MAX_NAME).join("");
  const space = cut.lastIndexOf(" ");
  return (space > MAX_NAME / 2 ? cut.slice(0, space) : cut).trim();
}

/**
 * The folder path a quick note goes into, normalised ("Inbox", "Inbox/Phone"); null when it is not a plain
 * vault-relative folder path.
 */
export function quickNoteFolder(folder: string | undefined): string | null {
  const raw = (folder ?? "Inbox").replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
  if (!raw) return "";
  const parts = raw.split("/").map((p) => p.trim());
  if (parts.some((p) => !p || p === "." || p === ".." || p.length > 120 || /[:*?"<>|\u0000-\u001f]/.test(p))) return null;
  return parts.join("/");
}
