import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { logAudit } from "../lib/auditLog.js";
import { requireVerifiedEmail } from "../lib/emailGate.js";

// Download a note as a real PDF. The browser builds the final HTML (it alone can render plugin
// blocks such as chessboards and fetch attachments with the user's cookie) and this route hands it
// to the internal `noteriv-pdf` service (headless Chromium). The service is only reachable on the
// compose network and is protected by a shared token.

const bodySchema = z.object({
  html: z.string().min(1).max(7_000_000),
  title: z.string().max(200).optional(),
});

function safeFileName(title: string): string {
  const cleaned = title.replace(/\.(md|markdown)$/i, "").replace(/[\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return cleaned || "note";
}

export default async function pdfRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.post(
    "/:vid/notes/:nid/pdf",
    {
      bodyLimit: 8 * 1024 * 1024,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      preHandler: requireVerifiedEmail(prisma, "pdf_export"),
    },
    async (request, reply) => {
      const { vid, nid } = request.params as { vid: string; nid: string };
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      const url = process.env.PDF_SERVICE_URL;
      const token = process.env.PDF_SERVICE_TOKEN;
      if (!url || !token) return reply.code(503).send({ error: "pdf_unavailable", message: "Dịch vụ tạo PDF chưa được cấu hình trên máy chủ." });

      try {
        await requireVaultAccess(prisma, vid, request.user!.id);
        const note = await prisma.note.findFirst({ where: { id: nid, vaultId: vid, deletedAt: null }, select: { name: true } });
        if (!note) return reply.code(404).send({ error: "not_found" });

        let res: Response;
        try {
          res = await fetch(`${url}/render`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Pdf-Token": token },
            body: JSON.stringify({ html: parsed.data.html }),
            signal: AbortSignal.timeout(45_000),
          });
        } catch (err) {
          request.log.error({ err }, "pdf service unreachable");
          return reply.code(503).send({ error: "pdf_unavailable", message: "Dịch vụ tạo PDF không phản hồi, thử lại sau ít phút." });
        }
        if (!res.ok) {
          request.log.error({ status: res.status }, "pdf service error");
          return reply.code(502).send({ error: "pdf_failed", message: res.status === 413 ? "Note quá lớn để xuất PDF." : "Không tạo được PDF." });
        }

        const pdf = Buffer.from(await res.arrayBuffer());
        logAudit(prisma, { userId: request.user!.id, action: "note_pdf_exported", resourceType: "note", resourceId: nid, metadata: { bytes: pdf.length }, ip: request.ip });
        const name = safeFileName(parsed.data.title ?? note.name);
        reply.header("Content-Type", "application/pdf");
        reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}.pdf`);
        return reply.send(pdf);
      } catch (err) {
        if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
        throw err;
      }
    }
  );
}
