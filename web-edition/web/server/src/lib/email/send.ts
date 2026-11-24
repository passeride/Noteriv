import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type EmailProvider = "resend" | "file";

/**
 * EMAIL_PROVIDER picks how mail leaves: `resend` (the Resend HTTP API, RESEND_API_KEY) or `file` (one JSON file per
 * message in EMAIL_OUTBOX_DIR, for dev and the end-to-end tests). Unset or anything else: email is off, and the UI
 * hides what needs it. Read per call, like REGISTRATION_MODE, so the env is the only switch.
 */
export function emailProvider(): EmailProvider | null {
  const raw = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "resend") return process.env.RESEND_API_KEY ? "resend" : null;
  if (raw === "file") return "file";
  return null;
}

export const emailEnabled = (): boolean => emailProvider() !== null;

/** Base of the links in emails: the web app's public origin. */
export function appOrigin(): string {
  return (process.env.APP_ORIGIN ?? process.env.CORS_ORIGIN ?? "http://localhost:3457").replace(/\/+$/, "");
}

const DEFAULT_FROM = "Noteriv <no-reply@noteriv.dsc.edu.vn>";
const RESEND_TIMEOUT_MS = 10_000;

export function outboxDir(): string {
  return path.resolve(process.env.EMAIL_OUTBOX_DIR ?? ".email-outbox");
}

/**
 * Sends one message. Throws on failure; callers decide whether that matters to the request (it never changes what
 * forgot-password answers). Errors carry the provider's status, never the message body or the key.
 */
export async function sendEmail(message: OutgoingEmail): Promise<void> {
  const provider = emailProvider();
  if (!provider) throw new Error("email is not configured");
  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_FROM;

  if (provider === "file") {
    const dir = outboxDir();
    await mkdir(dir, { recursive: true });
    // Time first so a directory listing sorts oldest to newest.
    const name = `${Date.now()}-${randomUUID()}.json`;
    await writeFile(path.join(dir, name), JSON.stringify({ from, ...message, sentAt: new Date().toISOString() }, null, 2));
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Resend's error body names the problem (unverified domain, bad key) without echoing the message.
    const detail = await res.text().catch(() => "");
    throw new Error(`resend responded ${res.status}: ${detail.slice(0, 300)}`);
  }
}
