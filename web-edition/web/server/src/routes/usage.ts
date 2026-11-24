import type { FastifyInstance } from "fastify";
import { currentUsage } from "../lib/usageTracker.js";

export default async function usageRoutes(fastify: FastifyInstance) {
  /** This month's (UTC) tokens and cost for the signed-in user, against their limits. A limit of 0 means no limit. */
  fastify.get(
    "/current",
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const snapshot = await currentUsage(fastify.prisma, request.user!.id);
      // Per-user data: never let a shared cache serve it to someone else.
      reply.header("Cache-Control", "private, no-store");
      return snapshot;
    }
  );
}
