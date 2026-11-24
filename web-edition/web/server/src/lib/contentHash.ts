import { createHash } from "node:crypto";

/**
 * SHA-256 (hex) of a note's text, UTF-8. A client sends the hash of the text its edit started from (`baseHash`), so
 * the server can tell whether the note changed in between. The web client computes the same with crypto.subtle
 * (web/src/lib/content-hash.ts).
 */
export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
