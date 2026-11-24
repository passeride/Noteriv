import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Encrypted storage format for secrets such as LLM API keys.
 *
 * Stored value: "enc:<fernet token>". Fernet (https://github.com/fernet/spec) is AES-128-CBC + HMAC-SHA256;
 * Node has no built-in Fernet, so it is implemented here on node:crypto and is interoperable with the spec.
 *
 * "plain:<text>" is accepted by decrypt() OUTSIDE production only, so a developer can hand-edit a row.
 * encrypt() never produces it: a missing key is an error (or, in dev, a generated .secret_key), never a downgrade.
 */

export const ENC_PREFIX = "enc:";
export const PLAIN_PREFIX = "plain:";

const FERNET_VERSION = 0x80;
const SECRET_FILE_NAME = ".secret_key";

function b64urlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function splitKey(key: string): { signingKey: Buffer; encryptionKey: Buffer } {
  const raw = b64urlDecode(key);
  if (raw.length !== 32) throw new Error("Fernet key must be 32 bytes, url-safe base64 encoded");
  return { signingKey: raw.subarray(0, 16), encryptionKey: raw.subarray(16) };
}

/** Turns any secret (ENCRYPTION_KEY passphrase, file contents) into a Fernet key, domain-separated from other uses. */
export function deriveFernetKey(secret: string): string {
  return b64urlEncode(createHash("sha256").update(`noteriv-credentials-vault:v1:${secret}`).digest());
}

/** A fresh random Fernet key (url-safe base64, 32 bytes). */
export function generateFernetKey(): string {
  return b64urlEncode(randomBytes(32));
}

/** Encrypts `plaintext` with a Fernet `key`; returns "enc:<token>". */
export function encrypt(key: string, plaintext: string): string {
  const { signingKey, encryptionKey } = splitKey(key);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-128-cbc", encryptionKey, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000)));
  const signed = Buffer.concat([Buffer.from([FERNET_VERSION]), timestamp, iv, body]);
  const hmac = createHmac("sha256", signingKey).update(signed).digest();
  return ENC_PREFIX + b64urlEncode(Buffer.concat([signed, hmac]));
}

/** Reverses encrypt(). Throws on a wrong key, a tampered token or an unknown format. */
export function decrypt(key: string, ciphertext: string): string {
  if (ciphertext.startsWith(PLAIN_PREFIX)) {
    if (process.env.NODE_ENV === "production") throw new Error("plain: credentials are refused in production");
    return ciphertext.slice(PLAIN_PREFIX.length);
  }
  if (!ciphertext.startsWith(ENC_PREFIX)) throw new Error("Unknown credential format (expected enc: prefix)");

  const { signingKey, encryptionKey } = splitKey(key);
  const token = b64urlDecode(ciphertext.slice(ENC_PREFIX.length));
  // version(1) + timestamp(8) + iv(16) + at least one block(16) + hmac(32)
  if (token.length < 73 || (token.length - 57) % 16 !== 0 || token[0] !== FERNET_VERSION) {
    throw new Error("Invalid credential token");
  }
  const signed = token.subarray(0, token.length - 32);
  const expected = createHmac("sha256", signingKey).update(signed).digest();
  if (!timingSafeEqual(expected, token.subarray(token.length - 32))) {
    throw new Error("Credential token failed verification (wrong key or tampered)");
  }
  const decipher = createDecipheriv("aes-128-cbc", encryptionKey, signed.subarray(9, 25));
  return Buffer.concat([decipher.update(signed.subarray(25)), decipher.final()]).toString("utf8");
}

let cachedKey: string | null = null;

/**
 * The vault key: ENCRYPTION_KEY if set; otherwise (not in production) a random secret persisted in
 * `.secret_key` in the server's working directory, created on first use with mode 0600 and git-ignored.
 * In production a missing ENCRYPTION_KEY is a hard error so a restart can never silently switch keys.
 */
export function getVaultKey(): string {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.ENCRYPTION_KEY;
  if (fromEnv) return (cachedKey = deriveFernetKey(fromEnv));
  if (process.env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY env var is required to store LLM API keys");
  }
  const file = path.resolve(process.env.SECRET_KEY_FILE ?? SECRET_FILE_NAME);
  let secret: string;
  try {
    secret = fs.readFileSync(file, "utf8").trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    secret = randomBytes(32).toString("hex");
    fs.writeFileSync(file, secret + "\n", { mode: 0o600, flag: "wx" });
  }
  if (!secret) throw new Error(`${file} is empty; delete it to generate a new key`);
  return (cachedKey = deriveFernetKey(secret));
}

/** Test hook: forget the cached key so the next getVaultKey() re-reads the environment. */
export function resetVaultKeyCache(): void {
  cachedKey = null;
}

export const encryptSecret = (plaintext: string): string => encrypt(getVaultKey(), plaintext);
export const decryptSecret = (ciphertext: string): string => decrypt(getVaultKey(), ciphertext);
