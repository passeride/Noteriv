import type { FastifyInstance } from "fastify";
import { statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { gitVersion } from "../lib/gitSync.js";
import { checkStorage } from "../lib/attachments.js";
import { syncQueue } from "../lib/syncQueue.js";
import { isAdmin } from "../lib/registration.js";

// Same key the worker writes (sync-worker/index.ts); duplicated as a literal because the worker
// entrypoint starts processes on import and must not be imported from here.
const WORKER_HEARTBEAT_KEY = "noteriv:worker:heartbeat";

/**
 * Self-check used by Developer > Diagnostics. Every item is something that has actually broken
 * in production (missing git, worker without storage settings, dead worker) and is invisible
 * from the browser otherwise. Requires login; reveals no secrets (only whether things are set).
 */
export default async function diagnosticsRoutes(fastify: FastifyInstance) {
  const { prisma } = fastify;
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", async (request, reply) => {
    if (reply.sent) return;
    const me = await prisma.user.findUnique({
      where: { id: request.user!.id },
      select: { role: true, email: true, emailVerifiedAt: true },
    });
    if (!me || !isAdmin(me)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  });

  fastify.get("/", async (_request, reply) => {
    const [git, storage, db, redis, disk, pdf] = await Promise.all([
      gitVersion().catch(() => null),
      checkStorage(),
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      (async () => {
        try {
          const client = await syncQueue.client;
          const beat = await client.get(WORKER_HEARTBEAT_KEY);
          return { ok: true, workerHeartbeat: beat, workerAgeSeconds: beat ? Math.round((Date.now() - Date.parse(beat)) / 1000) : null };
        } catch {
          return { ok: false, workerHeartbeat: null as string | null, workerAgeSeconds: null as number | null };
        }
      })(),
      statfs(tmpdir())
        .then((s) => ({ freeMB: Math.round((s.bavail * s.bsize) / 1048576), totalMB: Math.round((s.blocks * s.bsize) / 1048576) }))
        .catch(() => null),
      (async () => {
        const url = process.env.PDF_SERVICE_URL;
        if (!url) return { configured: false, ok: false };
        try {
          const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
          return { configured: true, ok: r.ok };
        } catch {
          return { configured: true, ok: false };
        }
      })(),
    ]);

    return reply.send({
      time: new Date().toISOString(),
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      git: { installed: !!git, version: git },
      storage,
      database: { ok: db },
      redis: { ok: redis.ok },
      worker: {
        alive: redis.workerAgeSeconds !== null && redis.workerAgeSeconds < 90,
        lastHeartbeat: redis.workerHeartbeat,
        ageSeconds: redis.workerAgeSeconds,
      },
      scratchDisk: disk,
      pdfService: pdf,
    });
  });
}
