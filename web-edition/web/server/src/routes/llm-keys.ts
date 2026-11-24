import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { encryptSecret } from "../lib/credentials-vault.js";

const providerField = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/, "provider must be lowercase letters, digits, - or _");
const storeSchema = z.object({
  provider: providerField,
  apiKey: z.string().trim().min(8).max(512),
});

/** Per-user LLM API keys. Keys go in encrypted and never come back out: list returns provider names only. */
export default async function llmKeyRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.post("/", async (request, reply) => {
    const parsed = storeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues });
    const userId = request.user!.id;
    const { provider, apiKey } = parsed.data;
    const keyEncrypted = encryptSecret(apiKey);
    await fastify.prisma.llmApiKey.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, keyEncrypted },
      update: { keyEncrypted },
    });
    return reply.code(201).send({ provider });
  });

  fastify.get("/", async (request) => {
    const rows = await fastify.prisma.llmApiKey.findMany({
      where: { userId: request.user!.id },
      select: { provider: true, createdAt: true },
      orderBy: { provider: "asc" },
    });
    return { providers: rows.map((r) => ({ provider: r.provider, createdAt: r.createdAt })) };
  });

  fastify.delete("/:provider", async (request, reply) => {
    const provider = providerField.safeParse((request.params as { provider: string }).provider);
    if (!provider.success) return reply.code(400).send({ error: "invalid_provider" });
    const { count } = await fastify.prisma.llmApiKey.deleteMany({
      where: { userId: request.user!.id, provider: provider.data },
    });
    if (count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
