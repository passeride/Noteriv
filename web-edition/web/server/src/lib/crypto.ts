import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

// Derive a 32-byte key from the configured secret so operators can set a
// plain passphrase in ENCRYPTION_KEY rather than needing a hex-encoded key.
const KEY = createHash("sha256").update(process.env.ENCRYPTION_KEY ?? "").digest();

if (!process.env.ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY env var is required to store sync credentials");
}

const ALGO = "aes-256-gcm";

/**
 * Encrypts a JSON-serializable value. Output layout: iv(12) | authTag(16) | ciphertext.
 * Returns a plain ArrayBuffer-backed Uint8Array (not Node's Buffer subclass) because
 * that's what Prisma's generated `Bytes` field type expects for `@db.Bytea` columns.
 */
export function encryptJson(value: unknown): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, ciphertext]);
  // Buffer.concat's backing ArrayBuffer is always a plain ArrayBuffer (never
  // SharedArrayBuffer) — the explicit copy just satisfies Prisma's stricter
  // `Uint8Array<ArrayBuffer>` generated type for its Bytes field.
  const out = new Uint8Array(combined.byteLength) as Uint8Array<ArrayBuffer>;
  out.set(combined);
  return out;
}

export function decryptJson<T = unknown>(blob: Uint8Array): T {
  const buf = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
