import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { emailEnabled } from "./email/send.js";
import { logAudit } from "./auditLog.js";

/**
 * Route preHandler for what an account may only do once its email is verified: the actions that reach outside the
 * app (sync to a remote, the GitHub API, the web clipper) or cost the server real resources (attachment storage, PDF
 * rendering). Unverified accounts are cheap to make once sign-up is open, so these wait for a real address.
 *
 * Only while the server sends email: with email off nobody could verify, and blocking would lock everyone out.
 * Runs after the plugin-wide `authenticate` hook, so request.user is set.
 */
export function requireVerifiedEmail(prisma: PrismaClient, action: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!emailEnabled() || !request.user) return;
    const user = await prisma.user.findUnique({ where: { id: request.user.id }, select: { emailVerifiedAt: true } });
    if (user?.emailVerifiedAt) return;
    logAudit(prisma, { userId: request.user.id, action: "blocked_unverified", metadata: { action }, ip: request.ip });
    return reply.code(403).send({ error: "email_unverified" });
  };
}
