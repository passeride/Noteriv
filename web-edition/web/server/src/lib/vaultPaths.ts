import path from "node:path";
import { lstat, mkdir, realpath, unlink } from "node:fs/promises";

// Vault paths come from users (note and folder names, imports) and from sync remotes (Git trees, WebDAV listings),
// and end up as files under a sync working copy on the worker. Every one of them is checked here, so none can
// leave that folder, write into its .git metadata, or carry characters a file system misreads.

const CONTROL = /[\u0000-\u001f\u007f]/;

/** Why `name` cannot be one segment of a vault path (a note or folder name), or null if it can. */
export function vaultSegmentError(name: string): string | null {
  if (!name || !name.trim()) return "empty";
  if (name === "." || name === "..") return "dot_segment";
  if (name.includes("/") || name.includes("\\")) return "slash";
  if (CONTROL.test(name)) return "control_character";
  if (name.toLowerCase() === ".git") return "reserved";
  return null;
}

/** Whether `p` is a relative vault path whose every segment is a valid name (`notes/plan.md`). */
export function isSafeVaultPath(p: string): boolean {
  if (!p || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  return p.split("/").every((segment) => vaultSegmentError(segment) === null);
}

/**
 * `rel` (a vault path with "/") under `dir`, refusing anything that is not a safe vault path or that would resolve
 * outside `dir`. Use for every file written or read from a vault path.
 */
export function safeJoin(dir: string, rel: string): string {
  if (!isSafeVaultPath(rel)) throw new Error(`unsafe vault path: ${JSON.stringify(rel)}`);
  const root = path.resolve(dir);
  const full = path.resolve(root, rel.split("/").join(path.sep));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`vault path leaves its folder: ${JSON.stringify(rel)}`);
  return full;
}

/**
 * The file to write for `rel` under `dir`, made ready: its folder exists and resolves inside `dir` (no symlinked
 * folder on the way), and a symlink already at the file itself (from a working copy older than these checks) is
 * removed, so the write creates a plain file instead of following the link.
 */
export async function prepareWrite(dir: string, rel: string): Promise<string> {
  const dest = safeJoin(dir, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  const [realRoot, realParent] = await Promise.all([realpath(dir), realpath(path.dirname(dest))]);
  if (realParent !== realRoot && !realParent.startsWith(realRoot + path.sep)) {
    throw new Error(`vault path leaves its folder through a link: ${JSON.stringify(rel)}`);
  }
  const existing = await lstat(dest).catch(() => null);
  if (existing?.isSymbolicLink()) await unlink(dest);
  return dest;
}

/** Branch names a sync connection may use: git's ref rules, and never anything git could read as an option. */
export function isSafeBranch(branch: string): boolean {
  return (
    /^[A-Za-z0-9._/-]{1,200}$/.test(branch) &&
    !branch.startsWith("-") &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".") &&
    !branch.endsWith(".lock") &&
    !branch.includes("..") &&
    !branch.includes("//") &&
    !branch.split("/").some((part) => part.startsWith("."))
  );
}
