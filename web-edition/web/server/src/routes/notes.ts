import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { resolvePath } from "../lib/notePath.js";
import { recomputeBacklinksForNote } from "../lib/backlinks.js";
import { trashNote } from "../lib/trash.js";
import { listSnapshots, getSnapshotContent } from "../lib/noteSnapshots.js";
import { scheduleSyncOnSave } from "../lib/syncOnSave.js";
import { getNoteGitHistory, getNoteContentAtCommit } from "../lib/noteHistory.js";
import { contentHash } from "../lib/contentHash.js";
import { conflictCopyPath } from "../lib/gitSync.js";
import { logAudit } from "../lib/auditLog.js";
import { vaultSegmentError } from "../lib/vaultPaths.js";

// A name is one path segment: no "/", "..", ".git" (it becomes a file under the sync working copy).
const noteName = z.string().min(1).max(255).refine((n) => vaultSegmentError(n) === null, "invalid_name");

const createNoteSchema = z.object({
  name: noteName,
  folderId: z.string().uuid().nullable().optional(),
  content: z.string().default(""),
});

const updateNoteSchema = z.object({
  content: z.string().optional(),
  /**
   * SHA-256 (hex) of the text this edit started from. When it no longer matches the stored text (the note was changed
   * elsewhere meanwhile), the edit is not written over it: it is saved as a conflict copy next to the note instead.
   * Without it, the write is unconditional (collaborative editing, plugins, older clients).
   */
  baseHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /**
   * SHA-256 (hex) the stored text must still have, or nothing is written: 409 { error: "changed" }, no conflict copy.
   * For automatic edits (links rewritten after a rename) that should simply be retried on fresh text.
   */
  expectHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  frontmatter: z.record(z.any()).optional(),
  name: noteName.optional(),
  folderId: z.string().uuid().nullable().optional(),
});

const containingSchema = z.object({
  terms: z.array(z.string().min(1).max(255)).min(1).max(200),
});

const batchNotesSchema = z.object({
  noteIds: z.array(z.string().min(1)).max(250).optional(),
  paths: z.array(z.string().min(1)).max(250).optional(),
  all: z.boolean().optional(),
});

/** More notes than this matching one rename is unusual; the cap keeps one request bounded. */
const CONTAINING_LIMIT = 5000;

export default async function noteRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  async function assertVaultAccess(vaultId: string, userId: string, needsWrite = false) {
    const { role } = await requireVaultAccess(prisma, vaultId, userId);
    if (needsWrite && role === "viewer") {
      throw new VaultAccessError(403, "forbidden");
    }
    return role;
  }

  fastify.get("/:vid/notes/:nid", async (request, reply) => {
    const { vid, nid } = request.params as { vid: string; nid: string };
    try {
      await assertVaultAccess(vid, request.user!.id);
      const note = await prisma.note.findFirst({ where: { id: nid, vaultId: vid, deletedAt: null } });
      if (!note) return reply.code(404).send({ error: "not_found" });
      return reply.send(note);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  /**
   * Notes whose text contains any of the given terms (case-insensitive), with that text. The client uses it to find
   * the notes that may link to a renamed note without fetching every note (packages/core/src/link-rename.ts).
   */
  fastify.post("/:vid/notes/containing", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const parsed = containingSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      await assertVaultAccess(vid, request.user!.id);
      const notes = await prisma.note.findMany({
        where: {
          vaultId: vid,
          deletedAt: null,
          // Text or file name: a search word may match only the name.
          OR: parsed.data.terms.flatMap((term) => [
            { content: { contains: term, mode: "insensitive" as const } },
            { name: { contains: term, mode: "insensitive" as const } },
          ]),
        },
        select: { id: true, name: true, path: true, content: true },
        take: CONTAINING_LIMIT + 1,
      });
      // Past the cap the client cannot know which notes it missed: it says so and reads every note instead.
      const truncated = notes.length > CONTAINING_LIMIT;
      return reply.send({ notes: truncated ? notes.slice(0, CONTAINING_LIMIT) : notes, truncated });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  /**
   * Batch read note contents in one request. Used by plugins (scanVault, graph, dataview, vault-insights)
   * to avoid making individual HTTP requests for hundreds or thousands of notes (Bug #5).
   */
  fastify.post("/:vid/notes/batch", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const parsed = batchNotesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      await assertVaultAccess(vid, request.user!.id);
      const { noteIds, paths, all } = parsed.data;

      const where: Prisma.NoteWhereInput = {
        vaultId: vid,
        deletedAt: null,
      };

      if (!all) {
        if (noteIds && noteIds.length > 0) {
          where.id = { in: noteIds };
        } else if (paths && paths.length > 0) {
          where.path = { in: paths.map((p) => p.replace(/\\/g, "/")) };
        } else {
          return reply.send({ notes: [] });
        }
      }

      const notes = await prisma.note.findMany({
        where,
        select: { id: true, name: true, path: true, content: true },
        orderBy: { path: "asc" },
      });

      return reply.send({ notes });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.post("/:vid/notes", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const parsed = createNoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      await assertVaultAccess(vid, request.user!.id, true);
      const { name, folderId, content } = parsed.data;
      const path = await resolvePath(prisma, vid, folderId, name);

      const existing = await prisma.note.findUnique({ where: { vaultId_path: { vaultId: vid, path } } });
      if (existing) return reply.code(409).send({ error: "path_exists" });

      const note = await prisma.note.create({
        data: {
          vaultId: vid,
          folderId: folderId ?? null,
          name,
          path,
          content,
          sizeBytes: Buffer.byteLength(content, "utf8"),
          createdById: request.user!.id,
          updatedById: request.user!.id,
        },
      });
      await recomputeBacklinksForNote(prisma, vid, note.id, content);
      void scheduleSyncOnSave(prisma, vid);
      return reply.code(201).send(note);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      if (err instanceof Error && err.message === "folder_not_found") {
        return reply.code(400).send({ error: "folder_not_found" });
      }
      throw err;
    }
  });

  fastify.patch("/:vid/notes/:nid", async (request, reply) => {
    const { vid, nid } = request.params as { vid: string; nid: string };
    const parsed = updateNoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      await assertVaultAccess(vid, request.user!.id, true);
      const existing = await prisma.note.findFirst({ where: { id: nid, vaultId: vid, deletedAt: null } });
      if (!existing) return reply.code(404).send({ error: "not_found" });

      const { content, frontmatter, name, folderId, baseHash, expectHash } = parsed.data;

      if (expectHash && expectHash !== contentHash(existing.content)) {
        return reply.code(409).send({ error: "changed" });
      }

      if (content !== undefined && baseHash && baseHash !== contentHash(existing.content) && content !== existing.content) {
        // Changed elsewhere since this client read it: keep both. The client's text becomes "<name> (conflict …).md"
        // beside the note, which the conflict banner then offers to compare, use or discard.
        const slash = existing.path.lastIndexOf("/");
        const stem = existing.path.slice(0, existing.path.length - (existing.name.match(/\.[^.]+$/)?.[0].length ?? 0));
        const siblings = await prisma.note.findMany({ where: { vaultId: vid, path: { startsWith: `${stem} (conflict ` } }, select: { path: true } });
        const taken = new Set(siblings.map((n) => n.path));
        const copyPath = conflictCopyPath(existing.path, (candidate) => taken.has(candidate));
        const copyName = copyPath.slice(slash + 1);
        const copy = await prisma.note.create({
          data: {
            vaultId: vid,
            folderId: existing.folderId,
            name: copyName,
            path: copyPath,
            content,
            sizeBytes: Buffer.byteLength(content, "utf8"),
            createdById: request.user!.id,
            updatedById: request.user!.id,
          },
          select: { id: true, path: true, name: true },
        });
        await recomputeBacklinksForNote(prisma, vid, copy.id, content);
        logAudit(prisma, { userId: request.user!.id, action: "note_conflict", resourceType: "note", resourceId: nid, metadata: { copyId: copy.id }, ip: request.ip });
        void scheduleSyncOnSave(prisma, vid);
        return reply.code(409).send({ error: "stale", note: existing, copy });
      }

      let path = existing.path;
      const nextName = name ?? existing.name;
      const nextFolderId = folderId === undefined ? existing.folderId : folderId;
      if (name !== undefined || folderId !== undefined) {
        path = await resolvePath(prisma, vid, nextFolderId, nextName);
      }

      let note;
      try {
        note = await prisma.note.update({
          where: { id: nid },
          data: {
            ...(content !== undefined ? { content, sizeBytes: Buffer.byteLength(content, "utf8") } : {}),
            ...(frontmatter !== undefined ? { frontmatter } : {}),
            name: nextName,
            folderId: nextFolderId,
            path,
            updatedById: request.user!.id,
          },
        });
      } catch (err) {
        // A note (or trashed note) already occupies that path: report it instead of a 500.
        if (err && typeof err === "object" && (err as { code?: string }).code === "P2002") {
          return reply.code(409).send({ error: "path_exists" });
        }
        throw err;
      }
      if (content !== undefined) {
        await recomputeBacklinksForNote(prisma, vid, note.id, content);
      }
      void scheduleSyncOnSave(prisma, vid);
      return reply.send(note);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      if (err instanceof Error && err.message === "folder_not_found") {
        return reply.code(400).send({ error: "folder_not_found" });
      }
      throw err;
    }
  });

  fastify.get("/:vid/notes/:nid/backlinks", async (request, reply) => {
    const { vid, nid } = request.params as { vid: string; nid: string };
    try {
      await assertVaultAccess(vid, request.user!.id);
      const backlinks = await prisma.backlink.findMany({
        where: { targetNoteId: nid, vaultId: vid, sourceNote: { deletedAt: null } },
        include: { sourceNote: { select: { id: true, name: true, path: true } } },
      });
      return reply.send(
        backlinks.map((b) => ({ ...b.sourceNote, linkType: b.linkType }))
      );
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  // D5 — File Recovery / Time Scrubber: periodic content snapshots (written by
  // the recurring sync-worker job, see lib/noteSnapshots.ts), not per-save.
  fastify.get("/:vid/notes/:nid/snapshots", async (request, reply) => {
    const { vid, nid } = request.params as { vid: string; nid: string };
    try {
      await assertVaultAccess(vid, request.user!.id);
      const note = await prisma.note.findFirst({ where: { id: nid, vaultId: vid } });
      if (!note) return reply.code(404).send({ error: "not_found" });
      return reply.send(await listSnapshots(prisma, nid));
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.get("/:vid/notes/:nid/snapshots/:sid", async (request, reply) => {
    const { vid, nid, sid } = request.params as { vid: string; nid: string; sid: string };
    try {
      await assertVaultAccess(vid, request.user!.id);
      const note = await prisma.note.findFirst({ where: { id: nid, vaultId: vid } });
      if (!note) return reply.code(404).send({ error: "not_found" });
      const content = await getSnapshotContent(prisma, nid, sid);
      if (content === null) return reply.code(404).send({ error: "not_found" });
      return reply.send({ content });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  // D6 — Note History via git log, only available when the vault has a
  // configured git sync-connection with a working copy that's already been
  // synced at least once (see lib/noteHistory.ts's doc comment for why no
  // hidden per-vault git repo is created just for this).
  fastify.get("/:vid/notes/:nid/history", async (request, reply) => {
    const { vid, nid } = request.params as { vid: string; nid: string };
    try {
      await assertVaultAccess(vid, request.user!.id);
      const note = await prisma.note.findFirst({ where: { id: nid, vaultId: vid } });
      if (!note) return reply.code(404).send({ error: "not_found" });
      const result = await getNoteGitHistory(prisma, vid, note.path);
      return reply.send(result);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.get("/:vid/notes/:nid/history/:hash", async (request, reply) => {
    const { vid, nid, hash } = request.params as { vid: string; nid: string; hash: string };
    try {
      await assertVaultAccess(vid, request.user!.id);
      const note = await prisma.note.findFirst({ where: { id: nid, vaultId: vid } });
      if (!note) return reply.code(404).send({ error: "not_found" });
      const content = await getNoteContentAtCommit(prisma, vid, note.path, hash);
      if (content === null) return reply.code(404).send({ error: "not_found" });
      return reply.send({ content });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.delete("/:vid/notes/:nid", async (request, reply) => {
    const { vid, nid } = request.params as { vid: string; nid: string };
    try {
      await assertVaultAccess(vid, request.user!.id, true);
      const existing = await prisma.note.findFirst({ where: { id: nid, vaultId: vid, deletedAt: null } });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      await trashNote(prisma, nid);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
