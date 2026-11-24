import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { verifyAccessToken } from "../lib/jwt.js";

export interface AuthUser {
  id: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async (fastify: FastifyInstance) => {
  fastify.decorateRequest("user", null);

  fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = request.cookies["noteriv_access"];
    if (!token) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    // Checked on every request (a primary-key read) so locking an account takes effect at once, not when its
    // 15-minute access token runs out. 401 sends the page through its refresh → sign-in path, which is refused too.
    const account = await fastify.prisma.user.findUnique({ where: { id: payload.sub }, select: { lockedAt: true } });
    if (!account) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    if (account.lockedAt) {
      reply.code(401).send({ error: "account_locked" });
      return;
    }
    request.user = { id: payload.sub, email: payload.email };
  });
});
