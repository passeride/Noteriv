import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from "../lib/jwt.js";
import { hashToken } from "../lib/tokenHash.js";
import { randomUUID } from "node:crypto";
import { logAudit } from "../lib/auditLog.js";
import { Prisma } from "@prisma/client";
import { emailField, isAdmin, normalizeInviteCode, registrationMode, TERMS_VERSION } from "../lib/registration.js";
import { emailEnabled } from "../lib/email/send.js";
import { turnstileEnabled, turnstileSiteKey, verifyTurnstile } from "../lib/turnstile.js";
import { recordActivity } from "../lib/activity.js";
import { consumeEmailToken } from "../lib/emailTokens.js";
import { sendEmailChangedNotice, sendPasswordResetEmail, sendVerificationEmail } from "../lib/accountEmails.js";

/** Language of the emails a request triggers: the page's interface language. */
const localeField = z.enum(["en", "vi"]).optional();

const registerSchema = z.object({
  email: emailField,
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(100),
  inviteCode: z.string().max(64).optional(),
  // The client must send an explicit `true`: agreeing to the Terms is not something to default.
  acceptTerms: z.literal(true),
  locale: localeField,
  captchaToken: z.string().max(4096).optional(),
});

const forgotPasswordSchema = z.object({ email: emailField, locale: localeField, captchaToken: z.string().max(4096).optional() });
const tokenField = z.string().min(1).max(200);
const resetPasswordSchema = z.object({ token: tokenField, password: z.string().min(8).max(200) });
const verifyEmailSchema = z.object({ token: tokenField });

/** Thrown inside the register transaction so a rejected invite rolls the whole signup back. */
class InviteRejected extends Error {}

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1),
});

const ACCESS_COOKIE = "noteriv_access";
const REFRESH_COOKIE = "noteriv_refresh";

function cookieOpts(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

interface FailedLoginTracker {
  count: number;
  lastAttemptAt: number;
  lockedUntil: number;
}
const failedLogins = new Map<string, FailedLoginTracker>();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const MAX_TRACKED_EMAILS = 10_000;

function pruneExpiredLogins(now = Date.now()): void {
  for (const [email, entry] of failedLogins.entries()) {
    if (now - entry.lastAttemptAt > ATTEMPT_WINDOW_MS && entry.lockedUntil <= now) {
      failedLogins.delete(email);
    }
  }
}

// Periodic cleanup; unref so timer does not prevent process exit during tests
setInterval(() => pruneExpiredLogins(), ATTEMPT_WINDOW_MS).unref();

export function checkLoginAttempts(email: string): { allowed: boolean; retryAfterSeconds?: number } {
  const norm = email.trim().toLowerCase();
  const entry = failedLogins.get(norm);
  if (!entry) return { allowed: true };
  const now = Date.now();
  if (entry.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
  }
  return { allowed: true };
}

export function recordFailedLogin(email: string): void {
  const norm = email.trim().toLowerCase();
  const now = Date.now();
  const entry = failedLogins.get(norm);
  if (!entry || (now - entry.lastAttemptAt > ATTEMPT_WINDOW_MS && entry.lockedUntil <= now)) {
    if (failedLogins.size >= MAX_TRACKED_EMAILS) {
      pruneExpiredLogins(now);
      if (failedLogins.size >= MAX_TRACKED_EMAILS) {
        const firstKey = failedLogins.keys().next().value;
        if (firstKey) failedLogins.delete(firstKey);
      }
    }
    failedLogins.set(norm, { count: 1, lastAttemptAt: now, lockedUntil: 0 });
    return;
  }
  entry.count += 1;
  entry.lastAttemptAt = now;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    // 5 consecutive failed attempts within 15 minutes: lock account login for 15 minutes
    entry.lockedUntil = now + ATTEMPT_WINDOW_MS;
  }
}

export function resetFailedLogins(email: string): void {
  failedLogins.delete(email.trim().toLowerCase());
}

export default async function authRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;

  async function issueSession(reply: FastifyReply, userId: string, email: string) {
    const accessToken = signAccessToken({ sub: userId, email });

    const tokenId = randomUUID();
    const refreshToken = signRefreshToken({ sub: userId, tokenId });
    await prisma.refreshToken.create({
      data: {
        id: tokenId,
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      },
    });

    reply.setCookie(ACCESS_COOKIE, accessToken, cookieOpts(ACCESS_TOKEN_TTL_SECONDS));
    reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOpts(REFRESH_TOKEN_TTL_SECONDS));
    // Sign-up, sign-in and every refresh pass here, so this is the "used the app today" mark for the usage stats.
    await recordActivity(prisma, userId, fastify.log);
  }

  const bruteForceGuard = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  fastify.post("/register", bruteForceGuard, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    const { email, password, displayName, inviteCode } = parsed.data;

    const mode = registrationMode();
    if (mode === "closed") {
      return reply.code(403).send({ error: "registration_closed" });
    }
    // Before anything that reads the database, so a bot learns nothing (not even "email taken") without passing it.
    if (turnstileEnabled() && !(await verifyTurnstile(parsed.data.captchaToken, request.ip))) {
      return reply.code(400).send({ error: "captcha_failed" });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: "email_taken" });
    }

    const passwordHash = await hashPassword(password);

    let inviteCodeId: string | null = null;
    let user;
    try {
      user = await prisma.$transaction(async (tx) => {
        if (mode === "invite") {
          // One atomic UPDATE both checks and consumes the code, so two signups racing for the last
          // use cannot both win. Any failure below (e.g. email taken) rolls the increment back too.
          const code = normalizeInviteCode(inviteCode ?? "");
          const now = new Date();
          const consumed = code
            ? await tx.inviteCode.updateMany({
                where: {
                  code,
                  revokedAt: null,
                  AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }, { usedCount: { lt: tx.inviteCode.fields.maxUses } }],
                },
                data: { usedCount: { increment: 1 } },
              })
            : { count: 0 };
          if (consumed.count !== 1) throw new InviteRejected();
          inviteCodeId = (await tx.inviteCode.findUniqueOrThrow({ where: { code }, select: { id: true } })).id;
        }
        const created = await tx.user.create({
          data: { email, passwordHash, displayName, inviteCodeId, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION },
        });
        const workspace = await tx.workspace.create({
          data: { name: `${displayName}'s workspace`, ownerId: created.id },
        });
        await tx.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: created.id, role: "owner" },
        });
        return created;
      });
    } catch (err) {
      if (err instanceof InviteRejected) {
        // One generic answer for wrong / used up / expired / revoked, so codes cannot be probed.
        logAudit(prisma, { action: "register_rejected", metadata: { reason: "invalid_invite" }, ip: request.ip });
        return reply.code(403).send({ error: "invalid_invite" });
      }
      // Two signups with the same email can both pass the check above; the unique index decides.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw err;
    }

    await issueSession(reply, user.id, user.email);
    logAudit(prisma, { userId: user.id, action: "register", metadata: { inviteCodeId, termsVersion: TERMS_VERSION }, ip: request.ip });
    // Not awaited: the account exists either way, and the page can ask for the email again.
    void sendVerificationEmail(prisma, request.log, user, parsed.data.locale).then((result) => {
      if (result === "sent") logAudit(prisma, { userId: user.id, action: "email_verification_sent", ip: request.ip });
    });
    return reply.code(201).send({ id: user.id, email: user.email, displayName: user.displayName });
  });

  // Public: lets the register page decide whether to show the invite-code field and the bot check, and the sign-in
  // page whether "Forgot password?" can work.
  fastify.get("/registration", async (_request, reply) => {
    return reply.send({ mode: registrationMode(), emailEnabled: emailEnabled(), turnstileSiteKey: turnstileSiteKey() });
  });

  // Same answer whether or not the address has an account, and the email goes out in the background so the response
  // time does not tell either. Abuse is bounded by the IP limit here and the per-user cooldown in emailTokens.ts.
  fastify.post("/forgot-password", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    if (!emailEnabled()) return reply.code(503).send({ error: "email_disabled" });
    if (turnstileEnabled() && !(await verifyTurnstile(parsed.data.captchaToken, request.ip))) {
      return reply.code(400).send({ error: "captcha_failed" });
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (user) {
      void sendPasswordResetEmail(prisma, request.log, user, parsed.data.locale).then((result) => {
        if (result === "sent") logAudit(prisma, { userId: user.id, action: "password_reset_requested", ip: request.ip });
      });
    }
    return reply.send({ ok: true });
  });

  fastify.post("/reset-password", bruteForceGuard, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const row = await consumeEmailToken(prisma, parsed.data.token, ["reset_password"]);
    if (!row) return reply.code(400).send({ error: "invalid_token" });

    const passwordHash = await hashPassword(parsed.data.password);
    const now = new Date();
    const [, revoked] = await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
      prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } }),
      // Following the link proved the user reads this inbox, so the address counts as verified too.
      prisma.user.updateMany({ where: { id: row.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } }),
    ]);
    logAudit(prisma, { userId: row.userId, action: "password_reset", metadata: { sessionsRevoked: revoked.count }, ip: request.ip });
    // Whoever is signed in on this browser signs in again with the new password, like every other device.
    reply.clearCookie(ACCESS_COOKIE, { path: "/" });
    reply.clearCookie(REFRESH_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });

  // One endpoint for both links that prove an address: the sign-up verification and the confirmation of a new email.
  fastify.post("/verify-email", bruteForceGuard, async (request, reply) => {
    const parsed = verifyEmailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const row = await consumeEmailToken(prisma, parsed.data.token, ["verify_email", "change_email"]);
    if (!row) return reply.code(400).send({ error: "invalid_token" });

    if (row.purpose === "verify_email") {
      await prisma.user.updateMany({ where: { id: row.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
      logAudit(prisma, { userId: row.userId, action: "email_verified", ip: request.ip });
      return reply.send({ ok: true, purpose: "verify_email" });
    }

    const before = await prisma.user.findUnique({ where: { id: row.userId } });
    if (!before || !row.newEmail) return reply.code(400).send({ error: "invalid_token" });
    const now = new Date();
    let user;
    try {
      [user] = await prisma.$transaction([
        prisma.user.update({ where: { id: row.userId }, data: { email: row.newEmail, emailVerifiedAt: now } }),
        // The account's sign-in name changed: every session starts over with it.
        prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: now } }),
        // A verification link still out for the old address must not count for the new one.
        prisma.emailToken.updateMany({ where: { userId: row.userId, usedAt: null, purpose: "verify_email" }, data: { expiresAt: now } }),
      ]);
    } catch (err) {
      // Someone registered or switched to that address between the request and the click.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw err;
    }
    logAudit(prisma, { userId: user.id, action: "email_changed", ip: request.ip });
    void sendEmailChangedNotice(prisma, request.log, user, before.email);
    reply.clearCookie(ACCESS_COOKIE, { path: "/" });
    reply.clearCookie(REFRESH_COOKIE, { path: "/" });
    return reply.send({ ok: true, purpose: "change_email" });
  });

  fastify.post("/login", bruteForceGuard, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const { email, password } = parsed.data;

    const rateCheck = checkLoginAttempts(email);
    if (!rateCheck.allowed) {
      return reply.code(429).send({ error: "too_many_attempts", retryAfter: rateCheck.retryAfterSeconds });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      recordFailedLogin(email);
      logAudit(prisma, { action: "login_failed", metadata: { email }, ip: request.ip });
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    // Said only after the right password, so the lock does not tell strangers the address has an account.
    if (user.lockedAt) {
      logAudit(prisma, { userId: user.id, action: "login_refused_locked", ip: request.ip });
      return reply.code(403).send({ error: "account_locked" });
    }

    resetFailedLogins(email);
    await issueSession(reply, user.id, user.email);
    logAudit(prisma, { userId: user.id, action: "login", ip: request.ip });
    return reply.send({ id: user.id, email: user.email, displayName: user.displayName });
  });

  fastify.post("/refresh", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const stored = await prisma.refreshToken.findUnique({ where: { id: payload.tokenId } });
    if (!stored) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    // Reuse detection (RFC 6819): if a token that was already revoked is presented again,
    // it suggests the token was stolen. Revoke ALL active tokens for this user immediately.
    if (stored.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      logAudit(prisma, {
        userId: stored.userId,
        action: "refresh_token_reuse_detected",
        metadata: { tokenId: stored.id },
        ip: request.ip,
      });
      request.log.warn({ userId: stored.userId, tokenId: stored.id }, "Refresh token reuse detected; revoked all active tokens for user");
      return reply.code(401).send({ error: "unauthorized" });
    }

    if (stored.expiresAt < new Date() || stored.tokenHash !== hashToken(token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    if (user.lockedAt) {
      return reply.code(401).send({ error: "account_locked" });
    }

    // Atomic rotation: revoke old, issue new. If rotation count is not 1, race condition / reused.
    const rotation = await prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (rotation.count !== 1) {
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      logAudit(prisma, {
        userId: stored.userId,
        action: "refresh_token_race_detected",
        metadata: { tokenId: stored.id },
        ip: request.ip,
      });
      return reply.code(401).send({ error: "unauthorized" });
    }

    await issueSession(reply, user.id, user.email);
    return reply.send({ ok: true });
  });

  fastify.post("/logout", async (request, reply) => {
    const token = request.cookies[REFRESH_COOKIE];
    if (token) {
      try {
        const payload = verifyRefreshToken(token);
        await prisma.refreshToken.update({
          where: { id: payload.tokenId },
          data: { revokedAt: new Date() },
        }).catch(() => undefined);
        logAudit(prisma, { userId: payload.sub, action: "logout", ip: request.ip });
      } catch {
        // ignore invalid token on logout
      }
    }
    reply.clearCookie(ACCESS_COOKIE, { path: "/" });
    reply.clearCookie(REFRESH_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });

  fastify.get("/me", { preHandler: fastify.authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.send({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerifiedAt !== null,
      isAdmin: isAdmin(user),
      // False until the account accepted the current Terms and Privacy Policy: the app then asks (TermsGate).
      termsAccepted: user.termsVersion === TERMS_VERSION,
    });
  });
}
