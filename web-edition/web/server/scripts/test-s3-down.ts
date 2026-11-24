// Sync must keep working (and say so) when object storage is unreachable.
// Run: npx tsx scripts/test-s3-down.ts   (uses the dev database; cleans up after itself)

process.env.ATTACHMENTS_S3_ENDPOINT = "http://127.0.0.1:1"; // nothing listens here -> ECONNREFUSED

import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const prisma = new PrismaClient();
const root = mkdtempSync(path.join(tmpdir(), "noteriv-s3down-"));
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + detail}`);
  if (!ok) failed++;
};
const git = (cwd: string, ...a: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8" });

async function main() {
  // imported after the env override above, so the S3 client binds to the dead endpoint
  const { encryptJson } = await import("../src/lib/crypto.js");
  const { runSyncJob } = await import("../src/lib/syncRunner.js");

  const user = await prisma.user.create({ data: { email: `s3down-${Date.now()}@example.test`, displayName: "S3 Down" } });
  const ws = await prisma.workspace.create({ data: { name: "t", ownerId: user.id, members: { create: { userId: user.id, role: "owner" } } } });
  const vault = await prisma.vault.create({ data: { name: "s3-down", workspaceId: ws.id } });
  const bare = path.join(root, "remote.git");
  git(root, "init", "--bare", "-b", "main", bare);

  // remote already holds a note and an image the vault will try to upload
  const seed = path.join(root, "seed");
  git(root, "init", "-b", "main", seed);
  writeFileSync(path.join(seed, "remote.md"), "# Remote\n![x](pic.png)\n");
  writeFileSync(path.join(seed, "pic.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  git(seed, "add", "-A");
  git(seed, "commit", "-m", "seed");
  git(seed, "push", bare, "HEAD:main");

  await prisma.note.create({ data: { vaultId: vault.id, name: "web.md", path: "web.md", content: "# Web\n", sizeBytes: 6, createdById: user.id, updatedById: user.id } });
  const conn = await prisma.syncConnection.create({
    data: { vaultId: vault.id, providerType: "gitea", remoteUrl: bare, branch: "main", authUsername: "", credentialsEncrypted: encryptJson({ username: "", token: "" }) },
  });

  let threw = false;
  try {
    await runSyncJob(prisma, conn.id);
  } catch {
    threw = true;
  }
  const job = await prisma.syncJob.findFirst({ where: { syncConnectionId: conn.id }, orderBy: { createdAt: "desc" } });
  check("sync does not fail when storage is down", !threw && job?.status === "success", JSON.stringify(job));
  check("job carries a readable warning", /bỏ qua .* file đính kèm/.test(job?.errorMessage ?? ""), String(job?.errorMessage));
  check("notes still synced both ways", !!(await prisma.note.findFirst({ where: { vaultId: vault.id, path: "remote.md" } })));

  await prisma.vault.delete({ where: { id: vault.id } }).catch(() => undefined);
  await prisma.workspace.delete({ where: { id: ws.id } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
}

main()
  .catch((e) => {
    console.error("SCRIPT ERROR", e);
    failed++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    rmSync(root, { recursive: true, force: true });
    console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  });
