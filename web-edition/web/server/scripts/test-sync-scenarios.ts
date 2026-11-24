// Manual end-to-end check of the git sync engine against LOCAL bare repos (no
// network, no GitHub). Run: npx tsx scripts/test-sync-scenarios.ts
// Covers empty remote, several two-way rounds, both sides editing (merge, conflict
// copies, trash, snapshots, edits during a sync, concurrent syncs) — plus direction
// modes, commit templates, .gitignore, explicit resolution modes and the askpass helper.
// Uses the dev database (DATABASE_URL) and removes everything it creates.

import { PrismaClient } from "@prisma/client";

// The remotes here are local bare repositories; the worker otherwise only talks HTTPS (lib/gitSync.ts runGit).
process.env.SYNC_ALLOW_LOCAL_REMOTES = "1";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encryptJson } from "../src/lib/crypto.js";
import { runSyncJob, formatCommitMessage } from "../src/lib/syncRunner.js";
import { askpassBody, conflictCopyPath, ensureWorkingCopy, gitSyncCore, hostEnvForGit } from "../src/lib/gitSync.js";
import { importDirToNotes } from "../src/lib/vaultFs.js";
import { putObject, makeStorageKey, deleteObject, getObjectStream } from "../src/lib/attachments.js";
import { toRelativeLinks, fromRelativeLinks } from "../src/lib/attachmentLinks.js";

const prisma = new PrismaClient();
const root = mkdtempSync(path.join(tmpdir(), "noteriv-sync-test-"));
let failures = 0;

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
  if (!ok) failures++;
}
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();

async function main() {
  // --- fixtures: user/workspace/vault + bare remote ---
  const user = await prisma.user.create({ data: { email: `synctest-${Date.now()}@example.test`, displayName: "Sync Test" } });
  const ws = await prisma.workspace.create({ data: { name: "t", ownerId: user.id, members: { create: { userId: user.id, role: "owner" } } } });
  const vault = await prisma.vault.create({ data: { name: "sync-test", workspaceId: ws.id } });
  const bare = path.join(root, "remote.git");
  git(root, "init", "--bare", "-b", "main", bare);

  const conn = await prisma.syncConnection.create({
    data: {
      vaultId: vault.id,
      providerType: "gitea",
      remoteUrl: bare,
      branch: "main",
      authUsername: "",
      credentialsEncrypted: encryptJson({ username: "", token: "" }),
      commitTemplate: "web {date} {count} changed",
    },
  });
  const note = (name: string, content: string) =>
    prisma.note.create({ data: { vaultId: vault.id, name, path: name, content, sizeBytes: content.length, createdById: user.id, updatedById: user.id } });
  const cloneRemote = (label: string) => {
    const d = path.join(root, label);
    git(root, "clone", bare, d);
    return d;
  };
  const push = (d: string, msg: string) => {
    git(d, "add", "-A");
    git(d, "commit", "-m", msg);
    git(d, "push", "origin", "main");
  };
  const noteContent = async (p: string) => (await prisma.note.findFirst({ where: { vaultId: vault.id, path: p, deletedAt: null } }))?.content ?? null;
  const lastJob = () => prisma.syncJob.findFirst({ where: { syncConnectionId: conn.id }, orderBy: { createdAt: "desc" } });

  // --- 1. empty remote ---
  await note("a.md", "# A\none");
  await note("b.md", "# B\ntwo");
  await runSyncJob(prisma, conn.id);
  const c1 = cloneRemote("c1");
  check("empty remote: files pushed", existsSync(path.join(c1, "a.md")) && existsSync(path.join(c1, "b.md")));
  check("empty remote: default .gitignore created", existsSync(path.join(c1, ".gitignore")));
  const subject = git(c1, "log", "-1", "--format=%s");
  check("commit message template applied", /^web \d{4}-\d{2}-\d{2} \d+ changed$/.test(subject), subject);
  check("job success", (await lastJob())?.status === "success");

  // --- 2. multi-round two-way ---
  await prisma.note.updateMany({ where: { vaultId: vault.id, path: "a.md" }, data: { content: "# A\none (web edit)" } });
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  check("round: web edit reaches remote", readFileSync(path.join(c1, "a.md"), "utf8").includes("web edit"));
  writeFileSync(path.join(c1, "c.md"), "# C\nfrom remote");
  push(c1, "remote adds c");
  await runSyncJob(prisma, conn.id);
  check("round: remote-only note imported", (await noteContent("c.md")) === "# C\nfrom remote");
  await prisma.note.updateMany({ where: { vaultId: vault.id, path: "b.md" }, data: { deletedAt: new Date() } });
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  check("round: trashed note removed from repo", !existsSync(path.join(c1, "b.md")));
  const nested = await prisma.folder.create({ data: { vaultId: vault.id, name: "sub", path: "sub" } });
  await prisma.note.create({ data: { vaultId: vault.id, folderId: nested.id, name: "d.md", path: "sub/d.md", content: "nested", sizeBytes: 6, createdById: user.id, updatedById: user.id } });
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  check("round: nested folder note pushed", existsSync(path.join(c1, "sub", "d.md")));

  // --- 3. both sides edit: merge, keep both, never lose content ---
  const liveNotes = () => prisma.note.findMany({ where: { vaultId: vault.id, deletedAt: null }, select: { path: true, content: true } });
  const copiesOf = async (stem: string) => (await liveNotes()).filter((n) => n.path.startsWith(`${stem} (conflict `));
  const noMarkers = async () => (await liveNotes()).every((n) => !/^(<<<<<<<|>>>>>>>) /m.test(n.content));

  // 3a. same line edited on both sides
  git(c1, "pull");
  await prisma.note.updateMany({ where: { vaultId: vault.id, path: "a.md" }, data: { content: "# A\nWEB SIDE" } });
  writeFileSync(path.join(c1, "a.md"), "# A\nREMOTE SIDE");
  push(c1, "remote edits a");
  await runSyncJob(prisma, conn.id);
  const aCopies = await copiesOf("a");
  check("same line: job success (no pause)", (await lastJob())?.status === "success", JSON.stringify(await lastJob()));
  check("same line: note keeps the web version", (await noteContent("a.md")) === "# A\nWEB SIDE", String(await noteContent("a.md")));
  check("same line: remote version saved as a conflict copy", aCopies.length === 1 && aCopies[0].content === "# A\nREMOTE SIDE", JSON.stringify(aCopies));
  check("same line: no conflict markers in any note", await noMarkers());
  check("same line: job reports the copy", ((await lastJob())?.errorMessage ?? "").includes("conflict"), String((await lastJob())?.errorMessage));
  git(c1, "pull");
  // (the test clone may check files out with CRLF on Windows)
  const repoA = readFileSync(path.join(c1, "a.md"), "utf8").replace(/\r\n/g, "\n");
  check(
    "same line: repo has web version and the copy",
    repoA === "# A\nWEB SIDE" && aCopies.every((c) => existsSync(path.join(c1, c.path))),
    `${JSON.stringify(repoA)} copies=${JSON.stringify(aCopies.map((c) => [c.path, existsSync(path.join(c1, c.path))]))}`
  );

  // 3b. different parts edited → merged automatically, no copy
  await note("g.md", "line 1\nline 2\nline 3\nline 4\nline 5\n");
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  await prisma.note.updateMany({ where: { vaultId: vault.id, path: "g.md" }, data: { content: "line 1 WEB\nline 2\nline 3\nline 4\nline 5\n" } });
  writeFileSync(path.join(c1, "g.md"), "line 1\nline 2\nline 3\nline 4\nline 5 REMOTE\n");
  push(c1, "remote edits g end");
  await runSyncJob(prisma, conn.id);
  check("different parts: both edits merged", (await noteContent("g.md")) === "line 1 WEB\nline 2\nline 3\nline 4\nline 5 REMOTE\n", String(await noteContent("g.md")));
  check("different parts: no conflict copy", (await copiesOf("g")).length === 0);

  // 3c. trashed on the web, edited remotely → stays trashed, remote edit kept as a copy
  await note("h.md", "# H\noriginal");
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  await prisma.note.updateMany({ where: { vaultId: vault.id, path: "h.md" }, data: { deletedAt: new Date() } });
  writeFileSync(path.join(c1, "h.md"), "# H\nremote edit");
  push(c1, "remote edits h");
  await runSyncJob(prisma, conn.id);
  const h = await prisma.note.findFirst({ where: { vaultId: vault.id, path: "h.md" } });
  check("trash vs remote edit: note still in the trash", !!h && h.deletedAt !== null, JSON.stringify(h));
  check("trash vs remote edit: remote edit kept as a copy", (await copiesOf("h")).some((c) => c.content === "# H\nremote edit"));

  // 3d. deleted remotely, edited on the web → web version stays
  await note("i.md", "# I\noriginal");
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  await prisma.note.updateMany({ where: { vaultId: vault.id, path: "i.md" }, data: { content: "# I\nweb edit" } });
  git(c1, "rm", "-q", "i.md");
  push(c1, "remote deletes i");
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  check("remote delete vs web edit: web version kept", (await noteContent("i.md")) === "# I\nweb edit" && existsSync(path.join(c1, "i.md")));

  // 3e. deleted remotely, untouched on the web → moved to the trash, not hard-deleted; snapshot kept
  await note("j.md", "# J\nkeep me");
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  git(c1, "rm", "-q", "j.md");
  push(c1, "remote deletes j");
  await runSyncJob(prisma, conn.id);
  const j = await prisma.note.findFirst({ where: { vaultId: vault.id, path: "j.md" } });
  check("remote delete: note moved to the trash (restorable)", !!j && j.deletedAt !== null, JSON.stringify(j));

  // 3f. the note trashed in round 2 (b.md) survived every sync since
  const b = await prisma.note.findFirst({ where: { vaultId: vault.id, path: "b.md" } });
  check("trashed note survives later syncs", !!b && b.deletedAt !== null && b.content === "# B\ntwo", JSON.stringify(b));

  // 3g. remote edit overwrites an untouched note → the old content is a snapshot
  await note("k.md", "# K\nbefore");
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  writeFileSync(path.join(c1, "k.md"), "# K\nafter");
  push(c1, "remote edits k");
  await runSyncJob(prisma, conn.id);
  const k = await prisma.note.findFirst({ where: { vaultId: vault.id, path: "k.md" } });
  const kSnap = k ? await prisma.noteSnapshot.findFirst({ where: { noteId: k.id, content: "# K\nbefore" } }) : null;
  check("overwrite: remote content imported", k?.content === "# K\nafter");
  check("overwrite: previous content kept as a snapshot", !!kSnap);

  // 3h. note edited while a sync runs → the edit is kept, the file's version becomes a copy
  // (own vault: the directory below holds only w.md, so every other note would look deleted remotely)
  const vault2 = await prisma.vault.create({ data: { name: "sync-test-window", workspaceId: ws.id } });
  const window = path.join(root, "window");
  mkdirSync(window, { recursive: true });
  const exportedAt = new Date(Date.now() - 60_000);
  await prisma.note.create({ data: { vaultId: vault2.id, name: "w.md", path: "w.md", content: "# W\nedited during sync", sizeBytes: 1 } });
  await prisma.note.create({ data: { vaultId: vault2.id, name: "new.md", path: "new.md", content: "# created during sync", sizeBytes: 1 } });
  writeFileSync(path.join(window, "w.md"), "# W\nfrom file");
  const report = await importDirToNotes(prisma, vault2.id, window, null, { exportedAt });
  const v2 = await prisma.note.findMany({ where: { vaultId: vault2.id, deletedAt: null }, select: { path: true, content: true } });
  check("edit during sync: web edit kept", v2.find((n) => n.path === "w.md")?.content === "# W\nedited during sync", JSON.stringify(v2));
  check(
    "edit during sync: file version saved as a copy",
    report.conflictCopies.length === 1 && v2.some((n) => n.path.startsWith("w (conflict ") && n.content === "# W\nfrom file"),
    JSON.stringify(report)
  );
  check("edit during sync: note created after export (no file) is not trashed", report.trashed === 0 && v2.some((n) => n.path === "new.md"), JSON.stringify(report));
  await prisma.vault.delete({ where: { id: vault2.id } });

  // 3i. two syncs of one connection at once → one runs, the other is skipped
  const both = await Promise.all([runSyncJob(prisma, conn.id), runSyncJob(prisma, conn.id)]);
  check("concurrent syncs: one skipped", both.includes("done") && both.includes("skipped"), JSON.stringify(both));
  check("concurrent syncs: lock released", (await prisma.syncConnection.findUnique({ where: { id: conn.id } }))?.syncLockedAt === null);

  // --- 4. explicit resolution modes still work ---
  git(c1, "pull");
  await prisma.note.updateMany({ where: { vaultId: vault.id, path: "a.md" }, data: { content: "# A\nWEB FORCED" } });
  writeFileSync(path.join(c1, "a.md"), "# A\nREMOTE FORCED");
  push(c1, "remote edits a again");
  await runSyncJob(prisma, conn.id, "resolve-web");
  git(c1, "pull");
  check("resolve-web: remote now carries web content (no force push)", readFileSync(path.join(c1, "a.md"), "utf8").includes("WEB FORCED"));
  check("resolve-web: job success", (await lastJob())?.status === "success");

  writeFileSync(path.join(c1, "a.md"), "# A\nREMOTE WINS");
  push(c1, "remote edit 2");
  await runSyncJob(prisma, conn.id, "resolve-remote");
  check("resolve-remote: DB took remote content", ((await noteContent("a.md")) ?? "").includes("REMOTE WINS"), String(await noteContent("a.md")));

  // --- 5. direction modes ---
  await prisma.syncConnection.update({ where: { id: conn.id }, data: { direction: "pull" } });
  await prisma.note.updateMany({ where: { vaultId: vault.id, path: "a.md" }, data: { content: "# A\nWEB ONLY EDIT" } });
  git(c1, "pull");
  writeFileSync(path.join(c1, "e.md"), "# E\nremote new");
  push(c1, "remote adds e");
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  check("direction=pull: remote note imported", (await noteContent("e.md")) === "# E\nremote new");
  check("direction=pull: web edit NOT pushed", !readFileSync(path.join(c1, "a.md"), "utf8").includes("WEB ONLY EDIT"));

  await prisma.syncConnection.update({ where: { id: conn.id }, data: { direction: "push" } });
  await prisma.note.updateMany({ where: { vaultId: vault.id, path: "a.md" }, data: { content: "# A\nPUSHED NOW" } });
  writeFileSync(path.join(c1, "f.md"), "# F\nremote only");
  push(c1, "remote adds f");
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  check("direction=push: web edit pushed", readFileSync(path.join(c1, "a.md"), "utf8").includes("PUSHED NOW"));
  check("direction=push: remote note NOT imported", (await noteContent("f.md")) === null);

  // --- 6. attachments travel with the repo (needs the dev Garage tunnel) ---
  await prisma.syncConnection.update({ where: { id: conn.id }, data: { direction: "both" } });
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const storageKey = makeStorageKey(vault.id, "pic one.png");
  const storageKeys = [storageKey];
  await putObject(storageKey, PNG, "image/png");
  const att = await prisma.attachment.create({ data: { vaultId: vault.id, filename: "pic one.png", mimeType: "image/png", size: PNG.length, storageKey } });
  const url = `/api/v1/vaults/${vault.id}/attachments/${att.id}/download`;
  await note("img.md", `# Img\n![pic](${url})\n`);
  await runSyncJob(prisma, conn.id);
  git(c1, "pull");
  check("attachments: file pushed to attachments/", existsSync(path.join(c1, "attachments", "pic one.png")));
  const pushed = readFileSync(path.join(c1, "img.md"), "utf8");
  check("attachments: note link is repo-relative in the repo", pushed.includes("![pic](attachments/pic%20one.png)") && !pushed.includes("/api/v1/"), pushed);
  check("attachments: DB link stays a web URL", ((await noteContent("img.md")) ?? "").includes(url));
  const jobsBefore = await prisma.syncJob.count({ where: { syncConnectionId: conn.id } });
  await runSyncJob(prisma, conn.id);
  check("attachments: second sync is a no-op (no duplicate upload)", (await prisma.attachment.count({ where: { vaultId: vault.id } })) === 1 && (await prisma.syncJob.count({ where: { syncConnectionId: conn.id } })) === jobsBefore + 1);

  // remote edits an attachment's bytes (same name, same size) → the stored object is replaced
  git(c1, "pull");
  const edited = Buffer.from(PNG);
  edited[edited.length - 5] ^= 0xff;
  writeFileSync(path.join(c1, "attachments", "pic one.png"), edited);
  push(c1, "remote edits the picture");
  await runSyncJob(prisma, conn.id);
  const stream = await getObjectStream(storageKey);
  const chunks: Buffer[] = [];
  for await (const c of stream as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  check("attachments: remote edit of a binary reaches storage", Buffer.concat(chunks).equals(edited));

  mkdirSync(path.join(c1, "assets", "img"), { recursive: true });
  writeFileSync(path.join(c1, "assets", "img", "remote pic.png"), PNG);
  writeFileSync(path.join(c1, "gallery.md"), "# Gallery\n![r](assets/img/remote%20pic.png)\n");
  push(c1, "remote adds image + note");
  await runSyncJob(prisma, conn.id);
  const remoteAtt = await prisma.attachment.findFirst({ where: { vaultId: vault.id, filename: "remote pic.png" } });
  if (remoteAtt) storageKeys.push(remoteAtt.storageKey);
  check("attachments: remote image imported with its repo path", remoteAtt?.syncPath === "assets/img/remote pic.png", JSON.stringify(remoteAtt));
  check("attachments: remote note link rewritten to web URL", ((await noteContent("gallery.md")) ?? "").includes(`/attachments/${remoteAtt?.id}/download`), String(await noteContent("gallery.md")));
  const ids = new Map([[att.id, "attachments/pic one.png"]]);
  const rel = toRelativeLinks(vault.id, "sub/n.md", `![x](${url})`, ids);
  check("link helpers: relative path from a subfolder", rel === "![x](../attachments/pic%20one.png)", rel);
  check("link helpers: round trip is identity", fromRelativeLinks(vault.id, "sub/n.md", rel, new Map([["attachments/pic one.png".toLowerCase(), att.id]])) === `![x](${url})`);
  for (const k of storageKeys) await deleteObject(k).catch(() => undefined);

  // --- 7. helpers ---
  check("commit template tokens", formatCommitMessage("x {count} {date}", 3, new Date("2026-01-02T03:04:05Z")) === "x 3 2026-01-02");
  const at = new Date("2026-01-02T03:04:05Z");
  check("conflict copy name", conflictCopyPath("sub/n.md", () => false, at) === "sub/n (conflict 2026-01-02 0304).md");
  check(
    "conflict copy name: numbered when taken",
    conflictCopyPath("n.md", (c) => c === "n (conflict 2026-01-02 0304).md", at) === "n (conflict 2026-01-02 0304 2).md"
  );
  const body = askpassBody({ username: "me", token: "tok'en" }, false);
  const script = path.join(root, "askpass.sh");
  writeFileSync(script, body, { mode: 0o700 });
  if (process.platform !== "win32") {
    check(
      "askpass answers username/password prompts",
      execFileSync(script, ["Username for 'https://x'"], { encoding: "utf8" }).trim() === "me" &&
        execFileSync(script, ["Password for 'https://me@x'"], { encoding: "utf8" }).trim() === "tok'en"
    );
  } else {
    check("askpass script generated (the .sh variant is executed on Linux CI only)", body.includes("case"));
  }
  const hostEnv = hostEnvForGit({
    PATH: "/bin",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "credential.interactive",
    GIT_CONFIG_VALUE_0: "false",
    GIT_CONFIG_PARAMETERS: "'credential.interactive'='false'",
    GIT_ASKPASS: "/somewhere/else",
  });
  check(
    "host git config and askpass are not inherited (they made git skip our askpass)",
    JSON.stringify(hostEnv) === JSON.stringify({ PATH: "/bin" }),
    JSON.stringify(hostEnv)
  );

  // A working copy whose first fetch failed started its own history; the next sync joins it with the remote's.
  const upstream = path.join(root, "unrelated.git");
  git(root, "init", "--bare", "-b", "main", upstream);
  const seed = path.join(root, "unrelated-seed");
  git(root, "clone", upstream, seed);
  writeFileSync(path.join(seed, "r.md"), "remote only");
  writeFileSync(path.join(seed, "same.md"), "remote side");
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "remote history");
  git(seed, "push", "origin", "HEAD:main");
  const wc = path.join(root, "unrelated-wc");
  mkdirSync(wc);
  git(wc, "init", "-b", "main");
  git(wc, "remote", "add", "origin", upstream);
  writeFileSync(path.join(wc, "w.md"), "web only");
  writeFileSync(path.join(wc, "same.md"), "web side");
  git(wc, "add", "-A");
  git(wc, "commit", "-m", "own history");
  const joined = await gitSyncCore(wc, "main", null, "web").then(
    (r) => r,
    (e: Error) => e
  );
  const sameCopy = existsSync(wc) ? execFileSync("git", ["ls-files"], { cwd: wc, encoding: "utf8" }).split("\n").find((f) => f.startsWith("same (conflict ")) : undefined;
  check(
    "unrelated histories: joined, both sides kept",
    !(joined instanceof Error) &&
      readFileSync(path.join(wc, "r.md"), "utf8") === "remote only" &&
      readFileSync(path.join(wc, "w.md"), "utf8") === "web only" &&
      readFileSync(path.join(wc, "same.md"), "utf8") === "web side" &&
      !!sameCopy &&
      readFileSync(path.join(wc, sameCopy), "utf8") === "remote side",
    joined instanceof Error ? joined.message : String(sameCopy)
  );
  git(seed, "pull", "origin", "main");
  check("unrelated histories: pushed to the remote", existsSync(path.join(seed, "w.md")));

  // A first fetch that fails for another reason (auth, network, wrong URL) leaves no half-made repo behind.
  const wcBad = path.join(root, "bad-remote-wc");
  const badErr = await ensureWorkingCopy(wcBad, path.join(root, "missing.git"), "main", null).then(
    () => null,
    (e: Error) => e
  );
  check(
    "failed first fetch: error, and no fresh history left to commit into",
    badErr !== null && !existsSync(path.join(wcBad, ".git")),
    badErr?.message ?? "no error"
  );

  await prisma.vault.delete({ where: { id: vault.id } }).catch(() => undefined);
  await prisma.workspace.delete({ where: { id: ws.id } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
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
