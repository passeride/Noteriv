import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";

const openTabSchema = z.object({
  noteId: z.string().uuid(),
  path: z.string(),
  name: z.string(),
});

const updateStateSchema = z.object({
  openTabs: z.array(openTabSchema).optional(),
  activeTabId: z.string().uuid().nullable().optional(),
  pinnedTabIds: z.array(z.string().uuid()).optional(),
  fileViewModes: z.record(z.string(), z.enum(["live", "source", "view"])).optional(),
});

const EMPTY_STATE = {
  openTabs: [] as unknown as object,
  activeTabId: null as string | null,
  pinnedTabIds: [] as unknown as object,
  fileViewModes: {} as object,
};

/** Most note text inlined into one workspace-state response (characters); the rest is fetched per note. */
const INLINE_NOTES_BUDGET = 2_000_000;

export default async function userVaultStateRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  // Per-user workspace state (open tabs, active tab, pinned tabs, per-note
  // view mode) — private to the requesting user, not shared vault config.
  // Any vault role (including viewer) may read/write their own state.
  fastify.get("/:vid/workspace-state", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      await requireVaultAccess(prisma, vid, request.user!.id);
      const state = await prisma.userVaultState.findUnique({
        where: { vaultId_userId: { vaultId: vid, userId: request.user!.id } },
      });
      if (!state) return reply.send(EMPTY_STATE);

      // The open tabs' notes come along, so restoring the workspace is one round trip instead of
      // two (state, then every note). Ids not returned under `notes` but listed in `missingNoteIds`
      // are gone (deleted/trashed); anything else past the size budget is fetched by the client as before.
      const tabIds = (Array.isArray(state.openTabs) ? (state.openTabs as Array<{ noteId?: unknown }>) : [])
        .map((t) => t?.noteId)
        .filter((id): id is string => typeof id === "string");
      const found = tabIds.length
        ? await prisma.note.findMany({
            where: { id: { in: tabIds }, vaultId: vid, deletedAt: null },
            select: { id: true, path: true, name: true, content: true },
          })
        : [];
      const byId = new Map(found.map((n) => [n.id, n]));
      const ordered = [...tabIds].sort((a, b) => (a === state.activeTabId ? -1 : b === state.activeTabId ? 1 : 0));
      const notes: Record<string, { id: string; path: string; name: string; content: string }> = {};
      let budget = INLINE_NOTES_BUDGET;
      for (const id of ordered) {
        const n = byId.get(id);
        if (!n || n.content.length > budget) continue;
        budget -= n.content.length;
        notes[id] = n;
      }
      return reply.send({
        openTabs: state.openTabs,
        activeTabId: state.activeTabId,
        pinnedTabIds: state.pinnedTabIds,
        fileViewModes: state.fileViewModes,
        notes,
        missingNoteIds: tabIds.filter((id) => !byId.has(id)),
      });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.put("/:vid/workspace-state", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const parsed = updateStateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      await requireVaultAccess(prisma, vid, request.user!.id);
      const data = parsed.data;
      const state = await prisma.userVaultState.upsert({
        where: { vaultId_userId: { vaultId: vid, userId: request.user!.id } },
        create: {
          vaultId: vid,
          userId: request.user!.id,
          openTabs: data.openTabs ?? [],
          activeTabId: data.activeTabId ?? null,
          pinnedTabIds: data.pinnedTabIds ?? [],
          fileViewModes: data.fileViewModes ?? {},
        },
        update: {
          ...(data.openTabs !== undefined ? { openTabs: data.openTabs } : {}),
          ...(data.activeTabId !== undefined ? { activeTabId: data.activeTabId } : {}),
          ...(data.pinnedTabIds !== undefined ? { pinnedTabIds: data.pinnedTabIds } : {}),
          ...(data.fileViewModes !== undefined ? { fileViewModes: data.fileViewModes } : {}),
        },
      });
      return reply.send({
        openTabs: state.openTabs,
        activeTabId: state.activeTabId,
        pinnedTabIds: state.pinnedTabIds,
        fileViewModes: state.fileViewModes,
      });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
