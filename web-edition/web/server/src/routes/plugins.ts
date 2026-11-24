import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { logAudit } from "../lib/auditLog.js";

const ALLOWED_PERMISSIONS = [
  "vault:read",
  "vault:write",
  "editor:read",
  "editor:write",
  "ui:commands",
  "ui:statusbar",
  "ui:panel",
  "markdown:render",
] as const;

const manifestSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, "plugin id must be kebab-case"),
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(50),
  description: z.string().max(2000).default(""),
  author: z.string().max(200).default(""),
  main: z.string().min(1).max(200).default("main.js"),
  permissions: z.array(z.enum(ALLOWED_PERMISSIONS)).default([]),
});

const installSchema = z.object({
  manifest: manifestSchema,
  mainJs: z.string().min(1).max(500_000), // 500KB ceiling for a plugin's source
});

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  // The user can grant/revoke permissions after install (e.g. a manually pasted plugin whose
  // manifest declared none). Only values from ALLOWED_PERMISSIONS are accepted.
  permissions: z.array(z.enum(ALLOWED_PERMISSIONS)).optional(),
  settings: z.record(z.any()).optional(),
});

export default async function pluginRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/:vid/plugins", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      await requireVaultAccess(prisma, vid, request.user!.id);
      const plugins = await prisma.plugin.findMany({ where: { vaultId: vid } });
      return reply.send(plugins);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.post("/:vid/plugins/install", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const parsed = installSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    }
    try {
      const { role } = await requireVaultAccess(prisma, vid, request.user!.id);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });

      const { manifest, mainJs } = parsed.data;
      const plugin = await prisma.plugin.upsert({
        where: { vaultId_pluginId: { vaultId: vid, pluginId: manifest.id } },
        create: { vaultId: vid, pluginId: manifest.id, manifest, mainJs, enabled: true },
        update: { manifest, mainJs },
      });
      logAudit(prisma, { userId: request.user!.id, action: "plugin_installed", resourceType: "plugin", resourceId: plugin.id, metadata: { pluginId: manifest.id, permissions: manifest.permissions }, ip: request.ip });
      return reply.code(201).send(plugin);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.patch("/:vid/plugins/:pid", async (request, reply) => {
    const { vid, pid } = request.params as { vid: string; pid: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      const { role } = await requireVaultAccess(prisma, vid, request.user!.id);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });

      const existing = await prisma.plugin.findFirst({ where: { id: pid, vaultId: vid } });
      if (!existing) return reply.code(404).send({ error: "not_found" });

      const plugin = await prisma.plugin.update({
        where: { id: pid },
        data: {
          ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
          ...(parsed.data.permissions !== undefined
            ? { manifest: { ...(existing.manifest as object), permissions: parsed.data.permissions } }
            : {}),
          ...(parsed.data.settings !== undefined
            ? { settings: { ...(existing.settings as object), ...parsed.data.settings } }
            : {}),
        },
      });
      if (parsed.data.permissions !== undefined) {
        logAudit(prisma, { userId: request.user!.id, action: "plugin_permissions_changed", resourceType: "plugin", resourceId: pid, metadata: { pluginId: existing.pluginId, permissions: parsed.data.permissions }, ip: request.ip });
      }
      return reply.send(plugin);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.delete("/:vid/plugins/:pid", async (request, reply) => {
    const { vid, pid } = request.params as { vid: string; pid: string };
    try {
      const { role } = await requireVaultAccess(prisma, vid, request.user!.id);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });
      const existing = await prisma.plugin.findFirst({ where: { id: pid, vaultId: vid } });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      await prisma.plugin.delete({ where: { id: pid } });
      logAudit(prisma, { userId: request.user!.id, action: "plugin_deleted", resourceType: "plugin", resourceId: pid, ip: request.ip });
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
