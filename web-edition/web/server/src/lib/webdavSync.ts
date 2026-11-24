// WebDAV sync — ports desktop/src-tauri/src/commands_sync.rs's `webdav_sync`
// (PROPFIND-based mtime diffing) from Rust+reqwest+quick-xml to Node+axios+fast-xml-parser.

import axios, { type AxiosInstance } from "axios";
import { XMLParser } from "fast-xml-parser";
import { readdir, readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { isSafeVaultPath, prepareWrite } from "./vaultPaths.js";
import { assertPublicRemote } from "./remoteHost.js";
import { conflictCopyPath } from "./gitSync.js";

const SYNC_EXTS = new Set([".md", ".markdown"]);

export interface WebdavConfig {
  url: string;
  username: string;
  password: string;
  remotePath: string;
}

export interface LocalFile {
  rel: string; // forward-slash relative path
  full: string;
  mtimeMs: number;
}

async function walkLocalFiles(base: string): Promise<LocalFile[]> {
  const out: LocalFile[] = [];
  async function recurse(cur: string) {
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === ".noteriv") continue;
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        await recurse(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SYNC_EXTS.has(ext)) {
          const s = await stat(full);
          out.push({ rel: path.relative(base, full).replace(/\\/g, "/"), full, mtimeMs: s.mtimeMs });
        }
      }
    }
  }
  await recurse(base);
  return out;
}

function buildClient(cfg: WebdavConfig): AxiosInstance {
  return axios.create({
    timeout: 60_000,
    auth: { username: cfg.username, password: cfg.password },
    headers: { "User-Agent": "Noteriv" },
    validateStatus: () => true, // we check status manually (WebDAV uses 207 Multi-Status)
    // No redirects: a server could send the request on to an address inside our network and return its answer.
    maxRedirects: 0,
  });
}

function joinUrl(base: string, p: string): string {
  return `${base.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;
}

interface WebdavEntry {
  rel: string;
  href: string;
  isDir: boolean;
  mtimeMs: number;
  /** Change marker: the ETag when the server sends one (exact), else the mtime (1-second resolution). */
  tag: string;
}

const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

function parsePropfind(xml: string, basePath: string): WebdavEntry[] {
  const out: WebdavEntry[] = [];
  let parsed: any;
  try {
    parsed = xmlParser.parse(xml);
  } catch {
    return out;
  }
  const multistatus = parsed?.multistatus;
  if (!multistatus) return out;
  const responses = Array.isArray(multistatus.response) ? multistatus.response : [multistatus.response].filter(Boolean);

  for (const resp of responses) {
    const hrefRaw: string | undefined = typeof resp?.href === "string" ? resp.href : resp?.href?.["#text"];
    if (!hrefRaw) continue;

    const propstat = Array.isArray(resp.propstat) ? resp.propstat[0] : resp.propstat;
    const prop = propstat?.prop ?? {};
    const isDir = prop.resourcetype != null && typeof prop.resourcetype === "object" && "collection" in prop.resourcetype;
    const lastModRaw: string | undefined = prop.getlastmodified;
    const etagRaw = prop.getetag;
    const etag = typeof etagRaw === "string" ? etagRaw : typeof etagRaw === "number" ? String(etagRaw) : undefined;

    let hrefPath = hrefRaw;
    const protoMatch = hrefRaw.match(/^https?:\/\/[^/]+(\/.*)$/);
    if (protoMatch) hrefPath = protoMatch[1];
    const decoded = decodeURIComponent(hrefPath);

    const base = basePath.replace(/\/+$/, "");
    let rel = decoded.startsWith(base) ? decoded.slice(base.length) : decoded;
    rel = rel.replace(/^\/+/, "").replace(/\/+$/, "");

    const mtimeMs = lastModRaw ? Date.parse(lastModRaw) || 0 : 0;
    // A server's listing may not name anything outside the synced folder ("..", ".git", absolute paths).
    if (rel && isSafeVaultPath(rel)) out.push({ rel, href: decoded, isDir: !!isDir, mtimeMs, tag: etag ? `etag:${etag}` : `mtime:${mtimeMs}` });
  }
  return out;
}

async function propfind(client: AxiosInstance, url: string, depth: 0 | 1): Promise<WebdavEntry[]> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getlastmodified/>
    <D:getetag/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;
  const res = await client.request({
    method: "PROPFIND" as any,
    url,
    // Explicit Accept matters: axios' default Accept header includes
    // application/json, and at least one WebDAV server implementation we
    // tested against honors that via content-negotiation and serializes its
    // XML response as JSON instead — silently breaking PROPFIND parsing.
    // Forcing XML here is correct for any spec-compliant WebDAV server too.
    headers: { Depth: String(depth), "Content-Type": "application/xml", Accept: "application/xml, text/xml" },
    data: body,
    responseType: "text",
    transformResponse: (data) => data,
  });
  if (res.status !== 207 && (res.status < 200 || res.status >= 300)) {
    throw new Error(`PROPFIND failed: HTTP ${res.status}`);
  }
  const basePath = new URL(url).pathname;
  return parsePropfind(res.data, basePath);
}

async function mkcol(client: AxiosInstance, url: string): Promise<void> {
  const res = await client.request({ method: "MKCOL" as any, url });
  if (res.status !== 201 && res.status !== 405) {
    throw new Error(`MKCOL HTTP ${res.status}`);
  }
}

async function ensureDir(client: AxiosInstance, baseUrl: string, relDir: string): Promise<void> {
  if (!relDir || relDir === "/") return;
  let acc = "";
  for (const part of relDir.split("/").filter(Boolean)) {
    acc = acc ? `${acc}/${part}` : part;
    try {
      await mkcol(client, `${joinUrl(baseUrl, acc)}/`);
    } catch {
      // best-effort, matches desktop's behavior
    }
  }
}

export async function webdavTest(cfg: WebdavConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertPublicRemote(cfg.url);
    const client = buildClient(cfg);
    const baseUrl = joinUrl(cfg.url, cfg.remotePath);
    await propfind(client, `${baseUrl.replace(/\/+$/, "")}/`, 0);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** What both sides held for a path after the last successful sync: the content hash and the remote change marker. */
export interface WebdavFileState {
  hash: string;
  remoteTag: string;
}
export type WebdavSyncState = Record<string, WebdavFileState>;

export interface WebdavSyncResult {
  pushed: number;
  pulled: number;
  /** Conflict copies created (both sides changed, or the remote edited a note deleted on the web). */
  conflictCopies: string[];
  /** State to store for the next sync. */
  state: WebdavSyncState;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function listRemote(client: AxiosInstance, baseUrl: string): Promise<Map<string, WebdavEntry>> {
  const remoteEntries = new Map<string, WebdavEntry>();
  const stack: Array<{ prefix: string; url: string }> = [{ prefix: "", url: baseUrl }];
  while (stack.length > 0) {
    const { prefix, url } = stack.pop()!;
    const listed = await propfind(client, `${url.replace(/\/+$/, "")}/`, 1);
    for (const e of listed) {
      const combined = prefix ? `${prefix.replace(/\/+$/, "")}/${e.rel}` : e.rel;
      if (e.isDir) {
        stack.push({ prefix: combined, url: `${url.replace(/\/+$/, "")}/${e.rel}` });
      } else if (SYNC_EXTS.has(path.extname(combined).toLowerCase())) {
        remoteEntries.set(combined, { ...e, rel: combined });
      }
    }
  }
  return remoteEntries;
}

/**
 * Two-way sync between local `dir` (the vault export) and a WebDAV folder, decided per
 * file against `prev` — what both sides held after the last sync — so it knows which
 * side changed:
 * - only one side changed → copy it over (a deletion on one side deletes on the other);
 * - both changed (or no record yet and the contents differ) → the local (web) version
 *   stays at the path on both sides, the remote version is kept as a conflict copy;
 * - deleted on the web but edited remotely → the deletion stands, the remote version
 *   becomes a conflict copy; edited on the web but deleted remotely → the edit is kept.
 * Content is compared by hash: the export rewrites every local file, so mtimes say nothing.
 */
export async function webdavSyncCore(dir: string, cfg: WebdavConfig, prev: WebdavSyncState = {}): Promise<WebdavSyncResult> {
  await assertPublicRemote(cfg.url);
  const client = buildClient(cfg);
  const baseUrl = joinUrl(cfg.url, cfg.remotePath);
  const serverRoot = new URL(cfg.url).origin;
  await mkcol(client, `${baseUrl.replace(/\/+$/, "")}/`).catch(() => undefined);

  const remoteEntries = await listRemote(client, baseUrl);
  const local = await walkLocalFiles(dir);
  const localMap = new Map(local.map((f) => [f.rel, f]));

  let pushed = 0;
  let pulled = 0;
  const conflictCopies: string[] = [];
  const taken = new Set<string>([...localMap.keys(), ...remoteEntries.keys()]);

  const put = async (rel: string, bytes: Buffer) => {
    const parent = path.dirname(rel);
    if (parent !== ".") await ensureDir(client, baseUrl, parent.replace(/\\/g, "/"));
    const res = await client.put(joinUrl(baseUrl, rel), bytes);
    if (res.status < 200 || res.status >= 300) throw new Error(`PUT HTTP ${res.status}`);
    pushed++;
  };
  const get = async (rf: WebdavEntry): Promise<Buffer> => {
    const res = await client.get(`${serverRoot}${rf.href}`, { responseType: "arraybuffer" });
    if (res.status < 200 || res.status >= 300) throw new Error(`GET HTTP ${res.status}`);
    return Buffer.from(res.data);
  };
  const del = async (rel: string) => {
    const res = await client.delete(joinUrl(baseUrl, rel));
    if (res.status !== 404 && (res.status < 200 || res.status >= 300)) throw new Error(`DELETE HTTP ${res.status}`);
  };
  const writeLocal = async (rel: string, bytes: Buffer) => {
    const dest = await prepareWrite(dir, rel);
    await writeFile(dest, bytes);
  };
  /** Keeps `bytes` (the remote version of `rel`) as a conflict copy on both sides. */
  const keepAsCopy = async (rel: string, bytes: Buffer) => {
    const copy = conflictCopyPath(rel, (c) => taken.has(c));
    taken.add(copy);
    await writeLocal(copy, bytes);
    await put(copy, bytes);
    conflictCopies.push(copy);
  };

  for (const rel of new Set([...localMap.keys(), ...remoteEntries.keys()])) {
    const lf = localMap.get(rel);
    const rf = remoteEntries.get(rel);
    const base = prev[rel];

    if (lf && rf) {
      const localBytes = await readFile(lf.full);
      const localHash = sha256(localBytes);
      const localChanged = !base || localHash !== base.hash;
      if (base && rf.tag === base.remoteTag) {
        if (localChanged) await put(rel, localBytes); // only the web changed
        continue;
      }
      const remoteBytes = await get(rf);
      const remoteHash = sha256(remoteBytes);
      if (remoteHash === localHash) continue;
      const remoteChanged = !base || remoteHash !== base.hash;
      if (!remoteChanged) {
        await put(rel, localBytes);
      } else if (!localChanged) {
        await writeLocal(rel, remoteBytes);
        pulled++;
      } else {
        await keepAsCopy(rel, remoteBytes);
        await put(rel, localBytes);
      }
    } else if (lf) {
      // Only on the web side.
      const localBytes = await readFile(lf.full);
      if (base && sha256(localBytes) === base.hash) {
        // Unchanged here and gone remotely: deleted remotely. (The import moves the note to the trash.)
        await unlink(lf.full).catch(() => undefined);
      } else {
        await put(rel, localBytes); // new on the web, or edited here after a remote delete
      }
    } else if (rf) {
      // Only on the remote side.
      if (!base) {
        await writeLocal(rel, await get(rf)); // new remote file
        pulled++;
      } else if (rf.tag === base.remoteTag) {
        await del(rel); // deleted on the web, untouched remotely
      } else {
        const remoteBytes = await get(rf);
        if (sha256(remoteBytes) === base.hash) {
          await del(rel);
        } else {
          await keepAsCopy(rel, remoteBytes); // deleted on the web, edited remotely
          await del(rel);
        }
      }
    }
  }

  // Record what both sides now hold. The remote listing gives the post-upload ETags/mtimes.
  const finalRemote = await listRemote(client, baseUrl);
  const finalLocal = await walkLocalFiles(dir);
  const state: WebdavSyncState = {};
  for (const lf of finalLocal) {
    const rf = finalRemote.get(lf.rel);
    if (rf) state[lf.rel] = { hash: sha256(await readFile(lf.full)), remoteTag: rf.tag };
  }

  return { pushed, pulled, conflictCopies, state };
}
