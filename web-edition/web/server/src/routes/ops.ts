import type { FastifyInstance } from "fastify";
import type { ErrorEvent } from "@sentry/node";
import { scrubEvent, sentryDsn, sentryEnvironment, sentryRelease } from "../lib/sentry.js";

const TUNNEL_BODY_LIMIT = 256 * 1024;
const FORWARD_TIMEOUT_MS = 10_000;
// What the browser SDK may send through the tunnel; sessions and anything else are dropped.
const FORWARDED_ITEMS = new Set(["event", "client_report"]);

interface DsnParts {
  origin: string;
  publicKey: string;
  projectId: string;
  pathPrefix: string;
}

function parseDsn(dsn: string): DsnParts | null {
  try {
    const u = new URL(dsn);
    const segments = u.pathname.split("/").filter(Boolean);
    const projectId = segments.pop();
    if (!projectId || !u.username) return null;
    return { origin: u.origin, publicKey: u.username, projectId, pathPrefix: segments.length ? `/${segments.join("/")}` : "" };
  } catch {
    return null;
  }
}

/**
 * Rebuilds a Sentry envelope (newline-separated JSON: header, then item header + payload pairs) keeping only the
 * allowed item types, with every event scrubbed again here so the page's own filtering is not the only one.
 * Returns null when the body is not an envelope of that shape.
 */
function rewriteEnvelope(body: string): { dsn: string; envelope: string } | null {
  const lines = body.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length < 1 || lines.length % 2 !== 1) return null;
  let header: { dsn?: unknown };
  try {
    header = JSON.parse(lines[0]);
  } catch {
    return null;
  }
  if (typeof header.dsn !== "string") return null;
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i += 2) {
    let itemHeader: { type?: unknown; length?: unknown };
    let payload: unknown;
    try {
      itemHeader = JSON.parse(lines[i]);
      payload = JSON.parse(lines[i + 1]);
    } catch {
      return null;
    }
    if (typeof itemHeader.type !== "string" || !FORWARDED_ITEMS.has(itemHeader.type)) continue;
    if (itemHeader.type === "event") payload = scrubEvent(payload as ErrorEvent);
    delete itemHeader.length;
    out.push(JSON.stringify(itemHeader), JSON.stringify(payload));
  }
  return { dsn: header.dsn, envelope: out.join("\n") + "\n" };
}

/**
 * Public, no login. `GET /config` gives the page what it needs at run time (so changing the env needs no web
 * rebuild): the browser error-reporting settings and the public status page. `POST /errors/browser` is the Sentry
 * tunnel: the page sends its error reports here (same origin, so no CSP change and nothing for blockers to stop)
 * and only envelopes for our own DSN go on to Sentry, which then sees this server's address, not the visitor's.
 */
export default async function opsRoutes(fastify: FastifyInstance) {
  // Every page load asks for this, so it stays out of the per-IP global limit (it only reads env, like /healthz):
  // counted, it pushed a fast run of page loads from one address over 300/minute and the app's own calls got 429.
  fastify.get("/config", { config: { rateLimit: false } }, async (_request, reply) => {
    const dsn = sentryDsn();
    return reply.send({
      errorReporting: dsn ? { dsn, environment: sentryEnvironment(), release: sentryRelease() ?? null } : null,
      statusPageUrl: process.env.STATUS_PAGE_URL?.trim() || null,
    });
  });

  fastify.post(
    "/errors/browser",
    { bodyLimit: TUNNEL_BODY_LIMIT, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const dsn = sentryDsn();
      const ours = dsn ? parseDsn(dsn) : null;
      if (!ours) return reply.code(404).send({ error: "not_found" });
      if (typeof request.body !== "string") return reply.code(400).send({ error: "invalid_body" });
      const rewritten = rewriteEnvelope(request.body);
      const theirs = rewritten ? parseDsn(rewritten.dsn) : null;
      if (!rewritten || !theirs) return reply.code(400).send({ error: "invalid_body" });
      if (theirs.origin !== ours.origin || theirs.projectId !== ours.projectId || theirs.publicKey !== ours.publicKey) {
        return reply.code(400).send({ error: "unknown_dsn" });
      }
      try {
        const res = await fetch(`${ours.origin}${ours.pathPrefix}/api/${ours.projectId}/envelope/`, {
          method: "POST",
          headers: { "Content-Type": "application/x-sentry-envelope" },
          body: rewritten.envelope,
          signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
        });
        return reply.code(res.ok ? 200 : 502).send({ ok: res.ok });
      } catch (err) {
        request.log.warn({ err: String(err) }, "error report forward failed");
        return reply.code(502).send({ ok: false });
      }
    }
  );
}
