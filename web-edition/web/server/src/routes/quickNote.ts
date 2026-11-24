import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { ensureFolderChain } from "../lib/vaultFs.js";
import { recomputeBacklinksForNote } from "../lib/backlinks.js";
import { logAudit } from "../lib/auditLog.js";
import { isSafeVaultPath } from "../lib/vaultPaths.js";
import { quickNoteFolder, quickNoteName } from "../lib/quickNoteName.js";

// Quick note (/quick): one request that files a new note into a folder (Inbox/ by default), creating the folder on
// first use, so capturing on a phone stays fast on a weak connection.

const quickNoteSchema = z.object({
  content: z.string().min(1).max(1_000_000),
  folder: z.string().max(500).optional(),
  /** Name to use when the text has no usable first line, in the user's language (e.g. "Quick note 2026-10-18 1530"). */
  fallbackName: z.string().max(100).optional(),
});

export default async function quickNoteRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.post("/:vid/quick-note", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const parsed = quickNoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const folderPath = quickNoteFolder(parsed.data.folder);
    if (folderPath === null || (folderPath && !isSafeVaultPath(folderPath))) return reply.code(400).send({ error: "invalid_folder" });
    const userId = request.user!.id;

    try {
      const { role } = await requireVaultAccess(prisma, vid, userId);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }

    let folderId: string | null = null;
    if (folderPath) {
      // Folders that already exist on the way are reused; one sitting in the trash comes back, since its path is
      // still taken and the user just asked to file into it.
      const prefixes = folderPath.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/"));
      const existing = await prisma.folder.findMany({ where: { vaultId: vid, path: { in: prefixes } }, select: { id: true, path: true, deletedAt: true } });
      const cache = new Map<string, string>();
      for (const f of existing) {
        if (f.deletedAt) await prisma.folder.update({ where: { id: f.id }, data: { deletedAt: null } });
        cache.set(f.path, f.id);
      }
      folderId = await ensureFolderChain(prisma, vid, folderPath, cache);
    }

    const content = parsed.data.content;
    const base = quickNoteName(content, parsed.data.fallbackName ?? `Quick note ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
    const pathOf = (name: string) => (folderPath ? `${folderPath}/${name}` : name);
    let name = `${base}.md`;
    for (let i = 2; await prisma.note.findUnique({ where: { vaultId_path: { vaultId: vid, path: pathOf(name) } }, select: { id: true } }); i++) {
      name = `${base} ${i}.md`;
    }
    const note = await prisma.note.create({
      data: { vaultId: vid, folderId, name, path: pathOf(name), content, sizeBytes: Buffer.byteLength(content, "utf8"), createdById: userId, updatedById: userId },
      select: { id: true, path: true },
    });
    await recomputeBacklinksForNote(prisma, vid, note.id, content);
    logAudit(prisma, { userId, action: "quick_note", resourceType: "note", resourceId: note.id, ip: request.ip });
    return reply.code(201).send(note);
  });
}
