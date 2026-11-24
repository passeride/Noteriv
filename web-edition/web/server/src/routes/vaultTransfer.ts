import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createRequire } from "node:module";
import type { Archiver, ArchiverOptions } from "archiver";
import path from "node:path";
import type { Readable } from "node:stream";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { ensureFolderChain } from "../lib/vaultFs.js";
import { recomputeBacklinksForNote } from "../lib/backlinks.js";
import { getObjectStream } from "../lib/attachments.js";
import { toRelativeLinks } from "../lib/attachmentLinks.js";
import { isSafeVaultPath } from "../lib/vaultPaths.js";
import { logAudit } from "../lib/auditLog.js";

// archiver 7 is CommonJS (module.exports = factory) while its typings declare named exports only.
const archiver = createRequire(import.meta.url)("archiver") as (format: "zip", options?: ArchiverOptions) => Archiver;

// Import is done by the browser in batches (it reads the picked folder/zip and
// rewrites attachment links first), so the server only needs a small "write these
// notes" endpoint plus a finalize step. Export streams a zip.

const MAX_FILES_PER_BATCH = 300;
const IMPORT_BODY_LIMIT = 12 * 1024 * 1024;

const importNotesSchema = z.object({
  files: z
    .array(z.object({ path: z.string().min(1).max(1024), content: z.string() }))
    .min(1)
    .max(MAX_FILES_PER_BATCH),
  /** What to do when a note already exists at that path. */
  onConflict: z.enum(["skip", "overwrite"]).default("skip"),
});

/** Normalises an imported relative path; returns null for anything unsafe. */
function cleanImportPath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = p.split("/");
  if (parts.some((s) => s === ".." || s === "." || s === "")) return null;
  if (parts.some((s) => s.length > 255)) return null;
  if (!/\.md$/i.test(p)) return null;
  const clean = parts.join("/");
  return isSafeVaultPath(clean) ? clean : null;
}

function safeZipName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 80) || "vault";
}

export default async function vaultTransferRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  async function writable(vid: string, userId: string) {
    const { role } = await requireVaultAccess(prisma, vid, userId);
    if (role === "viewer") throw new VaultAccessError(403, "forbidden");
  }

  fastify.post("/:vid/import/notes", { bodyLimit: IMPORT_BODY_LIMIT }, async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const parsed = importNotesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      await writable(vid, request.user!.id);
      const userId = request.user!.id;
      const { files, onConflict } = parsed.data;

      const existingFolders = await prisma.folder.findMany({ where: { vaultId: vid }, select: { id: true, path: true } });
      const folderByPath = new Map(existingFolders.map((f) => [f.path, f.id]));

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: { path: string; error: string }[] = [];

      for (const file of files) {
        const rel = cleanImportPath(file.path);
        if (!rel) {
          errors.push({ path: file.path, error: "invalid_path" });
          continue;
        }
        try {
          const existing = await prisma.note.findUnique({ where: { vaultId_path: { vaultId: vid, path: rel } } });
          const size = Buffer.byteLength(file.content, "utf8");
          if (existing) {
            if (onConflict === "skip") {
              skipped++;
              continue;
            }
            await prisma.note.update({
              where: { id: existing.id },
              data: { content: file.content, sizeBytes: size, deletedAt: null, updatedById: userId },
            });
            updated++;
            continue;
          }
          const slash = rel.lastIndexOf("/");
          const name = slash === -1 ? rel : rel.slice(slash + 1);
          const folderPath = slash === -1 ? null : rel.slice(0, slash);
          const folderId = folderPath ? await ensureFolderChain(prisma, vid, folderPath, folderByPath) : null;
          await prisma.note.create({
            data: { vaultId: vid, folderId, name, path: rel, content: file.content, sizeBytes: size, createdById: userId, updatedById: userId },
          });
          created++;
        } catch (err) {
          errors.push({ path: file.path, error: err instanceof Error ? err.message.slice(0, 200) : "failed" });
        }
      }
      return reply.send({ created, updated, skipped, errors });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  // After the last batch: links between notes that arrived in different batches
  // could not resolve yet, so rebuild backlinks for the whole vault once.
  fastify.post("/:vid/import/finalize", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      await writable(vid, request.user!.id);
      const notes = await prisma.note.findMany({ where: { vaultId: vid, deletedAt: null }, select: { id: true, content: true } });
      for (const n of notes) await recomputeBacklinksForNote(prisma, vid, n.id, n.content);
      logAudit(prisma, { userId: request.user!.id, action: "vault_imported", resourceType: "vault", resourceId: vid, metadata: { notes: notes.length }, ip: request.ip });
      return reply.send({ ok: true, notes: notes.length });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.get("/:vid/export", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      const { vault } = await requireVaultAccess(prisma, vid, request.user!.id);
      const [notes, attachments] = await Promise.all([
        prisma.note.findMany({ where: { vaultId: vid, deletedAt: null }, select: { path: true, content: true } }),
        prisma.attachment.findMany({ where: { vaultId: vid }, orderBy: { createdAt: "asc" } }),
      ]);

      // attachments/<filename>, de-duplicated; remember id -> zip path to rewrite note links.
      const used = new Set<string>();
      const zipPathById = new Map<string, string>();
      for (const a of attachments) {
        const ext = path.posix.extname(a.filename);
        const base = a.filename.slice(0, a.filename.length - ext.length) || "file";
        let candidate = `attachments/${a.filename}`;
        for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `attachments/${base} (${i})${ext}`;
        used.add(candidate.toLowerCase());
        zipPathById.set(a.id, candidate);
      }

      const rewrite = (notePath: string, content: string) => toRelativeLinks(vid, notePath, content, zipPathById);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("warning", (err: Error) => fastify.log.warn({ err }, "export zip warning"));
      archive.on("error", (err: Error) => {
        fastify.log.error({ err }, "export zip failed");
        archive.abort();
      });

      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(safeZipName(vault.name))}.zip`);
      reply.send(archive);

      // A path that is not a safe vault path (older data: "..") would unpack outside the user's folder: left out.
      for (const n of notes) if (isSafeVaultPath(n.path)) archive.append(rewrite(n.path, n.content), { name: n.path });
      for (const a of attachments) {
        try {
          const body = await getObjectStream(a.storageKey);
          if (body && isSafeVaultPath(zipPathById.get(a.id)!)) archive.append(body as Readable, { name: zipPathById.get(a.id)! });
        } catch (err) {
          fastify.log.warn({ err, attachment: a.id }, "export: attachment missing in storage, skipped");
        }
      }
      logAudit(prisma, { userId: request.user!.id, action: "vault_exported", resourceType: "vault", resourceId: vid, metadata: { notes: notes.length, attachments: attachments.length }, ip: request.ip });
      await archive.finalize();
      return reply;
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
