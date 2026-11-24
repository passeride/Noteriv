import { randomInt } from "node:crypto";
import { z } from "zod";

/**
 * Bump when Terms or Privacy change in a way users must re-accept; stored per user at registration and when they
 * accept again (POST /users/me/terms). Keep in step with web/src/lib/legal.ts.
 */
export const TERMS_VERSION = "2026-10-20";

export type RegistrationMode = "invite" | "open" | "closed";

/**
 * Read on every request (not cached) so flipping the env in Dokploy takes effect on redeploy
 * without code changes. Anything unrecognised means closed: a typo must never open signups.
 */
export function registrationMode(): RegistrationMode {
  const raw = (process.env.REGISTRATION_MODE ?? "invite").trim().toLowerCase();
  if (raw === "invite" || raw === "open" || raw === "closed") return raw;
  return "closed";
}

/** ADMIN_EMAILS is a comma-separated allow-list; an empty or missing value means nobody is admin. */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}

/**
 * Admin = the admin role in the database (given and taken on /admin) OR an email in ADMIN_EMAILS. The env list is how
 * the first admin exists and cannot be undone from the page, so the operator can never lock themselves out.
 */
export function isAdmin(user: { role: string; email: string; emailVerifiedAt?: Date | null }): boolean {
  if (user.role === "admin") return true;
  if (isAdminEmail(user.email)) {
    return user.emailVerifiedAt != null;
  }
  return false;
}

// No 0/O/1/I/L: codes get read out loud and typed from screenshots.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 10 characters from a 31-letter alphabet is about 49 bits; randomInt is uniform (no modulo bias). */
export function generateInviteCode(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/**
 * Emails are stored and matched in lower case (since session 5.2), so "Ana@x.com" and "ana@x.com" are one account.
 * Every schema that takes an email address uses this.
 */
export const emailField = z.string().trim().toLowerCase().pipe(z.string().email());

/** Codes are typed by hand, so tolerate case, spaces and dashes. */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}
