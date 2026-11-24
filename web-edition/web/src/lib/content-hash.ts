/**
 * SHA-256 (hex) of a note's text, UTF-8 — the same value as the server's contentHash (web/server/src/lib/contentHash.ts).
 * Null where Web Crypto is unavailable (an insecure origin): the save then goes without a version check.
 */
export async function contentHash(content: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
