import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { resolvePath } from "../lib/notePath.js";
import { trashFolder } from "../lib/trash.js";
import { vaultSegmentError } from "../lib/vaultPaths.js";

const createFolderSchema = z.object({
  // One path segment: no "/", "..", ".git" (it becomes a folder under the sync working copy).
  name: z.string().min(1).max(255).refine((n) => vaultSegmentError(n) === null, "invalid_name"),
  parentId: z.string().uuid().nullable().optional(),
});

export default async function folderRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.post("/:vid/folders", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const parsed = createFolderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      const { role } = await requireVaultAccess(prisma, vid, request.user!.id);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });

      const { name, parentId } = parsed.data;
      const path = await resolvePath(prisma, vid, parentId, name);
      const folder = await prisma.folder.create({
        data: { vaultId: vid, parentId: parentId ?? null, name, path },
      });
      return reply.code(201).send(folder);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      if (err instanceof Error && err.message === "folder_not_found") {
        return reply.code(400).send({ error: "parent_not_found" });
      }
      throw err;
    }
  });

  fastify.patch("/:vid/folders/:fid", async (request, reply) => {
    const { vid, fid } = request.params as { vid: string; fid: string };
    const parsed = createFolderSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      const { role } = await requireVaultAccess(prisma, vid, request.user!.id);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });

      const existing = await prisma.folder.findFirst({ where: { id: fid, vaultId: vid, deletedAt: null } });
      if (!existing) return reply.code(404).send({ error: "not_found" });

      const nextName = parsed.data.name ?? existing.name;
      const nextParentId = parsed.data.parentId === undefined ? existing.parentId : parsed.data.parentId;

      // A folder can't move into itself or one of its own descendants.
      for (let cur = nextParentId; cur; ) {
        if (cur === fid) return reply.code(400).send({ error: "cannot_move_into_self" });
        const parent = await prisma.folder.findFirst({ where: { id: cur, vaultId: vid }, select: { parentId: true } });
        cur = parent?.parentId ?? null;
      }

      const path = await resolvePath(prisma, vid, nextParentId, nextName);
      const oldPath = existing.path;

      // Descendant folders and notes store their full path, so a rename/move must rewrite
      // their prefix too — otherwise they keep pointing at the old location.
      const prefix = `${oldPath}/`;
      const [childFolders, childNotes] =
        path === oldPath
          ? [[], []]
          : await Promise.all([
              prisma.folder.findMany({ where: { vaultId: vid, path: { startsWith: prefix } }, select: { id: true, path: true } }),
              prisma.note.findMany({ where: { vaultId: vid, path: { startsWith: prefix } }, select: { id: true, path: true } }),
            ]);

      let folder;
      try {
        folder = await prisma.$transaction(async (tx) => {
          const updated = await tx.folder.update({
            where: { id: fid },
            data: { name: nextName, parentId: nextParentId, path },
          });
          for (const f of childFolders) await tx.folder.update({ where: { id: f.id }, data: { path: path + f.path.slice(oldPath.length) } });
          for (const n of childNotes) await tx.note.update({ where: { id: n.id }, data: { path: path + n.path.slice(oldPath.length) } });
          return updated;
        });
      } catch (err) {
        if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
          return reply.code(409).send({ error: "path_exists" });
        }
        throw err;
      }
      return reply.send(folder);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.delete("/:vid/folders/:fid", async (request, reply) => {
    const { vid, fid } = request.params as { vid: string; fid: string };
    try {
      const { role } = await requireVaultAccess(prisma, vid, request.user!.id);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });
      const existing = await prisma.folder.findFirst({ where: { id: fid, vaultId: vid, deletedAt: null } });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      await trashFolder(prisma, vid, fid);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
