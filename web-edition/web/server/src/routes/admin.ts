import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { generateInviteCode, isAdmin, isAdminEmail } from "../lib/registration.js";
import { logAudit } from "../lib/auditLog.js";
import { limitsOf, usageFor } from "../lib/plans.js";
import { deleteAccount } from "../lib/accounts.js";
import { emailEnabled } from "../lib/email/send.js";
import { sendPasswordResetEmail } from "../lib/accountEmails.js";
import { usageStats } from "../lib/activity.js";

const USERS_PAGE_SIZE = 50;
const AUDIT_PAGE_SIZE = 100;

const updateUserSchema = z.object({
  planId: z.string().min(1).max(40).optional(),
  locked: z.boolean().optional(),
  role: z.enum(["user", "admin"]).optional(),
});

const createInviteSchema = z.object({
  note: z.string().max(120).default(""),
  maxUses: z.number().int().min(1).max(500).default(1),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/**
 * The admin page (/admin): users, plans, invite codes, audit log. Admin = the admin role in the database OR an email in
 * ADMIN_EMAILS (lib/registration.ts isAdmin), read from the database on every request rather than from the token, so
 * taking the role away works at once. Every change made here is written to the audit log with the admin as its user
 * and the affected account as its resource.
 */
export default async function adminRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", async (request, reply) => {
    if (reply.sent) return;
    const me = await prisma.user.findUnique({ where: { id: request.user!.id }, select: { role: true, email: true, emailVerifiedAt: true } });
    if (!me || !isAdmin(me)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  });

  const audit = (adminId: string, action: string, targetId: string, ip: string, metadata?: Record<string, unknown>) =>
    logAudit(prisma, { userId: adminId, action, resourceType: "user", resourceId: targetId, metadata, ip });

  fastify.get("/users", async (request, reply) => {
    const query = z
      .object({ q: z.string().max(200).optional(), page: z.coerce.number().int().min(1).max(10_000).default(1) })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });
    const q = query.data.q?.trim();
    const where: Prisma.UserWhereInput = q
      ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { displayName: { contains: q, mode: "insensitive" } }] }
      : {};
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.data.page - 1) * USERS_PAGE_SIZE,
        take: USERS_PAGE_SIZE,
      }),
    ]);
    const users = await Promise.all(
      rows.map(async (u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        createdAt: u.createdAt,
        emailVerified: u.emailVerifiedAt !== null,
        locked: u.lockedAt !== null,
        planId: u.planId,
        role: u.role,
        isAdmin: isAdmin(u),
        // Admin through ADMIN_EMAILS: the page cannot take that away (it lives in the server's env).
        envAdmin: isAdminEmail(u.email),
        usage: await usageFor(prisma, u.id),
      }))
    );
    return reply.send({ users, total, page: query.data.page, pageSize: USERS_PAGE_SIZE });
  });

  // Counts only (no emails): sign-ups, active accounts and retention from user_activity_days (lib/activity.ts).
  fastify.get("/stats", async (_request, reply) => {
    return reply.send(await usageStats(prisma));
  });

  fastify.get("/plans", async (_request, reply) => {
    const plans = await prisma.plan.findMany({ orderBy: { id: "asc" } });
    return reply.send(plans.map((p) => ({ id: p.id, name: p.name, limits: limitsOf(p) })));
  });

  fastify.patch("/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateUserSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const { planId, locked, role } = parsed.data;
    const adminId = request.user!.id;

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: "not_found" });
    // An admin cannot lock themselves out or drop their own role; an ADMIN_EMAILS admin stays one whatever the role.
    if (id === adminId && (locked === true || role === "user")) return reply.code(400).send({ error: "not_on_yourself" });
    if (role === "user" && isAdminEmail(target.email)) return reply.code(400).send({ error: "env_admin" });

    if (planId !== undefined && planId !== target.planId) {
      if (!(await prisma.plan.findUnique({ where: { id: planId } }))) return reply.code(400).send({ error: "unknown_plan" });
      await prisma.user.update({ where: { id }, data: { planId } });
      audit(adminId, "admin_plan_assigned", id, request.ip, { from: target.planId, to: planId });
    }
    if (role !== undefined && role !== target.role) {
      await prisma.user.update({ where: { id }, data: { role } });
      audit(adminId, "admin_role_changed", id, request.ip, { from: target.role, to: role });
    }
    if (locked === true && !target.lockedAt) {
      // Sessions end now: the refresh tokens go, and every request is refused (plugins/auth.ts).
      await prisma.$transaction([
        prisma.user.update({ where: { id }, data: { lockedAt: new Date() } }),
        prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      audit(adminId, "admin_user_locked", id, request.ip);
    } else if (locked === false && target.lockedAt) {
      await prisma.user.update({ where: { id }, data: { lockedAt: null } });
      audit(adminId, "admin_user_unlocked", id, request.ip);
    }
    return reply.send({ ok: true });
  });

  fastify.post("/users/:id/password-reset", async (request, reply) => {
    const { id } = request.params as { id: string };
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: "not_found" });
    if (!emailEnabled()) return reply.code(503).send({ error: "email_disabled" });
    const result = await sendPasswordResetEmail(prisma, request.log, target);
    if (result === "throttled") return reply.code(429).send({ error: "throttled" });
    if (result !== "sent") return reply.code(502).send({ error: "email_failed" });
    audit(request.user!.id, "admin_password_reset_sent", id, request.ip);
    return reply.send({ ok: true });
  });

  fastify.post("/users/:id/verify-email", async (request, reply) => {
    const { id } = request.params as { id: string };
    const target = await prisma.user.findUnique({ where: { id }, select: { emailVerifiedAt: true } });
    if (!target) return reply.code(404).send({ error: "not_found" });
    if (!target.emailVerifiedAt) {
      await prisma.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
      audit(request.user!.id, "admin_email_verified", id, request.ip);
    }
    return reply.send({ ok: true });
  });

  fastify.delete("/users/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const adminId = request.user!.id;
    if (id === adminId) return reply.code(400).send({ error: "not_on_yourself" });
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return reply.code(404).send({ error: "not_found" });
    // Take the admin role away first: deleting an admin by mistake is too costly to allow in one step.
    if (isAdmin(target)) return reply.code(400).send({ error: "is_admin" });
    const { attachmentFiles, failed } = await deleteAccount(prisma, id);
    if (failed) request.log.warn({ failed, total: attachmentFiles }, "some attachment files were not removed from storage");
    // No email in the entry: the account is gone along with the data its owner had a right to have erased.
    audit(adminId, "admin_user_deleted", id, request.ip, { attachmentFiles, attachmentFilesFailed: failed });
    return reply.send({ ok: true });
  });

  fastify.get("/audit", async (request, reply) => {
    const query = z
      .object({
        action: z.string().max(80).optional(),
        email: z.string().max(200).optional(),
        before: z.string().datetime().optional(),
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });
    const { action, email, before } = query.data;
    const rows = await prisma.auditLog.findMany({
      where: {
        ...(action?.trim() ? { action: { contains: action.trim() } } : {}),
        ...(email?.trim() ? { user: { email: { contains: email.trim().toLowerCase() } } } : {}),
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: AUDIT_PAGE_SIZE,
      include: { user: { select: { email: true } } },
    });
    return reply.send({
      entries: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        action: r.action,
        userEmail: r.user?.email ?? null,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        ip: r.ip,
        metadata: r.metadata,
      })),
      // Pass the last entry's time as `before` for the next page; null when this was the last one.
      next: rows.length === AUDIT_PAGE_SIZE ? rows[rows.length - 1].createdAt.toISOString() : null,
    });
  });

  fastify.get("/invites", async (_request, reply) => {
    const rows = await prisma.inviteCode.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    const now = Date.now();
    return reply.send(
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        note: r.note,
        maxUses: r.maxUses,
        usedCount: r.usedCount,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
        createdAt: r.createdAt,
        status: r.revokedAt
          ? "revoked"
          : r.expiresAt && r.expiresAt.getTime() <= now
            ? "expired"
            : r.usedCount >= r.maxUses
              ? "used_up"
              : "active",
      }))
    );
  });

  fastify.post("/invites", async (request, reply) => {
    const parsed = createInviteSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const { note, maxUses, expiresInDays } = parsed.data;

    // 49 bits of randomness makes a collision practically impossible; retry anyway rather than 500.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const row = await prisma.inviteCode.create({
          data: {
            code: generateInviteCode(),
            note,
            maxUses,
            expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
            createdById: request.user!.id,
          },
        });
        logAudit(prisma, { userId: request.user!.id, action: "invite_created", resourceType: "invite_code", resourceId: row.id, metadata: { maxUses, expiresInDays: expiresInDays ?? null }, ip: request.ip });
        return reply.code(201).send({ id: row.id, code: row.code });
      } catch (err) {
        if ((err as { code?: string }).code !== "P2002") throw err;
      }
    }
    return reply.code(500).send({ error: "could_not_generate_code" });
  });

  fastify.delete("/invites/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.inviteCode.findUnique({ where: { id } });
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (!row.revokedAt) {
      await prisma.inviteCode.update({ where: { id }, data: { revokedAt: new Date() } });
      logAudit(prisma, { userId: request.user!.id, action: "invite_revoked", resourceType: "invite_code", resourceId: id, ip: request.ip });
    }
    return reply.send({ ok: true });
  });
}
