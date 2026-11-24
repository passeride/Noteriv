import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireVaultAccess, VaultAccessError } from "../lib/vaultAccess.js";
import { encryptJson, decryptJson } from "../lib/crypto.js";
import { testGitRemote, getRemoteState } from "../lib/gitSync.js";
import { webdavTest } from "../lib/webdavSync.js";
import { syncQueue } from "../lib/syncQueue.js";
import { logAudit } from "../lib/auditLog.js";
import { requireVerifiedEmail } from "../lib/emailGate.js";
import { checkLimit, ownerOfVault, PlanLimitError, planLimitReply } from "../lib/plans.js";
import { SCRATCH_ROOT } from "../lib/syncRunner.js";
import path from "node:path";
import { isSafeBranch } from "../lib/vaultPaths.js";
import { privateRemotesAllowed } from "../lib/remoteHost.js";
import {
  GithubApiError,
  githubUser,
  githubListRepos,
  githubCreateRepo,
  githubListBranches,
  isGithubRemote,
} from "../lib/githubApi.js";

const commonFields = {
  direction: z.enum(["push", "pull", "both"]).default("both"),
  autoSync: z.boolean().default(false),
  syncIntervalMinutes: z.number().int().min(1).max(1440).default(10),
  commitTemplate: z.string().min(1).max(200).default("Sync notes {date}"),
  syncOnSave: z.boolean().default(false),
  pullOnOpen: z.boolean().default(false),
};

// Remotes are HTTPS URLs (no file://, ssh, or other transports into the worker), and branch names follow git's
// rules and can never be read as a git option.
// A self-hosted server that sets SYNC_ALLOW_PRIVATE_REMOTES=1 (Gitea or WebDAV on its own network) may use http://.
const httpsUrl = z
  .string()
  .url()
  .refine((u) => /^https:\/\//i.test(u) || (privateRemotesAllowed() && /^http:\/\//i.test(u)), "https_only");
const branchName = z.string().min(1).max(200).refine(isSafeBranch, "invalid_branch");

const gitProviderSchema = z.object({
  providerType: z.enum(["github", "gitlab", "gitea", "forgejo"]),
  remoteUrl: httpsUrl,
  branch: branchName.default("main"),
  username: z.string().max(200).default(""),
  token: z.string().min(1).max(2000),
  ...commonFields,
});

const webdavProviderSchema = z.object({
  providerType: z.literal("webdav"),
  webdavUrl: z.string().url(),
  webdavPath: z.string().max(500).default("/"),
  username: z.string().max(200),
  password: z.string().min(1).max(2000),
  ...commonFields,
});

const createSchema = z.union([gitProviderSchema, webdavProviderSchema]);

const patchSchema = z.object({
  remoteUrl: httpsUrl.optional(),
  branch: branchName.optional(),
  username: z.string().max(200).optional(),
  token: z.string().min(1).max(2000).optional(),
  webdavUrl: z.string().url().optional(),
  webdavPath: z.string().max(500).optional(),
  password: z.string().min(1).max(2000).optional(),
  direction: z.enum(["push", "pull", "both"]).optional(),
  autoSync: z.boolean().optional(),
  syncIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  commitTemplate: z.string().min(1).max(200).optional(),
  syncOnSave: z.boolean().optional(),
  pullOnOpen: z.boolean().optional(),
});

const tokenSource = z.object({
  token: z.string().min(1).max(2000).optional(),
  connectionId: z.string().uuid().optional(),
});

// A connection's row is safe to return to the client once its encrypted
// credentials blob is stripped — never send that back, even to the owner.
function toPublic(conn: Record<string, unknown>) {
  // syncState is internal bookkeeping (one entry per file) — no use to the client, and large.
  const { credentialsEncrypted: _omit, syncState: _state, ...rest } = conn;
  return rest;
}

/** Validates a GitHub token and returns the account it belongs to, or throws a 400-shaped error. */
async function checkGithubToken(token: string) {
  try {
    return await githubUser(token);
  } catch (err) {
    if (err instanceof GithubApiError && (err.status === 401 || err.status === 403)) {
      throw new TokenError("invalid_token", "GitHub từ chối token này (sai hoặc đã hết hạn).");
    }
    // Network failure / GitHub outage: don't block saving a connection over a
    // convenience lookup (account name/avatar) — the first sync will surface real problems.
    return null;
  }
}

class BadRequestError extends Error {}

class TokenError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export default async function syncConnectionRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);

  async function writableVault(vid: string, userId: string) {
    const { role } = await requireVaultAccess(prisma, vid, userId);
    if (role === "viewer") throw new VaultAccessError(403, "forbidden");
  }

  fastify.get("/:vid/sync-connections", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      await requireVaultAccess(prisma, vid, request.user!.id);
      const conns = await prisma.syncConnection.findMany({ where: { vaultId: vid } });
      return reply.send(conns.map(toPublic));
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.post("/:vid/sync-connections", { preHandler: requireVerifiedEmail(prisma, "sync_connection_create") }, async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      await writableVault(vid, request.user!.id);
      const owner = await ownerOfVault(prisma, vid);
      if (owner) await checkLimit(prisma, owner, "syncConnections");

      const data = parsed.data;
      const shared = {
        vaultId: vid,
        direction: data.direction,
        autoSync: data.autoSync,
        syncIntervalMinutes: data.syncIntervalMinutes,
        commitTemplate: data.commitTemplate,
        syncOnSave: data.syncOnSave,
        pullOnOpen: data.pullOnOpen,
      };

      if (data.providerType === "webdav") {
        const conn = await prisma.syncConnection.create({
          data: {
            ...shared,
            providerType: "webdav",
            webdavUrl: data.webdavUrl,
            webdavPath: data.webdavPath,
            credentialsEncrypted: encryptJson({ username: data.username, password: data.password }),
          },
        });
        logAudit(prisma, { userId: request.user!.id, action: "sync_connection_created", resourceType: "syncConnection", resourceId: conn.id, metadata: { providerType: "webdav" }, ip: request.ip });
        return reply.code(201).send(toPublic(conn));
      }

      const account = isGithubRemote(data.remoteUrl) ? await checkGithubToken(data.token) : null;
      const conn = await prisma.syncConnection.create({
        data: {
          ...shared,
          providerType: data.providerType,
          remoteUrl: data.remoteUrl,
          branch: data.branch,
          authUsername: data.username,
          accountLogin: account?.login ?? null,
          accountAvatarUrl: account?.avatarUrl ?? null,
          credentialsEncrypted: encryptJson({ username: data.username, token: data.token }),
        },
      });
      logAudit(prisma, { userId: request.user!.id, action: "sync_connection_created", resourceType: "syncConnection", resourceId: conn.id, metadata: { providerType: data.providerType }, ip: request.ip });
      return reply.code(201).send(toPublic(conn));
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      if (err instanceof PlanLimitError) return planLimitReply(reply, err);
      if (err instanceof TokenError) return reply.code(400).send({ error: err.code, message: err.message });
      throw err;
    }
  });

  fastify.patch("/:vid/sync-connections/:cid", async (request, reply) => {
    const { vid, cid } = request.params as { vid: string; cid: string };
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    try {
      await writableVault(vid, request.user!.id);
      const existing = await prisma.syncConnection.findFirst({ where: { id: cid, vaultId: vid } });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      const p = parsed.data;
      const isWebdav = existing.providerType === "webdav";

      const data: Record<string, unknown> = {};
      for (const key of ["direction", "autoSync", "syncIntervalMinutes", "commitTemplate", "syncOnSave", "pullOnOpen"] as const) {
        if (p[key] !== undefined) data[key] = p[key];
      }

      if (isWebdav) {
        if (p.webdavUrl !== undefined) data.webdavUrl = p.webdavUrl;
        if (p.webdavPath !== undefined) data.webdavPath = p.webdavPath;
        // Another server or folder: the per-file record of the last sync no longer applies.
        if ((p.webdavUrl !== undefined && p.webdavUrl !== existing.webdavUrl) || (p.webdavPath !== undefined && p.webdavPath !== existing.webdavPath)) {
          data.syncState = Prisma.DbNull;
        }
        if (p.password !== undefined || p.username !== undefined) {
          const old = decryptJson<{ username: string; password: string }>(existing.credentialsEncrypted);
          data.credentialsEncrypted = encryptJson({
            username: p.username ?? old.username,
            password: p.password ?? old.password,
          });
        }
      } else {
        if (p.remoteUrl !== undefined) data.remoteUrl = p.remoteUrl;
        if (p.branch !== undefined) data.branch = p.branch;
        if (p.username !== undefined) data.authUsername = p.username;
        const old = decryptJson<{ username: string; token: string }>(existing.credentialsEncrypted);
        const nextToken = p.token ?? old.token;
        const nextUser = p.username ?? old.username;
        if (p.token !== undefined || p.username !== undefined) {
          data.credentialsEncrypted = encryptJson({ username: nextUser, token: nextToken });
        }
        const nextRemote = (p.remoteUrl ?? existing.remoteUrl) as string;
        if (p.token !== undefined || p.remoteUrl !== undefined) {
          const account = isGithubRemote(nextRemote) ? await checkGithubToken(nextToken) : null;
          data.accountLogin = account?.login ?? null;
          data.accountAvatarUrl = account?.avatarUrl ?? null;
        }
      }

      const conn = await prisma.syncConnection.update({ where: { id: cid }, data });
      logAudit(prisma, { userId: request.user!.id, action: "sync_connection_updated", resourceType: "syncConnection", resourceId: cid, metadata: { fields: Object.keys(parsed.data) }, ip: request.ip });
      return reply.send(toPublic(conn));
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      if (err instanceof TokenError) return reply.code(400).send({ error: err.code, message: err.message });
      throw err;
    }
  });

  fastify.delete("/:vid/sync-connections/:cid", async (request, reply) => {
    const { vid, cid } = request.params as { vid: string; cid: string };
    try {
      await writableVault(vid, request.user!.id);
      const existing = await prisma.syncConnection.findFirst({ where: { id: cid, vaultId: vid } });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      await prisma.syncConnection.delete({ where: { id: cid } });
      logAudit(prisma, { userId: request.user!.id, action: "sync_connection_deleted", resourceType: "syncConnection", resourceId: cid, ip: request.ip });
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.post("/:vid/sync-connections/:cid/test", async (request, reply) => {
    const { vid, cid } = request.params as { vid: string; cid: string };
    try {
      await requireVaultAccess(prisma, vid, request.user!.id);
      const conn = await prisma.syncConnection.findFirst({ where: { id: cid, vaultId: vid } });
      if (!conn) return reply.code(404).send({ error: "not_found" });

      if (conn.providerType === "webdav") {
        const creds = decryptJson<{ username: string; password: string }>(conn.credentialsEncrypted);
        const result = await webdavTest({ url: conn.webdavUrl!, remotePath: conn.webdavPath ?? "/", ...creds });
        return reply.send(result);
      }
      const creds = decryptJson<{ username: string; token: string }>(conn.credentialsEncrypted);
      const result = await testGitRemote(conn.remoteUrl!, creds.token ? creds : null);
      return reply.send(result);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.post("/:vid/sync-connections/:cid/trigger", async (request, reply) => {
    const { vid, cid } = request.params as { vid: string; cid: string };
    try {
      await writableVault(vid, request.user!.id);
      const conn = await prisma.syncConnection.findFirst({ where: { id: cid, vaultId: vid } });
      if (!conn) return reply.code(404).send({ error: "not_found" });

      await syncQueue.add("sync", { connectionId: cid, mode: "sync" }, { removeOnComplete: 50, removeOnFail: 50 });
      logAudit(prisma, { userId: request.user!.id, action: "sync_triggered", resourceType: "syncConnection", resourceId: cid, ip: request.ip });
      return reply.send({ ok: true, queued: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  // Conflict resolution: the user picks which side wins. Only valid right after a
  // `conflict` job — guards against someone firing a destructive "take remote" at a
  // healthy connection.
  fastify.post("/:vid/sync-connections/:cid/resolve", async (request, reply) => {
    const { vid, cid } = request.params as { vid: string; cid: string };
    const parsed = z.object({ strategy: z.enum(["web", "remote"]) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      await writableVault(vid, request.user!.id);
      const conn = await prisma.syncConnection.findFirst({ where: { id: cid, vaultId: vid } });
      if (!conn) return reply.code(404).send({ error: "not_found" });
      if (conn.providerType === "webdav") return reply.code(400).send({ error: "git_only" });
      const latest = await prisma.syncJob.findFirst({ where: { syncConnectionId: cid }, orderBy: { createdAt: "desc" } });
      if (latest?.status !== "conflict") return reply.code(409).send({ error: "no_conflict" });

      await syncQueue.add(
        "sync",
        { connectionId: cid, mode: parsed.data.strategy === "web" ? "resolve-web" : "resolve-remote" },
        { removeOnComplete: 50, removeOnFail: 50 }
      );
      logAudit(prisma, { userId: request.user!.id, action: "sync_conflict_resolved", resourceType: "syncConnection", resourceId: cid, metadata: { strategy: parsed.data.strategy }, ip: request.ip });
      return reply.send({ ok: true, queued: true });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  // "Pull on open": the editor calls this once when a vault is opened; connections
  // that opted in get a sync queued unless one just ran.
  fastify.post("/:vid/sync-connections/pull-on-open", async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      await writableVault(vid, request.user!.id);
      const conns = await prisma.syncConnection.findMany({
        where: { vaultId: vid, pullOnOpen: true, direction: { not: "push" } },
        select: { id: true, lastSyncedAt: true },
      });
      let queued = 0;
      for (const c of conns) {
        if (c.lastSyncedAt && Date.now() - c.lastSyncedAt.getTime() < 2 * 60_000) continue;
        const latest = await prisma.syncJob.findFirst({ where: { syncConnectionId: c.id }, orderBy: { createdAt: "desc" } });
        if (latest && (latest.status === "running" || latest.status === "queued" || latest.status === "conflict")) continue;
        await syncQueue.add("sync", { connectionId: c.id, mode: "sync" }, { removeOnComplete: 50, removeOnFail: 50 });
        queued++;
      }
      return reply.send({ ok: true, queued });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.get("/:vid/sync-connections/:cid/status", async (request, reply) => {
    const { vid, cid } = request.params as { vid: string; cid: string };
    const withRemote = (request.query as { remote?: string }).remote === "1";
    try {
      await requireVaultAccess(prisma, vid, request.user!.id);
      const conn = await prisma.syncConnection.findFirst({ where: { id: cid, vaultId: vid } });
      if (!conn) return reply.code(404).send({ error: "not_found" });
      const latestJob = await prisma.syncJob.findFirst({
        where: { syncConnectionId: cid },
        orderBy: { createdAt: "desc" },
      });
      // Notes edited on the web since the last successful sync = what the next push would carry.
      const changesSinceSync = await prisma.note.count({
        where: { vaultId: vid, deletedAt: null, ...(conn.lastSyncedAt ? { updatedAt: { gt: conn.lastSyncedAt } } : {}) },
      });
      let remote: { remoteChanged: boolean; remoteReachable: boolean; error?: string } | null = null;
      if (withRemote && conn.providerType !== "webdav") {
        const creds = decryptJson<{ username: string; token: string }>(conn.credentialsEncrypted);
        remote = await getRemoteState(
          path.resolve(SCRATCH_ROOT, cid),
          conn.remoteUrl!,
          conn.branch,
          creds.token ? creds : null
        );
      }
      return reply.send({ connection: toPublic(conn), latestJob, changesSinceSync, remote });
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  fastify.get("/:vid/sync-connections/:cid/log", async (request, reply) => {
    const { vid, cid } = request.params as { vid: string; cid: string };
    try {
      await requireVaultAccess(prisma, vid, request.user!.id);
      const conn = await prisma.syncConnection.findFirst({ where: { id: cid, vaultId: vid } });
      if (!conn) return reply.code(404).send({ error: "not_found" });
      const jobs = await prisma.syncJob.findMany({
        where: { syncConnectionId: cid },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      return reply.send(jobs);
    } catch (err) {
      if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });

  // ── GitHub helpers (token check, repo picker, create repo, branches) ──
  // `token` may be sent directly (before any connection exists) or resolved from
  // an existing connection via `connectionId`. The token never goes back out.

  async function resolveGithubToken(vid: string, userId: string, body: unknown): Promise<string> {
    const parsed = tokenSource.safeParse(body);
    if (!parsed.success) throw new BadRequestError("invalid_body");
    await writableVault(vid, userId);
    if (parsed.data.token) return parsed.data.token;
    if (parsed.data.connectionId) {
      const conn = await prisma.syncConnection.findFirst({ where: { id: parsed.data.connectionId, vaultId: vid } });
      if (!conn || conn.providerType === "webdav") throw new VaultAccessError(404, "not_found");
      const creds = decryptJson<{ token: string }>(conn.credentialsEncrypted);
      if (creds.token) return creds.token;
    }
    throw new BadRequestError("token_required");
  }

  function githubFailure(err: unknown, reply: import("fastify").FastifyReply) {
    if (err instanceof VaultAccessError) return reply.code(err.statusCode).send({ error: err.message });
    if (err instanceof BadRequestError) return reply.code(400).send({ error: err.message });
    if (err instanceof GithubApiError) {
      const code = err.status === 401 || err.status === 403 ? 400 : err.status === 0 ? 502 : err.status === 422 ? 422 : 502;
      const badToken = err.status === 401 || err.status === 403;
      return reply.code(code).send({
        error: badToken ? "invalid_token" : "github_error",
        message: badToken ? "GitHub từ chối token này (sai, hết hạn hoặc thiếu quyền repo)." : err.message,
      });
    }
    throw err;
  }

  // The GitHub helpers call api.github.com with a token the user pastes: the same rule as creating a connection.
  const githubGuard = { preHandler: requireVerifiedEmail(prisma, "github_api") };

  fastify.post("/:vid/github/user", githubGuard, async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      const token = await resolveGithubToken(vid, request.user!.id, request.body);
      return reply.send(await githubUser(token));
    } catch (err) {
      return githubFailure(err, reply);
    }
  });

  fastify.post("/:vid/github/repos", githubGuard, async (request, reply) => {
    const { vid } = request.params as { vid: string };
    try {
      const token = await resolveGithubToken(vid, request.user!.id, request.body);
      const page = Number((request.body as { page?: number }).page ?? 1) || 1;
      return reply.send(await githubListRepos(token, page));
    } catch (err) {
      return githubFailure(err, reply);
    }
  });

  fastify.post("/:vid/github/repos/create", githubGuard, async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const body = z
      .object({ name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/), private: z.boolean().default(true) })
      .safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      const token = await resolveGithubToken(vid, request.user!.id, request.body);
      const repo = await githubCreateRepo(token, body.data.name, body.data.private);
      logAudit(prisma, { userId: request.user!.id, action: "github_repo_created", resourceType: "vault", resourceId: vid, metadata: { repo: repo.fullName }, ip: request.ip });
      return reply.code(201).send(repo);
    } catch (err) {
      return githubFailure(err, reply);
    }
  });

  fastify.post("/:vid/github/branches", githubGuard, async (request, reply) => {
    const { vid } = request.params as { vid: string };
    const body = z.object({ fullName: z.string().max(200) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    try {
      const token = await resolveGithubToken(vid, request.user!.id, request.body);
      return reply.send(await githubListBranches(token, body.data.fullName));
    } catch (err) {
      return githubFailure(err, reply);
    }
  });
}
