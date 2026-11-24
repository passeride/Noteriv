import type { FastifyInstance } from "fastify";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { requireVerifiedEmail } from "../lib/emailGate.js";
import { makeStorageKey, putObject, getObjectStream, deleteObject } from "../lib/attachments.js";
import { checkLimit, limitsOf, ownerOfVault, planForUser, PlanLimitError, planLimitReply, usageFor } from "../lib/plans.js";

/**
 * Safe MIME types that can be rendered inline in browsers without risk of executing scripts.
 * SVG, HTML, XML, JavaScript, etc. MUST NOT be served inline on the app's domain.
 */
export const SAFE_INLINE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/ogg",
]);

export function isSafeInlineMime(mimeType: string | null | undefined): boolean {
  if (!mimeType) return false;
  return SAFE_INLINE_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export default async function attachmentRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/:vid/attachments", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      await requireVaultAccess(prisma, vid, request.user!.id);
      const attachments = await prisma.attachment.findMany({ where: { vaultId: vid }, orderBy: { createdAt: "desc" } });
      // Storage is counted for the whole account of the vault's owner, not this vault alone. quotaBytes null = no limit.
      const owner = await ownerOfVault(prisma, vid);
      const usedBytes = owner ? (await usageFor(prisma, owner)).attachmentBytes : 0;
      const quotaBytes = owner ? limitsOf(await planForUser(prisma, owner)).attachmentBytes : null;
      return reply.send({ attachments, usedBytes, quotaBytes });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.post("/:vid/attachments", { preHandler: requireVerifiedEmail(prisma, "attachment_upload") }, async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      const { role } = await requireVaultAccess(prisma, vid, request.user!.id);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });

      const file = await request.file();
      if (!file) return reply.code(400).send({ error: "no_file" });

      const buffer = await file.toBuffer();

      const owner = await ownerOfVault(prisma, vid);
      if (owner) await checkLimit(prisma, owner, "attachmentBytes", buffer.length);

      const storageKey = makeStorageKey(vid, file.filename);
      await putObject(storageKey, buffer, file.mimetype);

      const attachment = await prisma.attachment.create({
        data: {
          vaultId: vid,
          filename: file.filename,
          mimeType: file.mimetype,
          size: buffer.length,
          storageKey,
        },
      });

      return reply.code(201).send(attachment);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      if (err instanceof PlanLimitError) return planLimitReply(reply, err);
      throw err;
    }
  });

  fastify.get("/:vid/attachments/:aid/download", async (request, reply) => {
    const { vid, aid } = request.params as { vid: string; aid: string };
    try {
      await requireVaultAccess(prisma, vid, request.user!.id);
      const attachment = await prisma.attachment.findFirst({ where: { id: aid, vaultId: vid } });
      if (!attachment) return reply.code(404).send({ error: "not_found" });

      const stream = await getObjectStream(attachment.storageKey);
      const isSafe = isSafeInlineMime(attachment.mimeType);
      const disposition = isSafe ? "inline" : "attachment";
      const safeFilename = attachment.filename.replace(/["\r\n\0]/g, "_");
      const asciiFallback = safeFilename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");

      reply.header("Content-Type", isSafe ? attachment.mimeType : "application/octet-stream");
      reply.header("Content-Disposition", `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`);
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Content-Security-Policy", "default-src 'none'; sandbox");
      return reply.send(stream);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  // PDF annotations (Phase D4) — stored on the attachment row itself (see
  // Attachment.metadata's schema comment), loaded/saved as one JSON blob
  // alongside the viewer, same shape as web/src/lib/pdf-annotation.ts.
  fastify.patch("/:vid/attachments/:aid", async (request, reply) => {
    const { vid, aid } = request.params as { vid: string; aid: string };
    try {
      const { role } = await requireVaultAccess(prisma, vid, request.user!.id);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });

      const body = request.body as { metadata?: unknown };
      const attachment = await prisma.attachment.findFirst({ where: { id: aid, vaultId: vid } });
      if (!attachment) return reply.code(404).send({ error: "not_found" });

      const updated = await prisma.attachment.update({
        where: { id: aid },
        data: { metadata: body.metadata === undefined ? undefined : (body.metadata as object) },
      });
      return reply.send(updated);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.delete("/:vid/attachments/:aid", async (request, reply) => {
    const { vid, aid } = request.params as { vid: string; aid: string };
    try {
      const { role } = await requireVaultAccess(prisma, vid, request.user!.id);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });

      const attachment = await prisma.attachment.findFirst({ where: { id: aid, vaultId: vid } });
      if (!attachment) return reply.code(404).send({ error: "not_found" });

      await deleteObject(attachment.storageKey);
      await prisma.attachment.delete({ where: { id: aid } });
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
