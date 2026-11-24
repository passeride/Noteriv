// Internal HTML -> PDF service. POST /render {html, title?} with header X-Pdf-Token -> application/pdf.
//
// The HTML comes from a user's browser and must be treated as untrusted:
//  - JavaScript is disabled for the page,
//  - every network request is aborted (only data: URLs, which the client inlines, are allowed),
//  - one page is rendered at a time, with a hard timeout and a body size cap.
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import puppeteer from "puppeteer-core";

const PORT = Number(process.env.PORT ?? 4003);
const TOKEN = process.env.PDF_SERVICE_TOKEN ?? "";
const CHROME = process.env.PDF_CHROME_PATH ?? "/usr/bin/chromium-browser";
const MAX_BODY = 8 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 30_000;

if (!TOKEN) {
  console.error("PDF_SERVICE_TOKEN is required");
  process.exit(1);
}

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        executablePath: CHROME,
        headless: true,
        args: [
          "--no-sandbox", // runs as an unprivileged user in a container; JS and network are disabled per page
          "--disable-setuid-sandbox",
          "--disable-gpu",
          "--disable-dev-shm-usage",
          "--font-render-hinting=none",
        ],
      })
      .then((b) => {
        b.on("disconnected", () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((e) => {
        browserPromise = null;
        throw e;
      });
  }
  return browserPromise;
}

// Serialise renders: Chromium pages are memory hungry and the container is small.
let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

async function renderPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url === "about:blank") req.continue();
      else req.abort("blockedbyclient");
    });
    await page.setContent(html, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true, // the document's own @page rule (margins) wins
      timeout: RENDER_TIMEOUT_MS,
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

function tokenOk(header) {
  const a = Buffer.from(String(header ?? ""));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  try {
    if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
    if (req.method !== "POST" || req.url !== "/render") return send(404, { error: "not_found" });
    if (!tokenOk(req.headers["x-pdf-token"])) return send(401, { error: "unauthorized" });

    const parsed = JSON.parse(await readBody(req));
    if (typeof parsed.html !== "string" || parsed.html.length === 0) return send(400, { error: "html_required" });

    const pdf = await enqueue(() => renderPdf(parsed.html));
    return send(200, Buffer.from(pdf), { "Content-Type": "application/pdf", "Content-Length": String(pdf.length) });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    console.error("[pdf] render failed:", err && err.message);
    return send(status, { error: status === 413 ? "too_large" : "render_failed" });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`noteriv-pdf listening on :${PORT}`));
process.on("SIGTERM", async () => {
  server.close();
  const b = await browserPromise?.catch(() => null);
  await b?.close().catch(() => undefined);
  process.exit(0);
});
