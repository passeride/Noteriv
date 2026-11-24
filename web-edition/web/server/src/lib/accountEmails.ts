import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { appOrigin, emailEnabled, sendEmail } from "./email/send.js";
import { confirmNewEmailMessage, emailChangedNotice, resetPasswordMessage, verifyEmailMessage } from "./email/templates.js";
import { emailLocaleFor, issueEmailToken } from "./emailTokens.js";

export type SendResult = "sent" | "throttled" | "disabled" | "failed";

interface Recipient {
  id: string;
  email: string;
  displayName: string;
}

// The token goes after "#": browsers never send the fragment, so it stays out of proxy logs, Referer headers and the
// service worker's page cache. The pages read it from location.hash.
const link = (page: string, token: string) => `${appOrigin()}/${page}#token=${token}`;

async function deliver(log: FastifyBaseLogger, kind: string, run: () => Promise<void>): Promise<SendResult> {
  try {
    await run();
    return "sent";
  } catch (err) {
    log.error({ kind, err: err instanceof Error ? err.message : String(err) }, "email not sent");
    return "failed";
  }
}

export async function sendVerificationEmail(prisma: PrismaClient, log: FastifyBaseLogger, user: Recipient, locale?: unknown): Promise<SendResult> {
  if (!emailEnabled()) return "disabled";
  const token = await issueEmailToken(prisma, user.id, "verify_email");
  if (!token) return "throttled";
  const message = verifyEmailMessage(await emailLocaleFor(prisma, user.id, locale), user.displayName, link("verify-email", token));
  return deliver(log, "verify_email", () => sendEmail({ to: user.email, ...message }));
}

export async function sendPasswordResetEmail(prisma: PrismaClient, log: FastifyBaseLogger, user: Recipient, locale?: unknown): Promise<SendResult> {
  if (!emailEnabled()) return "disabled";
  const token = await issueEmailToken(prisma, user.id, "reset_password");
  if (!token) return "throttled";
  const message = resetPasswordMessage(await emailLocaleFor(prisma, user.id, locale), user.displayName, link("reset-password", token));
  return deliver(log, "reset_password", () => sendEmail({ to: user.email, ...message }));
}

/** Goes to the NEW address: following the link proves the user owns it. */
export async function sendEmailChangeConfirmation(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
  user: Recipient,
  newEmail: string,
  locale?: unknown
): Promise<SendResult> {
  if (!emailEnabled()) return "disabled";
  const token = await issueEmailToken(prisma, user.id, "change_email", newEmail);
  if (!token) return "throttled";
  const message = confirmNewEmailMessage(await emailLocaleFor(prisma, user.id, locale), user.displayName, link("verify-email", token));
  return deliver(log, "change_email", () => sendEmail({ to: newEmail, ...message }));
}

/** Tells the OLD address that the change happened, so a hijacked account does not go unnoticed. */
export async function sendEmailChangedNotice(prisma: PrismaClient, log: FastifyBaseLogger, user: Recipient, oldEmail: string): Promise<SendResult> {
  if (!emailEnabled()) return "disabled";
  const message = emailChangedNotice(await emailLocaleFor(prisma, user.id), user.displayName, user.email);
  return deliver(log, "email_changed_notice", () => sendEmail({ to: oldEmail, ...message }));
}
