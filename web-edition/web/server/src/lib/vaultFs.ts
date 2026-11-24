// Bridges Postgres (source of truth) and a local scratch directory that the
// git/WebDAV sync engines operate on. Only `.md` content is in scope for now —
// attachments/binary files are Phase 6 (object storage) work.

import type { PrismaClient } from "@prisma/client";
import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { recomputeBacklinksForNote } from "./backlinks.js";
import { snapshotBeforeOverwrite } from "./noteSnapshots.js";
import { trashNote } from "./trash.js";
import { isSafeVaultPath, prepareWrite } from "./vaultPaths.js";
import { conflictCopyPath } from "./gitSync.js";

export interface ImportOptions {
  transform?: (notePath: string, content: string) => string;
  /**
   * When the vault was exported for this sync. A note edited after this moment changed
   * while the sync ran: its newer content is kept and the file's version becomes a
   * conflict copy; a note created after it is never trashed for lacking a file.
   * Omitted (e.g. "take remote"), the files simply win.
   */
  exportedAt?: Date;
}

export interface ImportReport {
  /** Vault paths of notes created to hold content that would otherwise have been overwritten. */
  conflictCopies: string[];
  /** Notes moved to the trash because their file is gone. */
  trashed: number;
}

/** Writes every note in the vault to `dir/<path>`, removing files for notes that no longer exist (unless `prune: false`). */
export async function exportNotesToDir(
  prisma: PrismaClient,
  vaultId: string,
  dir: string,
  opts: { prune?: boolean; transform?: (notePath: string, content: string) => string } = {}
): Promise<void> {
  const prune = opts.prune !== false;
  const transform = opts.transform ?? ((_p: string, c: string) => c);
  // Trashed notes (deletedAt set) stay out of the export so they leave the repo too.
  const notes = await prisma.note.findMany({ where: { vaultId, deletedAt: null }, select: { path: true, content: true } });
  const wanted = new Set(notes.map((n) => n.path));

  await mkdir(dir, { recursive: true });
  for (const note of notes) {
    // A path that is not a safe vault path (older data: "..", ".git") is left out of the working copy.
    if (!isSafeVaultPath(note.path)) {
      console.warn(`[sync] skipped unsafe note path ${JSON.stringify(note.path)} in vault ${vaultId}`);
      continue;
    }
    const dest = await prepareWrite(dir, note.path);
    await writeFile(dest, transform(note.path, note.content), "utf8");
  }

  // Remove tracked .md files whose note was deleted in the DB since last export.
  async function pruneRecurse(cur: string) {
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
        await pruneRecurse(full);
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        const rel = path.relative(dir, full).replace(/\\/g, "/");
        // Only paths an import would have read: a remote file skipped for its name is left alone, not deleted.
        if (entry.isFile() && isSafeVaultPath(rel) && !wanted.has(rel)) await unlink(full).catch(() => undefined);
      }
    }
  }
  if (prune) await pruneRecurse(dir);
}

/**
 * Reads every `.md` file in `dir` back into Postgres: updates notes by path (after a
 * snapshot of the old content), creates notes for new files, and moves notes whose file
 * is gone to the trash. Trashed notes are never touched, and nothing is hard-deleted.
 */
export async function importDirToNotes(
  prisma: PrismaClient,
  vaultId: string,
  dir: string,
  actorUserId: string | null,
  opts: ImportOptions = {}
): Promise<ImportReport> {
  const transform = opts.transform ?? ((_p: string, c: string) => c);
  const exportedAt = opts.exportedAt;
  const report: ImportReport = { conflictCopies: [], trashed: 0 };
  const files: Array<{ rel: string; full: string }> = [];
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
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        // Regular files only: a symlink in a remote repository could point anywhere on this machine.
        const rel = path.relative(dir, full).replace(/\\/g, "/");
        if (isSafeVaultPath(rel)) files.push({ rel, full });
      }
    }
  }
  await recurse(dir);

  // Every path in the vault (trashed ones included) is unique, so conflict copies must avoid all of them.
  const allNotes = await prisma.note.findMany({
    where: { vaultId },
    select: { id: true, path: true, content: true, deletedAt: true, createdAt: true, updatedAt: true },
  });
  const takenPaths = new Set(allNotes.map((n) => n.path));
  for (const f of files) takenPaths.add(f.rel);
  const liveByPath = new Map(allNotes.filter((n) => !n.deletedAt).map((n) => [n.path, n]));
  const existingFolders = await prisma.folder.findMany({ where: { vaultId }, select: { id: true, path: true } });
  const folderByPath = new Map(existingFolders.map((f) => [f.path, f.id]));

  const createNote = async (rel: string, content: string) => {
    const lastSlash = rel.lastIndexOf("/");
    const name = lastSlash === -1 ? rel : rel.slice(lastSlash + 1);
    const folderPath = lastSlash === -1 ? null : rel.slice(0, lastSlash);
    const folderId = folderPath ? await ensureFolderChain(prisma, vaultId, folderPath, folderByPath) : null;
    const created = await prisma.note.create({
      data: {
        vaultId,
        folderId,
        name,
        path: rel,
        content,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
    takenPaths.add(rel);
    await recomputeBacklinksForNote(prisma, vaultId, created.id, content);
  };
  const createConflictCopy = async (rel: string, content: string) => {
    const copy = conflictCopyPath(rel, (c) => takenPaths.has(c));
    await createNote(copy, content);
    report.conflictCopies.push(copy);
  };

  const seenPaths = new Set<string>();

  for (const { rel, full } of files) {
    seenPaths.add(rel);
    const content = transform(rel, await readFile(full, "utf8"));
    const existing = liveByPath.get(rel);

    if (existing) {
      if (existing.content === content) continue;
      if (exportedAt && existing.updatedAt > exportedAt) {
        // Edited on the web while this sync ran: keep that edit, save the file's version beside it.
        await createConflictCopy(rel, content);
        continue;
      }
      await snapshotBeforeOverwrite(prisma, existing.id, existing.content);
      await prisma.note.update({
        where: { id: existing.id },
        data: { content, sizeBytes: Buffer.byteLength(content, "utf8"), updatedById: actorUserId },
      });
      await recomputeBacklinksForNote(prisma, vaultId, existing.id, content);
      continue;
    }

    if (allNotes.some((n) => n.path === rel)) {
      // The path belongs to a note in the trash: leave it there. (Git already turns "trashed on
      // the web, edited remotely" into a conflict copy during the merge; WebDAV, which has no
      // deletion tracking yet, would otherwise resurrect or duplicate the note on every sync.)
      continue;
    }

    // New file pulled from remote — ensure its folder chain exists, then create the note.
    await createNote(rel, content);
  }

  // A live note with no file was deleted remotely: move it to the trash (restorable), never hard-delete.
  for (const note of liveByPath.values()) {
    if (seenPaths.has(note.path)) continue;
    if (exportedAt && note.createdAt > exportedAt) continue; // created while this sync ran
    await snapshotBeforeOverwrite(prisma, note.id, note.content);
    await trashNote(prisma, note.id);
    report.trashed++;
  }

  return report;
}

/**
 * Creates Postgres notes for `.md` files in `dir` whose path isn't already a
 * note in the DB — never updates or deletes existing notes. Used to rescue
 * remote-only files on the very first git sync of an existing vault, where
 * `ensureWorkingCopy` checks out whatever's already on the remote into `dir`
 * *before* the DB's current content is exported there: without this step,
 * `exportNotesToDir`'s prune pass (which only knows paths already in the DB)
 * would delete those remote-only files from `dir`, and the following
 * add/commit/push would propagate that deletion back to the remote — a real
 * data-loss bug, not just a cosmetic one. Paths that exist in both places are
 * deliberately left untouched here: the DB's content is what `exportNotesToDir`
 * writes next, preserving the sync engine's existing "DB content wins on
 * conflict, remote's prior version just becomes earlier git history" rule for
 * every sync (first or not) rather than only for already-established repos.
 */
export async function importNewNotesOnly(
  prisma: PrismaClient,
  vaultId: string,
  dir: string,
  actorUserId: string | null,
  transform: (notePath: string, content: string) => string = (_p, c) => c
): Promise<void> {
  const files: Array<{ rel: string; full: string }> = [];
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
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        // Regular files only: a symlink in a remote repository could point anywhere on this machine.
        const rel = path.relative(dir, full).replace(/\\/g, "/");
        if (isSafeVaultPath(rel)) files.push({ rel, full });
      }
    }
  }
  await recurse(dir);
  if (files.length === 0) return;

  // Trashed notes count too: their paths are still taken (vaultId+path is unique).
  const existingNotes = await prisma.note.findMany({ where: { vaultId }, select: { path: true } });
  const existingPaths = new Set(existingNotes.map((n) => n.path));
  const existingFolders = await prisma.folder.findMany({ where: { vaultId }, select: { id: true, path: true } });
  const folderByPath = new Map(existingFolders.map((f) => [f.path, f.id]));

  for (const { rel, full } of files) {
    if (existingPaths.has(rel)) continue;

    const content = transform(rel, await readFile(full, "utf8"));
    const lastSlash = rel.lastIndexOf("/");
    const name = lastSlash === -1 ? rel : rel.slice(lastSlash + 1);
    const folderPath = lastSlash === -1 ? null : rel.slice(0, lastSlash);
    let folderId: string | null = null;
    if (folderPath) {
      folderId = await ensureFolderChain(prisma, vaultId, folderPath, folderByPath);
    }

    const created = await prisma.note.create({
      data: {
        vaultId,
        folderId,
        name,
        path: rel,
        content,
        sizeBytes: Buffer.byteLength(content, "utf8"),
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
    await recomputeBacklinksForNote(prisma, vaultId, created.id, content);
  }
}

export async function ensureFolderChain(
  prisma: PrismaClient,
  vaultId: string,
  folderPath: string,
  cache: Map<string, string>
): Promise<string> {
  const cached = cache.get(folderPath);
  if (cached) return cached;

  const segments = folderPath.split("/");
  let parentId: string | null = null;
  let acc = "";
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment;
    const existing = cache.get(acc);
    if (existing) {
      parentId = existing;
      continue;
    }
    const folder: { id: string } = await prisma.folder.create({
      data: { vaultId, parentId, name: segment, path: acc },
      select: { id: true },
    });
    cache.set(acc, folder.id);
    parentId = folder.id;
  }
  return parentId!;
}
