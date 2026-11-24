import type { FastifyInstance } from "fastify";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { listTrash, restoreNote, restoreFolder, emptyTrash } from "../lib/trash.js";

export default async function trashRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  async function assertWrite(vaultId: string, userId: string) {
    const { role } = await requireVaultAccess(prisma, vaultId, userId);
    if (role === "viewer") throw new VaultAccessError(403, "forbidden");
  }

  fastify.get("/:vid/trash", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      await requireVaultAccess(prisma, vid, request.user!.id);
      return reply.send(await listTrash(prisma, vid));
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.post("/:vid/trash/notes/:nid/restore", async (request, reply) => {
    const { vid, nid } = request.params as { vid: string; nid: string };
    try {
      await assertWrite(vid, request.user!.id);
      await restoreNote(prisma, vid, nid);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.post("/:vid/trash/folders/:fid/restore", async (request, reply) => {
    const { vid, fid } = request.params as { vid: string; fid: string };
    try {
      await assertWrite(vid, request.user!.id);
      await restoreFolder(prisma, vid, fid);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.delete("/:vid/trash/notes/:nid", async (request, reply) => {
    const { vid, nid } = request.params as { vid: string; nid: string };
    try {
      await assertWrite(vid, request.user!.id);
      const existing = await prisma.note.findFirst({ where: { id: nid, vaultId: vid, deletedAt: { not: null } } });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      await prisma.note.delete({ where: { id: nid } });
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.delete("/:vid/trash/folders/:fid", async (request, reply) => {
    const { vid, fid } = request.params as { vid: string; fid: string };
    try {
      await assertWrite(vid, request.user!.id);
      const existing = await prisma.folder.findFirst({ where: { id: fid, vaultId: vid, deletedAt: { not: null } } });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      await prisma.folder.delete({ where: { id: fid } });
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.post("/:vid/trash/empty", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      await assertWrite(vid, request.user!.id);
      await emptyTrash(prisma, vid);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
