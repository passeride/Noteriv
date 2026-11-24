// Checks the sync worker's guards against hostile input (session K-B1). No database, no network:
//   npx tsx scripts/test-security.ts
// Vault paths and branch names, the git transport allow-list, and symlinks in a remote repository.

import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isSafeBranch, isSafeVaultPath, prepareWrite, safeJoin, vaultSegmentError } from "../src/lib/vaultPaths.js";
import { ensureWorkingCopy } from "../src/lib/gitSync.js";
import { assertPublicRemote, isPrivateAddress } from "../src/lib/remoteHost.js";
import { isAdmin } from "../src/lib/registration.js";
import { isSafeInlineMime } from "../src/routes/attachments.js";
import { isAllowedOrigin } from "../src/lib/collabOrigin.js";
import { checkLoginAttempts, recordFailedLogin, resetFailedLogins } from "../src/routes/auth.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// --- Names and paths ---
for (const bad of ["..", ".", "", " ", "a/b", "a\\b", ".git", ".GIT", "x\u0000y", "tab\there"]) {
  check(`segment ${JSON.stringify(bad)} refused`, vaultSegmentError(bad) !== null);
}
for (const good of ["Plan.md", "Kế hoạch #1.md", "a.b.c", ".obsidian", "..notes", "notes.."]) {
  check(`segment ${JSON.stringify(good)} allowed`, vaultSegmentError(good) === null, vaultSegmentError(good));
}
for (const bad of ["../x.md", "a/../../x.md", "/etc/passwd", "C:/x.md", "a//b.md", "a/.git/config", ".git/hooks/post-merge", "a/./b.md"]) {
  check(`path ${JSON.stringify(bad)} refused`, !isSafeVaultPath(bad));
}
check("nested path allowed", isSafeVaultPath("Dự án/2026/Kế hoạch.md"));
const root = mkdtempSync(path.join(tmpdir(), "noteriv-sec-"));
check("safeJoin stays inside", safeJoin(root, "a/b.md") === path.join(root, "a", "b.md"));
check("safeJoin refuses ..", throws(() => safeJoin(root, "../outside.md")));
check("safeJoin refuses .git", throws(() => safeJoin(root, ".git/config")));

// prepareWrite: a symlink left in an older working copy is replaced, never written through.
const outside = path.join(root, "outside.txt");
writeFileSync(outside, "untouched");
const wcOld = path.join(root, "wc-old");
mkdirSync(wcOld, { recursive: true });
let linked = true;
try {
  symlinkSync(outside, path.join(wcOld, "note.md"));
} catch {
  linked = false; // Windows without the right to create symlinks
}
if (linked) {
  const dest = await prepareWrite(wcOld, "note.md");
  writeFileSync(dest, "new text");
  check("prepareWrite replaces a symlink instead of writing through it", readFileSync(outside, "utf8") === "untouched" && !lstatSync(dest).isSymbolicLink());
} else {
  console.log("SKIP  prepareWrite symlink check (cannot create symlinks here)");
}

// --- Branch names ---
for (const bad of ["-x", "--upload-pack=touch /tmp/p", "a..b", "a b", "a:b", "/a", "a/", "a.lock", ".hidden", "a/.b", "x~1", "x^", "@{1}"]) {
  check(`branch ${JSON.stringify(bad)} refused`, !isSafeBranch(bad));
}
for (const good of ["main", "master", "notes/phone", "release-1.2", "v1.0_x"]) {
  check(`branch ${JSON.stringify(good)} allowed`, isSafeBranch(good));
}

// --- Remote hosts: internal addresses refused ---
for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
  check(`address ${ip} is private`, isPrivateAddress(ip));
}
// IPv4 inside IPv6, in the forms `new URL` produces (review of K-B1: "::ffff:7f00:1" got through).
for (const ip of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "::7f00:1", "64:ff9b::a00:1", "2002:7f00:1::", "::ffff:10.0.0.1", "fe80::1%eth0"]) {
  check(`address ${ip} is private`, isPrivateAddress(ip));
}
for (const ip of ["140.82.112.3", "1.1.1.1", "2606:4700::1111", "::ffff:8c52:7003", "2002:8c52:7003::"]) check(`address ${ip} is public`, !isPrivateAddress(ip));
check("URL [::ffff:127.0.0.1] is refused", await assertPublicRemote("https://[::ffff:127.0.0.1]/x.git").then(() => false, () => true));
for (const url of ["https://2130706433/x.git", "https://0x7f.1/x.git", "https://017700000001/x.git"]) {
  check(`remote ${url} (127.0.0.1 written otherwise) refused`, await assertPublicRemote(url).then(() => false, () => true));
}
for (const url of ["https://127.0.0.1/x.git", "https://localhost/x.git", "http://169.254.169.254/latest/", "https://[::1]/dav", "https://10.0.0.5/dav"]) {
  check(`remote ${url} refused`, await assertPublicRemote(url).then(() => false, () => true));
}

// --- Git: local transports refused; symlinks checked out as plain files ---
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { cwd, stdio: "pipe" });
const bare = path.join(root, "remote.git");
git(root, "init", "--bare", "-b", "main", bare);
const seed = path.join(root, "seed");
git(root, "init", "-b", "main", seed);
writeFileSync(path.join(seed, "ok.md"), "fine");
writeFileSync(path.join(root, "secret.txt"), "SECRET");
let symlinkMade = true;
try {
  symlinkSync(path.join(root, "secret.txt"), path.join(seed, "leak.md"));
} catch {
  // Windows without the right to create symlinks: commit the link as git stores it instead.
  symlinkMade = false;
}
if (!symlinkMade) {
  const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: seed, input: path.join(root, "secret.txt") }).toString().trim();
  git(seed, "update-index", "--add", "--cacheinfo", `120000,${blob},leak.md`);
}
git(seed, "add", "ok.md");
if (symlinkMade) git(seed, "add", "leak.md");
git(seed, "commit", "-m", "seed");
git(seed, "push", bare, "main");

const wc = path.join(root, "wc");
let refused = "";
try {
  await ensureWorkingCopy(wc, bare, "main", null);
} catch (err) {
  refused = String(err);
}
// Refused by the host check ("D:\…" parses as a URL without a host; "/tmp/…" does not parse) or by git's transport list.
check("a local remote is refused by default", /not allowed|transport|not a public address|invalid remote URL/i.test(refused), refused);

process.env.SYNC_ALLOW_LOCAL_REMOTES = "1";
const wc2 = path.join(root, "wc2");
await ensureWorkingCopy(wc2, bare, "main", null);
const leak = path.join(wc2, "leak.md");
check("the symlink is checked out as a plain file", !lstatSync(leak).isSymbolicLink());
check("its text is the link target, not the secret", readFileSync(leak, "utf8") !== "SECRET", readFileSync(leak, "utf8"));
check("a branch that looks like an option is refused", (await ensureWorkingCopy(path.join(root, "wc3"), bare, "--upload-pack=x", null).then(() => false, () => true)));

// --- K-B3: Admin verification, Safe inline MIME, Collab origin, Login lockout ---
// 1. ADMIN_EMAILS requires verified email
process.env.ADMIN_EMAILS = "admin@example.com,operator@example.com";
check("role=admin is always admin", isAdmin({ role: "admin", email: "anyone@example.com" }));
check("ADMIN_EMAILS with verified email is admin", isAdmin({ role: "user", email: "admin@example.com", emailVerifiedAt: new Date() }));
check("ADMIN_EMAILS unverified is NOT admin", !isAdmin({ role: "user", email: "admin@example.com", emailVerifiedAt: null }));
check("ADMIN_EMAILS without emailVerifiedAt is NOT admin", !isAdmin({ role: "user", email: "admin@example.com" }));
check("regular user with verified email is NOT admin", !isAdmin({ role: "user", email: "user@example.com", emailVerifiedAt: new Date() }));

// 2. Safe inline MIME types whitelist
for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "application/pdf", "audio/mpeg", "video/mp4"]) {
  check(`safe inline MIME ${mime} allowed`, isSafeInlineMime(mime));
}
for (const mime of ["image/svg+xml", "text/html", "text/javascript", "application/javascript", "application/xhtml+xml", "text/xml"]) {
  check(`unsafe MIME ${mime} refused inline`, !isSafeInlineMime(mime));
}

// 3. Collab WebSocket Origin validation
check("non-browser client (no origin) allowed", isAllowedOrigin(undefined));
check("tauri origin allowed", isAllowedOrigin("tauri://localhost"));
check("localhost origin allowed", isAllowedOrigin("http://localhost:3000"));
check("127.0.0.1 origin allowed", isAllowedOrigin("http://127.0.0.1:4002"));
check("production domain allowed", isAllowedOrigin("https://noteriv.dsc.edu.vn"));
check("staging domain allowed", isAllowedOrigin("https://staging-noteriv.dsc.edu.vn"));
process.env.APP_ORIGIN = "https://custom-noteriv.example.com";
check("custom APP_ORIGIN domain allowed", isAllowedOrigin("https://custom-noteriv.example.com"));
check("subdomain takeover or evil origin refused", !isAllowedOrigin("https://evil.com"));
check("prefix attack origin refused", !isAllowedOrigin("https://noteriv.dsc.edu.vn.attacker.com"));

// 4. Per-account login lockout
const testEmail = "victim@example.com";
resetFailedLogins(testEmail);
check("initial login attempt allowed", checkLoginAttempts(testEmail).allowed);
for (let i = 0; i < 4; i++) recordFailedLogin(testEmail);
check("4 failed attempts still allowed", checkLoginAttempts(testEmail).allowed);
recordFailedLogin(testEmail); // 5th attempt
check("5th failed attempt triggers lockout", !checkLoginAttempts(testEmail).allowed);
resetFailedLogins(testEmail);
check("reset clears lockout", checkLoginAttempts(testEmail).allowed);


rmSync(root, { recursive: true, force: true });
console.log(failures ? `${failures} FAILED` : "ALL PASSED");
process.exit(failures ? 1 : 0);
