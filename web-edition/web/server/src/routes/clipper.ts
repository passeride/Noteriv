import type { FastifyInstance } from "fastify";
import { z } from "zod";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomBytes } from "node:crypto";
import TurndownService from "turndown";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { logAudit } from "../lib/auditLog.js";
import { requireVerifiedEmail } from "../lib/emailGate.js";

// Web clipper: a bookmarklet on any page POSTs the selection/article to /api/v1/clip
// with a personal clip token. The token is deliberately weak in power: it can only
// create notes in one vault. Only its SHA-256 is stored; the plaintext is shown once.

const TOKEN_PREFIX = "ntc_";
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const createTokenSchema = z.object({
  name: z.string().min(1).max(80),
  vaultId: z.string().uuid(),
});

/** Token management for the signed-in user (cookie-authenticated, normal CORS). */
export async function clipTokenRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/me/clip-tokens", async (request, reply) => {
    const tokens = await prisma.clipToken.findMany({
      where: { userId: request.user!.id },
      orderBy: { createdAt: "desc" },
      include: { vault: { select: { name: true } } },
    });
    return reply.send(
      tokens.map((t) => ({
        id: t.id,
        name: t.name,
        vaultId: t.vaultId,
        vaultName: t.vault.name,
        tokenHint: t.tokenHint,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
      }))
    );
  });

  fastify.post("/me/clip-tokens", { preHandler: requireVerifiedEmail(prisma, "clip_token_create") }, async (request, reply) => {
    const parsed = createTokenSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      const { role } = await requireVaultAccess(prisma, parsed.data.vaultId, request.user!.id);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });

      const count = await prisma.clipToken.count({ where: { userId: request.user!.id } });
      if (count >= 20) return reply.code(409).send({ error: "too_many_tokens" });

      const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
      const row = await prisma.clipToken.create({
        data: {
          userId: request.user!.id,
          vaultId: parsed.data.vaultId,
          name: parsed.data.name,
          tokenHash: hashToken(token),
          tokenHint: token.slice(-4),
        },
      });
      logAudit(prisma, { userId: request.user!.id, action: "clip_token_created", resourceType: "vault", resourceId: parsed.data.vaultId, metadata: { tokenId: row.id }, ip: request.ip });
      // The only time the plaintext token is ever returned.
      return reply.code(201).send({ id: row.id, name: row.name, vaultId: row.vaultId, tokenHint: row.tokenHint, token });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.delete("/me/clip-tokens/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = await prisma.clipToken.findFirst({ where: { id, userId: request.user!.id } });
    if (!row) return reply.code(404).send({ error: "not_found" });
    await prisma.clipToken.delete({ where: { id } });
    logAudit(prisma, { userId: request.user!.id, action: "clip_token_revoked", resourceType: "vault", resourceId: row.vaultId, metadata: { tokenId: id }, ip: request.ip });
    return reply.send({ ok: true });
  });
}

const clipSchema = z.object({
  title: z.string().max(300).default(""),
  url: z.string().max(2000).default(""),
  html: z.string().max(1_500_000).optional(),
  text: z.string().max(500_000).optional(),
});

// turndown parses HTML with its own DOM implementation in Node; this is the only part of it we touch.
interface TdElement {
  getAttribute(name: string): string | null;
}

function makeTurndown(baseUrl: string): TurndownService {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.remove(["script", "style", "noscript", "iframe", "object", "embed", "svg", "form", "nav", "footer"]);
  const abs = (href: string | null) => {
    if (!href) return "";
    try {
      return new URL(href, baseUrl || undefined).toString();
    } catch {
      return href;
    }
  };
  // Relative links/images only make sense on the original site: make them absolute.
  td.addRule("absolute-links", {
    filter: "a",
    replacement: (content, node) => {
      const href = abs((node as unknown as TdElement).getAttribute("href"));
      return href && /^https?:/i.test(href) ? `[${content}](${href})` : content;
    },
  });
  td.addRule("absolute-images", {
    filter: "img",
    replacement: (_c, node) => {
      const el = node as unknown as TdElement;
      const src = abs(el.getAttribute("src"));
      return src && /^https?:/i.test(src) ? `![${(el.getAttribute("alt") ?? "").replace(/[\[\]]/g, "")}](${src})` : "";
    },
  });
  return td;
}

function safeFileName(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return cleaned || `Clip ${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Public clip endpoint, called cross-origin from arbitrary pages by the bookmarklet.
 * It must be registered BEFORE the app-wide CORS plugin (see index.ts) so it keeps
 * its own wide-open CORS; that is safe because it never uses cookies — authority comes
 * solely from the bearer token.
 */
export async function clipPublicRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;

  // Keyed by client IP: keying by the Authorization header let anyone get a fresh bucket per
  // made-up token. 120/hour per address is plenty for a person clipping pages.
  await fastify.register(rateLimit, {
    max: 120,
    timeWindow: "1 hour",
    keyGenerator: (req) => req.ip,
  });

  fastify.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "authorization, content-type");
    reply.header("Access-Control-Max-Age", "86400");
    if (request.method === "OPTIONS") return reply.code(204).send();
  });

  fastify.options("/", async (_req, reply) => reply.code(204).send());

  fastify.post("/", { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const auth = request.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token.startsWith(TOKEN_PREFIX)) return reply.code(401).send({ error: "unauthorized" });

    const row = await prisma.clipToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { lockedAt: true } } } });
    if (!row) return reply.code(401).send({ error: "unauthorized" });
    // A locked account's bookmarklets stop too, like its sessions.
    if (row.user.lockedAt) return reply.code(403).send({ error: "account_locked" });

    // The token carries its creator's authority, which can change after it was issued: someone
    // removed from the vault, or demoted to viewer, must not keep writing into it through an old token.
    try {
      const { role } = await requireVaultAccess(prisma, row.vaultId, row.userId);
      if (role === "viewer") return reply.code(403).send({ error: "forbidden" });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(403).send({ error: "forbidden" });
      throw err;
    }

    const parsed = clipSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const { title, url, html, text } = parsed.data;
    if (!html && !text) return reply.code(400).send({ error: "empty_clip" });

    const body = html ? makeTurndown(url).turndown(html).trim() : (text ?? "").trim();
    const heading = title.trim() || url || "Clipping";
    const clipped = new Date().toISOString();
    const content = `---\nsource: ${JSON.stringify(url)}\nclipped: ${clipped}\n---\n\n# ${heading.replace(/\n/g, " ")}\n\n${body}\n`;

    // Clippings/ folder, created on first use.
    let folder = await prisma.folder.findFirst({ where: { vaultId: row.vaultId, path: "Clippings", deletedAt: null } });
    if (!folder) {
      folder = await prisma.folder.create({ data: { vaultId: row.vaultId, parentId: null, name: "Clippings", path: "Clippings" } });
    }

    const base = safeFileName(title);
    let name = `${base}.md`;
    for (let i = 2; await prisma.note.findUnique({ where: { vaultId_path: { vaultId: row.vaultId, path: `Clippings/${name}` } } }); i++) {
      name = `${base} (${i}).md`;
    }
    const note = await prisma.note.create({
      data: {
        vaultId: row.vaultId,
        folderId: folder.id,
        name,
        path: `Clippings/${name}`,
        content,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        createdById: row.userId,
        updatedById: row.userId,
      },
    });
    await prisma.clipToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return reply.code(201).send({ ok: true, path: note.path });
  });
}
