// End-to-end check of the WebDAV sync engine against a tiny in-process WebDAV server
// (PROPFIND / GET / PUT / MKCOL / DELETE over a temp folder) and the dev database.
// Run: npx tsx scripts/test-webdav-sync.ts — removes everything it creates.

import { PrismaClient } from "@prisma/client";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encryptJson } from "../src/lib/crypto.js";
import { runSyncJob } from "../src/lib/syncRunner.js";

const prisma = new PrismaClient();
const root = mkdtempSync(path.join(tmpdir(), "noteriv-webdav-test-"));
const PORT = Number(process.env.WEBDAV_TEST_PORT ?? 4093);
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
  if (!ok) failures++;
}

/** Minimal WebDAV server over `root/dav`, with ETags derived from content. */
function startDav(): Promise<Server> {
  const base = path.join(root, "dav");
  mkdirSync(base, { recursive: true });
  const fsPath = (urlPath: string) => path.join(base, decodeURIComponent(urlPath).replace(/^\/+/, ""));
  const entryXml = (href: string, full: string) => {
    const st = statSync(full);
    const isDir = st.isDirectory();
    const etag = isDir ? "" : `<D:getetag>"${createHash("md5").update(readFileSync(full)).digest("hex")}"</D:getetag>`;
    return `<D:response><D:href>${encodeURI(href)}</D:href><D:propstat><D:prop><D:getlastmodified>${st.mtime.toUTCString()}</D:getlastmodified>${etag}<D:resourcetype>${isDir ? "<D:collection/>" : ""}</D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
  };
  const server = createServer((req, res) => {
    const urlPath = new URL(req.url ?? "/", "http://x").pathname;
    const full = fsPath(urlPath);
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      switch (req.method) {
        case "PROPFIND": {
          if (!existsSync(full)) return void res.writeHead(404).end();
          const parts = [entryXml(urlPath, full)];
          if (statSync(full).isDirectory() && req.headers.depth !== "0") {
            for (const name of readdirSync(full)) parts.push(entryXml(`${urlPath.replace(/\/+$/, "")}/${name}`, path.join(full, name)));
          }
          res.writeHead(207, { "Content-Type": "application/xml" }).end(`<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">${parts.join("")}</D:multistatus>`);
          return;
        }
        case "MKCOL":
          if (existsSync(full)) return void res.writeHead(405).end();
          mkdirSync(full, { recursive: true });
          return void res.writeHead(201).end();
        case "PUT":
          mkdirSync(path.dirname(full), { recursive: true });
          writeFileSync(full, body);
          return void res.writeHead(201).end();
        case "GET":
          if (!existsSync(full)) return void res.writeHead(404).end();
          return void res.writeHead(200).end(readFileSync(full));
        case "DELETE":
          if (!existsSync(full)) return void res.writeHead(404).end();
          rmSync(full, { recursive: true, force: true });
          return void res.writeHead(204).end();
        default:
          res.writeHead(405).end();
      }
    });
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r(server)));
}

async function main() {
  const dav = await startDav();
  const remote = (rel: string) => path.join(root, "dav", "vault", rel);
  const user = await prisma.user.create({ data: { email: `webdavtest-${Date.now()}@example.test`, displayName: "WebDAV Test" } });
  const ws = await prisma.workspace.create({ data: { name: "t", ownerId: user.id, members: { create: { userId: user.id, role: "owner" } } } });
  const vault = await prisma.vault.create({ data: { name: "webdav-test", workspaceId: ws.id } });
  try {
    const conn = await prisma.syncConnection.create({
      data: {
        vaultId: vault.id,
        providerType: "webdav",
        webdavUrl: `http://127.0.0.1:${PORT}`,
        webdavPath: "/vault",
        credentialsEncrypted: encryptJson({ username: "u", password: "p" }),
      },
    });
    const note = (p: string, content: string) => prisma.note.create({ data: { vaultId: vault.id, name: p, path: p, content, sizeBytes: content.length } });
    const live = async (p: string) => (await prisma.note.findFirst({ where: { vaultId: vault.id, path: p, deletedAt: null } }))?.content ?? null;
    const row = (p: string) => prisma.note.findFirst({ where: { vaultId: vault.id, path: p } });
    const copies = async (stem: string) =>
      (await prisma.note.findMany({ where: { vaultId: vault.id, deletedAt: null } })).filter((n) => n.path.startsWith(`${stem} (conflict `));
    const job = () => prisma.syncJob.findFirst({ where: { syncConnectionId: conn.id }, orderBy: { createdAt: "desc" } });
    const sync = async () => {
      await runSyncJob(prisma, conn.id);
      await new Promise((r) => setTimeout(r, 20));
    };

    // 1. first sync pushes everything
    await note("a.md", "# A\nbase");
    await note("b.md", "# B\nbase");
    await note("c.md", "# C\nbase");
    await note("d.md", "# D\nbase");
    await sync();
    check("first sync: files pushed", ["a.md", "b.md", "c.md", "d.md"].every((f) => existsSync(remote(f))));
    check("first sync: state recorded", Object.keys(((await prisma.syncConnection.findUnique({ where: { id: conn.id } }))?.syncState ?? {}) as object).length === 4);

    // 2. nothing changed → nothing transferred
    await sync();
    const j2 = await job();
    check("unchanged: nothing pushed or pulled", j2?.pushedCount === 0 && j2?.pulledCount === 0, JSON.stringify(j2));

    // 3. remote edit only → imported
    writeFileSync(remote("a.md"), "# A\nremote edit");
    await sync();
    check("remote edit imported", (await live("a.md")) === "# A\nremote edit", String(await live("a.md")));

    // 4. web edit only → uploaded (no longer overwritten by mtime races)
    await prisma.note.updateMany({ where: { vaultId: vault.id, path: "b.md" }, data: { content: "# B\nweb edit" } });
    await sync();
    check("web edit uploaded", readFileSync(remote("b.md"), "utf8") === "# B\nweb edit");

    // 5. both edit → web version stays, remote kept as a copy on both sides
    await prisma.note.updateMany({ where: { vaultId: vault.id, path: "a.md" }, data: { content: "# A\nWEB" } });
    writeFileSync(remote("a.md"), "# A\nREMOTE");
    await sync();
    const aCopies = await copies("a");
    check("both edit: web version kept", (await live("a.md")) === "# A\nWEB" && readFileSync(remote("a.md"), "utf8") === "# A\nWEB");
    check("both edit: remote version kept as a copy", aCopies.length === 1 && aCopies[0].content === "# A\nREMOTE" && existsSync(remote(aCopies[0].path)), JSON.stringify(aCopies));
    check("both edit: job reports the copy", ((await job())?.errorMessage ?? "").includes("conflict"));

    // 6. remote delete → note moved to the trash (not hard-deleted)
    unlinkSync(remote("b.md"));
    await sync();
    const b = await row("b.md");
    check("remote delete: note in the trash", !!b && b.deletedAt !== null, JSON.stringify(b));

    // 7. trashed on the web, untouched remotely → deleted remotely too, and stays deleted
    await prisma.note.updateMany({ where: { vaultId: vault.id, path: "d.md" }, data: { deletedAt: new Date() } });
    await sync();
    check("web trash: file removed remotely", !existsSync(remote("d.md")));
    await sync();
    check("web trash: not resurrected", (await live("d.md")) === null && (await row("d.md"))?.deletedAt !== null);

    // 8. trashed on the web, edited remotely → stays trashed, remote edit kept as a copy
    await prisma.note.updateMany({ where: { vaultId: vault.id, path: "c.md" }, data: { deletedAt: new Date() } });
    writeFileSync(remote("c.md"), "# C\nremote edit");
    await sync();
    check("trash vs remote edit: still trashed", (await row("c.md"))?.deletedAt !== null);
    check("trash vs remote edit: copy kept", (await copies("c")).some((n) => n.content === "# C\nremote edit"));

    // 9. new remote file → imported
    mkdirSync(remote("sub"), { recursive: true });
    writeFileSync(remote("sub/e.md"), "# E\nfrom remote");
    await sync();
    check("new remote file imported", (await live("sub/e.md")) === "# E\nfrom remote");

    // 10. lost state (e.g. new server path) → no overwrite: differing files become copies
    await prisma.syncConnection.update({ where: { id: conn.id }, data: { syncState: {} } });
    writeFileSync(remote("sub/e.md"), "# E\nremote again");
    await sync();
    check("no state: web version kept", (await live("sub/e.md")) === "# E\nfrom remote");
    check("no state: remote version kept as a copy", (await prisma.note.findMany({ where: { vaultId: vault.id, deletedAt: null } })).some((n) => n.path.startsWith("sub/e (conflict ") && n.content === "# E\nremote again"));
  } finally {
    dav.close();
    await prisma.vault.delete({ where: { id: vault.id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id: ws.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
}

main()
  .catch((e) => {
    console.error("SCRIPT ERROR", e);
    failures++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    rmSync(root, { recursive: true, force: true });
    console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
