// A stand-in for Sentry's ingest endpoint, for the end-to-end tests (e2e/tests/ops.spec.ts). The API runs with
// SENTRY_DSN=http://e2e@127.0.0.1:4010/1; every envelope it (or the page, through the API's tunnel) sends lands here
// and is written as one file in E2E_SENTRY_OUTBOX (default web/server/.sentry-outbox). Run: node e2e/sentry-stub.mjs

import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const port = Number(process.env.E2E_SENTRY_STUB_PORT ?? 4010);
const outbox = path.resolve(process.env.E2E_SENTRY_OUTBOX ?? path.join(import.meta.dirname, "..", "web", "server", ".sentry-outbox"));
mkdirSync(outbox, { recursive: true });

let seq = 0;
createServer((req, res) => {
  if (req.method !== "POST" || !/^\/api\/\d+\/envelope\/?/.test(req.url ?? "")) {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = Buffer.concat(chunks);
    if (req.headers["content-encoding"] === "gzip") body = gunzipSync(body);
    writeFileSync(path.join(outbox, `${Date.now()}-${++seq}.envelope`), body);
    res.writeHead(200, { "Content-Type": "application/json" }).end("{}");
  });
}).listen(port, "127.0.0.1", () => console.log(`sentry stub on :${port}, writing to ${outbox}`));
