import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { logAudit } from "../lib/auditLog.js";
import { deleteObjectsBestEffort } from "../lib/attachments.js";
import { checkLimit, PlanLimitError, planLimitReply } from "../lib/plans.js";

const createVaultSchema = z.object({
  name: z.string().min(1).max(200),
  workspaceId: z.string().uuid().optional(),
});

const updateVaultSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  settings: z.record(z.any()).optional(),
});

export default async function vaultRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/", async (request, reply) => {
    const vaults = await prisma.vault.findMany({
      where: { workspace: { members: { some: { userId: request.user!.id } } } },
      orderBy: { updatedAt: "desc" },
    });
    return reply.send(vaults);
  });

  fastify.post("/", async (request, reply) => {
    const parsed = createVaultSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const { name, workspaceId } = parsed.data;

    let targetWorkspaceId = workspaceId;
    if (!targetWorkspaceId) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId: request.user!.id, role: "owner" },
        orderBy: { createdAt: "asc" },
      });
      if (!membership) {
        return reply.code(400).send({ error: "no_workspace" });
      }
      targetWorkspaceId = membership.workspaceId;
    } else {
      const membership = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: targetWorkspaceId, userId: request.user!.id } },
      });
      if (!membership || membership.role === "viewer") {
        return reply.code(403).send({ error: "forbidden" });
      }
    }

    // The vault counts for the owner of the workspace it goes into.
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: targetWorkspaceId }, select: { ownerId: true } });
    try {
      await checkLimit(prisma, workspace.ownerId, "vaults");
    } catch (err) {
      if (err instanceof PlanLimitError) return planLimitReply(reply, err);
      throw err;
    }

    const vault = await prisma.vault.create({
      data: { name, workspaceId: targetWorkspaceId },
    });
    return reply.code(201).send(vault);
  });

  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { vault } = await requireVaultAccess(prisma, id, request.user!.id);
      return reply.send(vault);
    } catch (err) {
      if (err instanceof VaultAccessError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  fastify.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateVaultSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body" });
    }
    try {
      const { role } = await requireVaultAccess(prisma, id, request.user!.id);
      if (role === "viewer") {
        return reply.code(403).send({ error: "forbidden" });
      }
      const updated = await prisma.vault.update({ where: { id }, data: parsed.data });
      return reply.send(updated);
    } catch (err) {
      if (err instanceof VaultAccessError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { role } = await requireVaultAccess(prisma, id, request.user!.id);
      if (role !== "owner") {
        return reply.code(403).send({ error: "forbidden" });
      }
      // Attachment rows go with the vault (cascade); their files in object storage must be removed too.
      const keys = (await prisma.attachment.findMany({ where: { vaultId: id }, select: { storageKey: true } })).map((a) => a.storageKey);
      await prisma.vault.delete({ where: { id } });
      const failed = await deleteObjectsBestEffort(keys);
      if (failed) request.log.warn({ vaultId: id, failed, total: keys.length }, "some attachment files were not removed from storage");
      logAudit(prisma, { userId: request.user!.id, action: "vault_deleted", resourceType: "vault", resourceId: id, metadata: { attachmentFiles: keys.length, attachmentFilesFailed: failed }, ip: request.ip });
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  // Full note/folder index for client-side cache (sidebar tree, dataview, wikilink resolution)
  fastify.get("/:id/index", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await requireVaultAccess(prisma, id, request.user!.id);
      const [folders, notes] = await Promise.all([
        prisma.folder.findMany({ where: { vaultId: id, deletedAt: null }, orderBy: { position: "asc" } }),
        prisma.note.findMany({
          where: { vaultId: id, deletedAt: null },
          select: {
            id: true,
            name: true,
            path: true,
            folderId: true,
            frontmatter: true,
            sizeBytes: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { name: "asc" },
        }),
      ]);
      return reply.send({ folders, notes });
    } catch (err) {
      if (err instanceof VaultAccessError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  // Full-text search over note name + content (Postgres tsvector, see prisma migration
  // add_backlinks_and_search for the generated `content_tsv` column + GIN index).
  fastify.get("/:id/search", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { q } = request.query as { q?: string };
    if (!q || !q.trim()) return reply.send([]);
    try {
      await requireVaultAccess(prisma, id, request.user!.id);
      const results = await prisma.$queryRaw<
        Array<{ id: string; name: string; path: string; snippet: string; rank: number; content: string }>
      >(Prisma.sql`
        SELECT
          id,
          name,
          path,
          content,
          ts_headline('simple', content, plainto_tsquery('simple', ${q}),
            'MaxFragments=1, MaxWords=20, MinWords=5') AS snippet,
          ts_rank(content_tsv, plainto_tsquery('simple', ${q})) AS rank
        FROM notes
        WHERE vault_id = ${id} AND deleted_at IS NULL AND content_tsv @@ plainto_tsquery('simple', ${q})
        ORDER BY rank DESC
        LIMIT 50
      `);
      // The lines that contain the search words, so the client can list and jump to them (like desktop search).
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      return reply.send(
        results.map(({ content, ...r }) => ({ ...r, matches: matchingLines(content, terms, MAX_MATCHES_PER_NOTE) }))
      );
    } catch (err) {
      if (err instanceof VaultAccessError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });

  /**
   * The start of every note that has front matter (`---` on its first line), for the Properties view: the client
   * parses the block (packages/core/src/properties.ts). Only the first FRONTMATTER_HEAD characters are sent.
   */
  fastify.get("/:id/frontmatter", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await requireVaultAccess(prisma, id, request.user!.id);
      const rows = await prisma.$queryRaw<Array<{ id: string; name: string; path: string; head: string }>>(Prisma.sql`
        SELECT id, name, path, substring(content from 1 for ${FRONTMATTER_HEAD}::int) AS head
        FROM notes
        WHERE vault_id = ${id} AND deleted_at IS NULL AND (content LIKE '---%' OR content LIKE ${"﻿---%"})
      `);
      // Only the block itself goes back (a few hundred bytes, not the note's first 20 000 characters); a block that
      // does not close within the head is left out.
      const blocks = rows.flatMap((r) => {
        const m = FRONTMATTER_BLOCK.exec(r.head);
        return m ? [{ id: r.id, name: r.name, path: r.path, head: m[0] }] : [];
      });
      return reply.send(blocks);
    } catch (err) {
      if (err instanceof VaultAccessError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      throw err;
    }
  });
}

/** Front matter longer than this is not expected; the Properties view reads at most this much of each note. */
const FRONTMATTER_HEAD = 20000;
/** A front matter block at the very start: `---` (after an optional BOM), lines, then `---` or `...`. */
const FRONTMATTER_BLOCK = /^﻿?---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)(?=\r?\n|$)/;

const MAX_MATCHES_PER_NOTE = 5;

/** Lines of `content` containing every search term (case-insensitive), 1-based, at most `max`. */
export function matchingLines(content: string, terms: string[], max: number): Array<{ line: number; text: string }> {
  if (terms.length === 0) return [];
  const out: Array<{ line: number; text: string }> = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const lower = lines[i].toLowerCase();
    if (terms.every((t) => lower.includes(t))) out.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
  }
  if (out.length === 0) {
    // Words spread over several lines: point at the first line holding any of them.
    for (let i = 0; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      if (terms.some((t) => lower.includes(t))) return [{ line: i + 1, text: lines[i].trim().slice(0, 200) }];
    }
  }
  return out;
}
