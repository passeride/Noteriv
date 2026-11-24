/**
 * Browser-side vault import (parity plan v2, Pha 3). Reads a picked folder or a
 * .zip, uploads binary files as attachments, rewrites note links that pointed at
 * them (relative markdown paths and Obsidian-style ![[file.png]] embeds) to the
 * attachment download URL, then sends the notes to the server in batches.
 */

import { webApi, ApiError, isEmailUnverified, planLimit } from "@/lib/webApi";
import { getAttachmentType, markdownLinkForAttachment } from "@/lib/attachment-utils";
import { t } from "@noteriv/ui/i18n";

/** Same 25MB ceiling the multipart upload route enforces. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const IGNORED_DIRS = new Set([".git", ".obsidian", ".trash", ".noteriv", "node_modules", "__MACOSX", ".idea", ".vscode"]);
const IGNORED_FILES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

export interface ImportItem {
  /** Vault-relative POSIX path, e.g. "Step 2/Bài học 01.md". */
  path: string;
  size: number;
  read: () => Promise<Blob>;
}

export interface ImportScan {
  rootName: string;
  notes: ImportItem[];
  attachments: ImportItem[];
  /** Files left out on purpose, with the reason. */
  skipped: { path: string; reason: string }[];
}

export interface ImportOptions {
  onConflict: "skip" | "overwrite";
}

export interface ImportProgress {
  phase: "attachments" | "notes" | "finalize" | "done";
  done: number;
  total: number;
  message?: string;
}

export interface ImportReport {
  notesCreated: number;
  notesUpdated: number;
  notesSkipped: number;
  attachmentsUploaded: number;
  attachmentsReused: number;
  failures: { path: string; error: string }[];
  cancelled: boolean;
}

function classify(path: string, size: number, out: ImportScan) {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((p) => IGNORED_DIRS.has(p))) return null;
  if (IGNORED_FILES.has(name.toLowerCase()) || name.startsWith("._")) return null;
  if (name.startsWith(".")) {
    out.skipped.push({ path, reason: t("web.import.reason.hidden") });
    return null;
  }
  return /\.md$/i.test(name) ? ("note" as const) : ("attachment" as const);
}

function finalizeScan(scan: ImportScan): ImportScan {
  const tooBig = scan.attachments.filter((a) => a.size > MAX_ATTACHMENT_BYTES);
  for (const a of tooBig) scan.skipped.push({ path: a.path, reason: t("web.import.reason.tooBig") });
  scan.attachments = scan.attachments.filter((a) => a.size <= MAX_ATTACHMENT_BYTES);
  return scan;
}

/** Drops a single shared top-level folder so "MyVault/a.md" imports as "a.md". */
function stripCommonRoot(paths: string[]): string {
  if (paths.length === 0) return "";
  const first = paths[0].split("/")[0];
  return paths.every((p) => p.includes("/") && p.split("/")[0] === first) ? first : "";
}

/** Scan a folder chosen with <input webkitdirectory>. */
export function scanFolder(files: File[]): ImportScan {
  const rels = files.map((f) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, "/"));
  const root = stripCommonRoot(rels);
  const scan: ImportScan = { rootName: root || "Imported vault", notes: [], attachments: [], skipped: [] };
  files.forEach((file, i) => {
    const path = root ? rels[i].slice(root.length + 1) : rels[i];
    const kind = classify(path, file.size, scan);
    if (!kind) return;
    const item: ImportItem = { path, size: file.size, read: async () => file };
    (kind === "note" ? scan.notes : scan.attachments).push(item);
  });
  return finalizeScan(scan);
}

/**
 * Scan single files picked one by one (a few .md notes, maybe with the images they use).
 * They carry no folder of their own: each lands under its file name, and `intoFolder`
 * places them in a vault folder.
 */
export function scanFiles(files: File[]): ImportScan {
  const notes = files.filter((f) => /\.md$/i.test(f.name));
  const rootName = notes.length === 1 ? notes[0].name.replace(/\.md$/i, "") : "Imported notes";
  const scan: ImportScan = { rootName, notes: [], attachments: [], skipped: [] };
  for (const file of files) {
    const path = file.name;
    const kind = classify(path, file.size, scan);
    if (!kind) continue;
    const item: ImportItem = { path, size: file.size, read: async () => file };
    (kind === "note" ? scan.notes : scan.attachments).push(item);
  }
  return finalizeScan(scan);
}

/** The same scan with every path moved under `folder` (a vault folder path; "" = the vault root). */
export function intoFolder(scan: ImportScan, folder: string): ImportScan {
  const prefix = folder.replace(/^\/+|\/+$/g, "");
  if (!prefix) return scan;
  const move = (item: ImportItem): ImportItem => ({ ...item, path: `${prefix}/${item.path}` });
  return { ...scan, notes: scan.notes.map(move), attachments: scan.attachments.map(move) };
}

/** Scan a .zip (e.g. a vault exported from Noteriv/Obsidian or zipped by hand). */
export async function scanZip(zipFile: File): Promise<ImportScan> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(zipFile);
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  const rels = entries.map((e) => e.name.replace(/\\/g, "/"));
  const root = stripCommonRoot(rels);
  const scan: ImportScan = {
    rootName: root || zipFile.name.replace(/\.zip$/i, "") || "Imported vault",
    notes: [],
    attachments: [],
    skipped: [],
  };
  entries.forEach((entry, i) => {
    const path = root ? rels[i].slice(root.length + 1) : rels[i];
    // JSZip doesn't expose the uncompressed size publicly without reading; use the internal value when present.
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    const kind = classify(path, size, scan);
    if (!kind) return;
    const item: ImportItem = { path, size, read: () => entry.async("blob") };
    (kind === "note" ? scan.notes : scan.attachments).push(item);
  });
  // Size is unknown for zip entries without reading them; the server's 25MB limit is the backstop.
  return finalizeScan(scan);
}

/**
 * Puts what an import from another app produced (Notion, Evernote, HTML: notes and attachments at vault paths) through
 * the same import as a folder: attachments uploaded, links to them rewritten, notes sent in batches. Notes already
 * at a path are kept.
 */
export async function importConverted(
  vaultId: string,
  result: { notes: { path: string; content: string }[]; attachments: { path: string; data: Uint8Array }[] },
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ written: number; kept: number; failed: { path: string; error: string }[]; cancelled: boolean }> {
  const scan: ImportScan = {
    rootName: "",
    notes: result.notes.map((n) => ({ path: n.path, size: n.content.length, read: async () => new Blob([n.content], { type: "text/markdown" }) })),
    attachments: result.attachments.map((a) => ({ path: a.path, size: a.data.length, read: async () => new Blob([a.data as BlobPart]) })),
    skipped: [],
  };
  const files = scan.attachments.length;
  const total = files + scan.notes.length;
  const report = await runImport(vaultId, finalizeScan(scan), { onConflict: "skip" }, (p) => {
    if (p.phase === "attachments") onProgress(p.done, total);
    else if (p.phase === "notes") onProgress(files + p.done, total);
    else onProgress(total, total);
  }, signal);
  return {
    written: report.notesCreated + report.notesUpdated + report.attachmentsUploaded + report.attachmentsReused,
    kept: report.notesSkipped,
    failed: [...report.failures, ...scan.skipped.map((s) => ({ path: s.path, error: s.reason }))],
    cancelled: report.cancelled,
  };
}

// ── link rewriting ──

function posixDirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function posixResolve(dir: string, rel: string): string {
  const out: string[] = dir ? dir.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export interface AttachmentRef {
  id: string;
  filename: string;
}

/**
 * Rewrites references to imported attachments inside one note.
 * `byPath` is keyed by lower-cased vault-relative path, `byName` by lower-cased
 * basename (Obsidian embeds resolve by name, wherever the file lives).
 */
export function rewriteAttachmentLinks(
  vaultId: string,
  notePath: string,
  content: string,
  byPath: Map<string, AttachmentRef>,
  byName: Map<string, AttachmentRef>
): string {
  const dir = posixDirname(notePath);
  const urlFor = (a: AttachmentRef) => webApi.attachments.downloadUrl(vaultId, a.id);

  // 1) ![[file.png]] / ![[file.png|alias]] / [[file.pdf]] where the target is an imported (non-.md) file.
  let out = content.replace(/(!)?\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (whole, bang: string | undefined, target: string, alias: string | undefined) => {
    const t = target.trim();
    if (/\.md$/i.test(t)) return whole;
    const ref = byPath.get(t.toLowerCase()) ?? byPath.get(posixResolve(dir, t).toLowerCase()) ?? byName.get(t.split("/").pop()!.toLowerCase());
    if (!ref) return whole;
    const label = alias?.trim() || ref.filename;
    return markdownLinkForAttachment(label, getAttachmentType(ref.filename), urlFor(ref));
  });

  // 2) [text](relative/path.png "title") and ![alt](<relative path.png>)
  out = out.replace(/(!?\[[^\]]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g, (whole, head: string, rawTarget: string, tail: string) => {
    const target = rawTarget.startsWith("<") ? rawTarget.slice(1, -1) : rawTarget;
    if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return whole; // absolute URL, anchor, or server path
    const clean = safeDecode(target.split("#")[0].split("?")[0]);
    const ref = byPath.get(posixResolve(dir, clean).toLowerCase()) ?? byPath.get(clean.toLowerCase());
    return ref ? `${head}${urlFor(ref)}${tail}` : whole;
  });

  return out;
}

// ── runner ──

async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>, shouldStop: () => boolean) {
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!shouldStop()) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  bmp: "image/bmp", ico: "image/x-icon", tif: "image/tiff", tiff: "image/tiff", pdf: "application/pdf",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", flac: "audio/flac", aac: "audio/aac",
  webm: "audio/webm", mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", txt: "text/plain",
  json: "application/json", csv: "text/csv",
};

/** Zip entries come back as untyped blobs; the extension decides how the browser later renders the file. */
function mimeFor(filename: string, blobType: string): string {
  if (blobType) return blobType;
  return MIME_BY_EXT[filename.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

const BATCH_MAX_FILES = 200;
const BATCH_MAX_CHARS = 6_000_000;

export async function runImport(
  vaultId: string,
  scan: ImportScan,
  opts: ImportOptions,
  onProgress: (p: ImportProgress) => void,
  signal?: AbortSignal
): Promise<ImportReport> {
  const report: ImportReport = {
    notesCreated: 0,
    notesUpdated: 0,
    notesSkipped: 0,
    attachmentsUploaded: 0,
    attachmentsReused: 0,
    failures: [],
    cancelled: false,
  };
  const stop = () => !!signal?.aborted;

  // 1) attachments — reuse ones already in the vault (same name + size) so re-running an import is idempotent.
  const byPath = new Map<string, AttachmentRef>();
  const byName = new Map<string, AttachmentRef>();
  const existing = await webApi.attachments.list(vaultId).catch(() => null);
  const existingKey = new Map<string, AttachmentRef>();
  for (const a of existing?.attachments ?? []) existingKey.set(`${a.filename}\u0000${a.size}`, { id: a.id, filename: a.filename });

  let done = 0;
  let quotaHit = false;
  // An account whose email is not verified may not upload (web/server/src/lib/emailGate.ts): stop after the first no.
  let unverified = false;
  onProgress({ phase: "attachments", done, total: scan.attachments.length });
  await pool(
    scan.attachments,
    3,
    async (item) => {
      if (quotaHit) {
        report.failures.push({ path: item.path, error: t("web.import.reason.quota") });
        return;
      }
      if (unverified) {
        report.failures.push({ path: item.path, error: t("web.import.reason.unverified") });
        return;
      }
      const filename = item.path.split("/").pop()!;
      try {
        const blob = await item.read();
        const reused = existingKey.get(`${filename}\u0000${blob.size}`);
        let ref: AttachmentRef;
        if (reused) {
          ref = reused;
          report.attachmentsReused++;
        } else {
          const file = new File([blob], filename, { type: mimeFor(filename, blob.type) });
          const created = await webApi.attachments.upload(vaultId, file);
          ref = { id: created.id, filename: created.filename };
          existingKey.set(`${filename}\u0000${blob.size}`, ref);
          report.attachmentsUploaded++;
        }
        byPath.set(item.path.toLowerCase(), ref);
        if (!byName.has(filename.toLowerCase())) byName.set(filename.toLowerCase(), ref);
      } catch (err) {
        if (planLimit(err)) {
          quotaHit = true;
          report.failures.push({ path: item.path, error: t("web.import.reason.quota") });
          return;
        }
        if (isEmailUnverified(err)) {
          unverified = true;
          report.failures.push({ path: item.path, error: t("web.import.reason.unverified") });
          return;
        }
        report.failures.push({ path: item.path, error: err instanceof ApiError ? t("web.import.errorStatus", { status: err.status }) : t("web.import.uploadFailed") });
      } finally {
        done++;
        onProgress({ phase: "attachments", done, total: scan.attachments.length });
      }
    },
    stop
  );
  if (stop()) return { ...report, cancelled: true };

  // 2) notes, in size-bounded batches
  done = 0;
  const total = scan.notes.length;
  onProgress({ phase: "notes", done, total });
  let batch: { path: string; content: string }[] = [];
  let batchChars = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const files = batch;
    batch = [];
    batchChars = 0;
    try {
      const res = await webApi.vaultTransfer.importNotes(vaultId, files, opts.onConflict);
      report.notesCreated += res.created;
      report.notesUpdated += res.updated;
      report.notesSkipped += res.skipped;
      for (const e of res.errors) report.failures.push(e);
    } catch (err) {
      for (const f of files) report.failures.push({ path: f.path, error: err instanceof ApiError ? t("web.import.errorStatus", { status: err.status }) : t("web.import.sendFailed") });
    }
    done += files.length;
    onProgress({ phase: "notes", done, total });
  };

  for (const item of scan.notes) {
    if (stop()) break;
    try {
      const raw = await (await item.read()).text();
      const content = rewriteAttachmentLinks(vaultId, item.path, raw, byPath, byName);
      if (batch.length >= BATCH_MAX_FILES || batchChars + content.length > BATCH_MAX_CHARS) await flush();
      batch.push({ path: item.path, content });
      batchChars += content.length;
    } catch {
      report.failures.push({ path: item.path, error: t("web.import.reason.unreadable") });
      done++;
    }
  }
  await flush();
  if (stop()) {
    // The notes written before the cancel stay: their links across batches still get their backlinks.
    if (report.notesCreated + report.notesUpdated > 0) await webApi.vaultTransfer.finalize(vaultId).catch(() => undefined);
    return { ...report, cancelled: true };
  }

  // 3) backlinks across batches
  onProgress({ phase: "finalize", done: 0, total: 1 });
  await webApi.vaultTransfer.finalize(vaultId).catch(() => undefined);
  onProgress({ phase: "done", done: 1, total: 1 });
  return report;
}
