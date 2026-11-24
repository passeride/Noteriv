import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import prismaPlugin from "./plugins/prisma.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./routes/auth.js";
import vaultRoutes from "./routes/vaults.js";
import noteRoutes from "./routes/notes.js";
import folderRoutes from "./routes/folders.js";
import pluginRoutes from "./routes/plugins.js";
import syncConnectionRoutes from "./routes/syncConnections.js";
import vaultTransferRoutes from "./routes/vaultTransfer.js";
import quickNoteRoutes from "./routes/quickNote.js";
import { warnIfGitMissing } from "./lib/gitSync.js";
import pdfRoutes from "./routes/pdf.js";
import diagnosticsRoutes from "./routes/diagnostics.js";
import { clipTokenRoutes, clipPublicRoutes } from "./routes/clipper.js";
import userRoutes from "./routes/users.js";
import userVaultStateRoutes from "./routes/userVaultState.js";
import trashRoutes from "./routes/trash.js";
import attachmentRoutes from "./routes/attachments.js";
import { syncQueue } from "./lib/syncQueue.js";
import adminRoutes from "./routes/admin.js";
import opsRoutes from "./routes/ops.js";
import usageRoutes from "./routes/usage.js";
import aiRoutes from "./routes/ai.js";
import llmKeyRoutes from "./routes/llm-keys.js";
import { captureError, initSentry } from "./lib/sentry.js";

initSentry("api");

// Trust X-Forwarded-For only from proxies on private addresses (Traefik, the web container,
// localhost in dev). `trustProxy: true` trusted the whole header, so a client could put any
// address in it and get a fresh rate-limit bucket per request (login limit included).
const fastify = Fastify({ logger: true, trustProxy: ["loopback", "linklocal", "uniquelocal"] });

// Prisma first so the public clip route (below) can use it; that route must be registered
// BEFORE the app-wide CORS plugin — it needs its own wide-open CORS (bearer-token auth, no cookies).
await fastify.register(prismaPlugin);
await fastify.register(clipPublicRoutes, { prefix: "/api/v1/clip" });

await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN ?? "http://localhost:3457",
  credentials: true,
});
await fastify.register(helmet, {
  // The plugin-sandbox iframe (public/plugin-sandbox.html) is served from
  // this same origin and must stay embeddable and script-executable without
  // Helmet's default CSP fighting the sandbox attribute's own isolation —
  // real frame isolation comes from the iframe's `sandbox` attribute
  // (deliberately missing `allow-same-origin`, see plugin-sandbox/usePluginHost.ts),
  // not from CSP, so a strict default-src here would be redundant friction.
  contentSecurityPolicy: false,
});
// Per-IP requests a minute across the API (routes with their own limit, such as sign-in, keep theirs). The CI
// end-to-end run raises it: every test comes from one address, much faster than any person.
await fastify.register(rateLimit, {
  global: true,
  max: Number(process.env.RATE_LIMIT_PER_MINUTE) || 300,
  timeWindow: "1 minute",
});
await fastify.register(cookie);
// 25MB per-file ceiling: a memory-safety cap (files are buffered via
// file.toBuffer() in routes/attachments.ts) well under the per-vault quota,
// not the quota enforcement itself (that's the aggregate check in the route).
await fastify.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
await fastify.register(authPlugin);

// Server errors (5xx) go to Sentry when it is configured (lib/sentry.ts): tagged with the route pattern, never the
// real URL (it can hold ids and query strings), and the account id only.
fastify.addHook("onError", async (request, reply, error) => {
  const status = error.statusCode ?? reply.statusCode;
  if (status < 500) return;
  captureError(error, {
    tags: { method: request.method, route: request.routeOptions.url ?? "unknown" },
    userId: request.user?.id,
  });
});

await fastify.register(authRoutes, { prefix: "/api/v1/auth" });
await fastify.register(vaultRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(noteRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(folderRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(pluginRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(syncConnectionRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(userVaultStateRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(trashRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(attachmentRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(pdfRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(vaultTransferRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(quickNoteRoutes, { prefix: "/api/v1/vaults" });
await fastify.register(clipTokenRoutes, { prefix: "/api/v1/users" });
await fastify.register(diagnosticsRoutes, { prefix: "/api/v1/diagnostics" });
await fastify.register(userRoutes, { prefix: "/api/v1/users" });
// Quick test route to debug plugin registration
fastify.get("/api/v1/usage/test", async (request, reply) => {
  return { message: "usage route test works" };
});

await fastify.register(usageRoutes, { prefix: "/api/v1/usage" });
await fastify.register(adminRoutes, { prefix: "/api/v1/admin" });
await fastify.register(opsRoutes, { prefix: "/api/v1" });
await fastify.register(llmKeyRoutes, { prefix: "/api/v1/llm-keys" });
await fastify.register(aiRoutes, { prefix: "/ai" });
await fastify.register(aiRoutes, { prefix: "/api/ai" });

void warnIfGitMissing((m) => fastify.log.warn(m));

fastify.get("/healthz", async () => ({ ok: true }));

// Public uptime probe, reachable through the web app's /api rewrite (the bare /healthz above is not).
// Checks the two things the API cannot work without. Says only ok or not: no versions, no error
// text; the reason goes to the log. Rate limit off because monitors poll it by design and each
// call is two trivial queries. Redis uses maxRetriesPerRequest:null, so a dead Redis would hang
// forever without the timeout.
const HEALTH_TIMEOUT_MS = 3000;
const withTimeout = <T>(p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), HEALTH_TIMEOUT_MS))]);

fastify.get("/api/v1/healthz", { config: { rateLimit: false } }, async (request, reply) => {
  const [db, redis] = await Promise.allSettled([
    withTimeout(fastify.prisma.$queryRaw`SELECT 1`),
    // IRedisClient (bullmq) does not type ping(); any command proves the round trip, like diagnostics.ts.
    withTimeout(syncQueue.client.then((c) => c.get("noteriv:healthz"))),
  ]);
  if (db.status === "fulfilled" && redis.status === "fulfilled") return reply.send({ ok: true });
  request.log.warn(
    { db: db.status === "rejected" ? String(db.reason) : "ok", redis: redis.status === "rejected" ? String(redis.reason) : "ok" },
    "healthz failed"
  );
  return reply.code(503).send({ ok: false });
});

const port = Number(process.env.PORT ?? 4001);
fastify
  .listen({ port, host: "0.0.0.0" })
  .then(() => fastify.log.info(`noteriv-web-server listening on :${port}`))
  .catch((err) => {
    fastify.log.error(err);
    process.exit(1);
  });
