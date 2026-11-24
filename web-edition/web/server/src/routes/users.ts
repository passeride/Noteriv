import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { logAudit } from "../lib/auditLog.js";
import { deleteAccount } from "../lib/accounts.js";
import { verifyPassword } from "../lib/password.js";
import { emailField, TERMS_VERSION } from "../lib/registration.js";
import { limitsOf, planForUser, snapshotCap, usageFor } from "../lib/plans.js";
import { sendEmailChangeConfirmation, sendVerificationEmail, type SendResult } from "../lib/accountEmails.js";

const localeField = z.enum(["en", "vi"]).optional();
const resendVerificationSchema = z.object({ locale: localeField });
const changeEmailSchema = z.object({ newEmail: emailField, password: z.string().min(1), locale: localeField });
const acceptTermsSchema = z.object({ version: z.string().min(1).max(32) });
const deleteAccountSchema = z.object({ password: z.string().min(1) });

/** How a send that the user asked for directly is answered; "sent" is the only 200. */
function sendFailure(result: Exclude<SendResult, "sent">): { code: number; error: string } {
  if (result === "throttled") return { code: 429, error: "throttled" };
  if (result === "disabled") return { code: 503, error: "email_disabled" };
  return { code: 502, error: "email_failed" };
}

const ACCESS_COOKIE = "noteriv_access";
const REFRESH_COOKIE = "noteriv_refresh";

const preferencesSchema = z.object({
  hotkeys: z.record(z.string(), z.string()).optional(),
  editorSettings: z
    .object({
      editorFont: z.string().optional(),
      fontSize: z.number().min(10).max(32).optional(),
      lineHeight: z.number().min(1).max(3).optional(),
      autoSaveInterval: z.number().min(300).max(10000).optional(),
      // Phase D7 — ported from desktop/src/lib/vim-mode.ts's on/off toggle.
      // Found missing via actual browser testing: PUT silently dropped this
      // field (zod strips unknown object keys by default) instead of
      // erroring, so the client's "saved" state was a lie until this was
      // added here.
      vimModeEnabled: z.boolean().optional(),
      // Parity plan v2, Pha 6 — remember to add new fields here too: zod strips unknown keys.
      spellCheck: z.boolean().optional(),
      accentColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).optional(),
      tabSize: z.number().int().min(1).max(8).optional(),
      pdfColumnLayout: z.union([z.literal(1), z.literal(2)]).optional(),
      pdfChessboardWidth: z.union([z.literal(75), z.literal(100)]).optional(),
      autoCollapseSidebar: z.boolean().optional(),
      // Stage 4: interface language (packages/ui/src/i18n).
      language: z.enum(["en", "vi"]).optional(),
    })
    .optional(),
});

export default async function userRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  /** GDPR-style data export: everything this user owns, as one JSON document. */
  fastify.get("/me/export", async (request, reply) => {
    const userId = request.user!.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        createdAt: true,
        emailVerifiedAt: true,
        termsAcceptedAt: true,
        termsVersion: true,
      },
    });
    if (!user) {
      return reply.code(404).send({ error: "not_found" });
    }

    const workspaces = await prisma.workspace.findMany({
      where: { ownerId: userId },
      include: {
        vaults: {
          include: {
            folders: true,
            notes: true,
            plugins: true,
            syncConnections: {
              // Never include credentialsEncrypted in an export — same rule
              // as every other response in this API (see syncConnections.ts's
              // toPublic()).
              select: {
                id: true,
                providerType: true,
                remoteUrl: true,
                branch: true,
                authUsername: true,
                webdavUrl: true,
                webdavPath: true,
                direction: true,
                autoSync: true,
                lastSyncedAt: true,
                lastSyncStatus: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    // The usage records kept about the account (lib/activity.ts), as plain days.
    const activityDays = (await prisma.userActivityDay.findMany({ where: { userId }, orderBy: { day: "asc" }, select: { day: true } })).map(
      (d) => d.day.toISOString().slice(0, 10)
    );

    logAudit(prisma, { userId, action: "data_export", ip: request.ip });
    reply.header("Content-Disposition", `attachment; filename="noteriv-export-${userId}.json"`);
    return reply.send({ exportedAt: new Date().toISOString(), user, workspaces, activityDays });
  });

  /**
   * Permanently deletes this user's account and everything they own
   * (workspaces, vaults, notes, plugins, sync connections). Irreversible —
   * the frontend must get explicit user confirmation before calling this.
   */
  fastify.delete("/me", async (request, reply) => {
    const userId = request.user!.id;
    const parsed = deleteAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "password_required" });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return reply.code(404).send({ error: "not_found" });
    if (!user.passwordHash || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      logAudit(prisma, { userId, action: "account_delete_rejected", metadata: { reason: "wrong_password" }, ip: request.ip });
      return reply.code(403).send({ error: "wrong_password" });
    }

    const { attachmentFiles, failed } = await deleteAccount(prisma, userId);
    if (failed) request.log.warn({ failed, total: attachmentFiles }, "some attachment files were not removed from storage");
    // The user row is gone, so the entry names the account as its resource: with userId set, the foreign key made
    // this insert fail (silently, logAudit never throws) and account deletions were never logged before session 5.4.
    logAudit(prisma, { action: "account_deleted", resourceType: "user", resourceId: userId, metadata: { attachmentFiles, attachmentFilesFailed: failed }, ip: request.ip });
    reply.clearCookie(ACCESS_COOKIE, { path: "/" });
    reply.clearCookie(REFRESH_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });

  // Accepting the current Terms and Privacy Policy again after they changed (the app's TermsGate). The page sends the
  // version it showed: an older page open in another tab must not accept a text its user never saw.
  fastify.post("/me/terms", async (request, reply) => {
    const parsed = acceptTermsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    if (parsed.data.version !== TERMS_VERSION) return reply.code(409).send({ error: "terms_outdated", version: TERMS_VERSION });
    const userId = request.user!.id;
    await prisma.user.update({ where: { id: userId }, data: { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION } });
    logAudit(prisma, { userId, action: "terms_accepted", metadata: { termsVersion: TERMS_VERSION }, ip: request.ip });
    return reply.send({ ok: true, version: TERMS_VERSION });
  });

  // Settings → Plan and usage: the plan's limits (null = no limit) next to what the account uses now.
  fastify.get("/me/plan", async (request, reply) => {
    const userId = request.user!.id;
    const [plan, usage] = await Promise.all([planForUser(prisma, userId), usageFor(prisma, userId)]);
    // History is always bounded (snapshotCap): report the number actually kept, not "no limit".
    const limits = { ...limitsOf(plan), snapshotsPerNote: snapshotCap(plan.maxSnapshotsPerNote) };
    return reply.send({ plan: { id: plan.id, name: plan.name }, limits, usage });
  });

  fastify.post("/me/verification-email", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = resendVerificationSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) return reply.code(404).send({ error: "not_found" });
    if (user.emailVerifiedAt) return reply.send({ ok: true, alreadyVerified: true });

    const result = await sendVerificationEmail(prisma, request.log, user, parsed.data.locale);
    if (result !== "sent") {
      const { code, error } = sendFailure(result);
      return reply.code(code).send({ error });
    }
    logAudit(prisma, { userId: user.id, action: "email_verification_sent", ip: request.ip });
    return reply.send({ ok: true });
  });

  // The address only changes when the link sent to the new one is followed (POST /auth/verify-email). The current
  // password is asked so a session left open on a shared computer cannot hand the account to someone else.
  fastify.post("/me/email", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = changeEmailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const { newEmail, password, locale } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id: request.user!.id } });
    if (!user) return reply.code(404).send({ error: "not_found" });
    if (!user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      logAudit(prisma, { userId: user.id, action: "email_change_rejected", metadata: { reason: "wrong_password" }, ip: request.ip });
      return reply.code(403).send({ error: "wrong_password" });
    }
    if (newEmail === user.email) return reply.code(400).send({ error: "same_email" });
    if (await prisma.user.findUnique({ where: { email: newEmail }, select: { id: true } })) {
      return reply.code(409).send({ error: "email_taken" });
    }

    const result = await sendEmailChangeConfirmation(prisma, request.log, user, newEmail, locale);
    if (result !== "sent") {
      const { code, error } = sendFailure(result);
      return reply.code(code).send({ error });
    }
    logAudit(prisma, { userId: user.id, action: "email_change_requested", ip: request.ip });
    return reply.send({ ok: true });
  });

  // Per-user preferences (hotkey overrides + editor settings) — private to
  // the requesting user, not shared vault config (see UserVaultState for the
  // per-user/per-vault equivalent for workspace state).
  fastify.get("/me/preferences", async (request, reply) => {
    const pref = await prisma.userPreference.findUnique({ where: { userId: request.user!.id } });
    return reply.send({ hotkeys: pref?.hotkeys ?? {}, editorSettings: pref?.editorSettings ?? {} });
  });

  fastify.put("/me/preferences", async (request, reply) => {
    const parsed = preferencesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const userId = request.user!.id;
    const data = parsed.data;
    const pref = await prisma.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        hotkeys: data.hotkeys ?? {},
        editorSettings: data.editorSettings ?? {},
      },
      update: {
        ...(data.hotkeys !== undefined ? { hotkeys: data.hotkeys } : {}),
        ...(data.editorSettings !== undefined ? { editorSettings: data.editorSettings } : {}),
      },
    });
    return reply.send({ hotkeys: pref.hotkeys, editorSettings: pref.editorSettings });
  });
}
