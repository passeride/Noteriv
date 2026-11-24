import { randomBytes } from "node:crypto";
import type { EmailToken, EmailTokenPurpose, PrismaClient } from "@prisma/client";
import { hashToken } from "./tokenHash.js";
import { toEmailLocale, type EmailLocale } from "./email/templates.js";

const HOUR_MS = 60 * 60 * 1000;

export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  verify_email: 24 * HOUR_MS,
  change_email: 24 * HOUR_MS,
  reset_password: 1 * HOUR_MS,
};

/** At most one email of each kind per user in this window, whoever asks (a form can be submitted for anyone's address). */
export const EMAIL_RESEND_COOLDOWN_MS = 60_000;

/**
 * Creates a one-time link token. Returns null inside the cooldown, so callers send nothing. A new token makes the
 * user's earlier unused ones of the same purpose expire: only the newest link works.
 */
export async function issueEmailToken(
  prisma: PrismaClient,
  userId: string,
  purpose: EmailTokenPurpose,
  newEmail?: string
): Promise<string | null> {
  const now = new Date();
  const recent = await prisma.emailToken.findFirst({
    where: { userId, purpose, createdAt: { gt: new Date(now.getTime() - EMAIL_RESEND_COOLDOWN_MS) } },
    select: { id: true },
  });
  if (recent) return null;

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.emailToken.updateMany({ where: { userId, purpose, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } }),
    prisma.emailToken.create({
      data: { userId, purpose, tokenHash: hashToken(token), newEmail: newEmail ?? null, expiresAt: new Date(now.getTime() + EMAIL_TOKEN_TTL_MS[purpose]) },
    }),
  ]);
  return token;
}

/**
 * Uses up a token of one of `purposes`. One conditional UPDATE both checks and spends it, so two clicks racing on
 * the same link cannot both succeed. Null for unknown, used, expired or wrong-purpose tokens alike.
 */
export async function consumeEmailToken(prisma: PrismaClient, token: string, purposes: EmailTokenPurpose[]): Promise<EmailToken | null> {
  if (!token) return null;
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || !purposes.includes(row.purpose)) return null;
  const now = new Date();
  const spent = await prisma.emailToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  return spent.count === 1 ? { ...row, usedAt: now } : null;
}

/** Language of an email: what the page asked for, else the account's interface language, else English. */
export async function emailLocaleFor(prisma: PrismaClient, userId: string, requested?: unknown): Promise<EmailLocale> {
  const asked = toEmailLocale(requested);
  if (asked) return asked;
  const pref = await prisma.userPreference.findUnique({ where: { userId }, select: { editorSettings: true } });
  const language = (pref?.editorSettings as { language?: unknown } | null)?.language;
  return toEmailLocale(language) ?? "en";
}
