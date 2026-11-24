/**
 * What the person picked, as the importers read it: single files, the files of a folder (`webkitRelativePath`), or
 * the entries of zips (one level of zips inside, as Notion splits large exports). A folder all files share (the zip's
 * own top folder) is dropped from the paths.
 *
 * Everything is held in memory on the device, so an import has limits: what was picked, what its zips unpack to,
 * and the number of files. Past one, reading stops with an `ImportLimitError` instead of running out of memory.
 */

import type { InputFile } from "./types";

export interface ImportLimits {
  /** Picked files together, as on disk (zips counted packed). */
  pickedBytes: number;
  /** What the zips hold once unpacked, as their entries declare it. */
  unpackedBytes: number;
  files: number;
}

export const IMPORT_LIMITS: ImportLimits = { pickedBytes: 1024 ** 3, unpackedBytes: 2 * 1024 ** 3, files: 50_000 };

export class ImportLimitError extends Error {
  constructor(
    readonly limit: "size" | "files",
    /** Bytes or files found when reading stopped (at least this many). */
    readonly found: number,
    readonly max: number
  ) {
    super(`import limit: ${limit}`);
  }
}

/** Running totals over one pick, checked as files and zip entries are added. */
class Budget {
  private unpacked = 0;
  private files = 0;
  constructor(
    private readonly limits: ImportLimits,
    private readonly signal?: AbortSignal
  ) {}
  addFile() {
    this.signal?.throwIfAborted();
    if (++this.files > this.limits.files) throw new ImportLimitError("files", this.files, this.limits.files);
  }
  addUnpacked(bytes: number) {
    this.unpacked += bytes;
    if (this.unpacked > this.limits.unpackedBytes) throw new ImportLimitError("size", this.unpacked, this.limits.unpackedBytes);
  }
}

const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\._/i;

function fromBlob(path: string, blob: Blob): InputFile {
  return {
    path,
    bytes: async () => new Uint8Array(await blob.arrayBuffer()),
    text: () => blob.text(),
  };
}

/** The size an entry declares in the zip's directory (JSZip keeps it on an internal field; 0 when absent). */
function declaredSize(entry: object): number {
  const size = (entry as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
  return typeof size === "number" && size > 0 ? size : 0;
}

async function zipEntries(data: Blob | Uint8Array, prefix: string, nested: boolean, budget: Budget): Promise<InputFile[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const out: InputFile[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const path = `${prefix}${entry.name.replace(/\\/g, "/")}`;
    if (IGNORED.test(path)) continue;
    if (nested && /\.zip$/i.test(path)) {
      // Only what it holds is counted, not the inner zip itself as well.
      out.push(...(await zipEntries(await entry.async("uint8array"), "", false, budget)));
      continue;
    }
    budget.addUnpacked(declaredSize(entry));
    budget.addFile();
    out.push({ path, bytes: () => entry.async("uint8array"), text: () => entry.async("string") });
  }
  return out;
}

/** Drops a folder every path starts with (`Export/a.md`, `Export/b.md` → `a.md`, `b.md`). */
export function stripCommonRoot(files: InputFile[]): InputFile[] {
  if (files.length === 0) return files;
  const first = files[0].path.split("/")[0];
  if (!files.every((f) => f.path.includes("/") && f.path.split("/")[0] === first)) return files;
  return stripCommonRoot(files.map((f) => ({ ...f, path: f.path.slice(first.length + 1) })));
}

/**
 * Reads picked files into the importers' input. A zip picked as such is opened; a zip inside a picked folder is a file
 * of that folder (an attachment of a page), left as it is. Throws an `ImportLimitError` past a limit, and the
 * signal's reason once it is aborted.
 */
export async function readPicked(
  files: File[],
  { signal, limits = IMPORT_LIMITS }: { signal?: AbortSignal; limits?: ImportLimits } = {}
): Promise<InputFile[]> {
  const picked = files.reduce((sum, f) => sum + f.size, 0);
  if (picked > limits.pickedBytes) throw new ImportLimitError("size", picked, limits.pickedBytes);
  const budget = new Budget(limits, signal);
  const out: InputFile[] = [];
  for (const file of files) {
    const inFolder = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = (inFolder || file.name).replace(/\\/g, "/");
    if (IGNORED.test(path)) continue;
    if (!inFolder && /\.zip$/i.test(file.name)) out.push(...(await zipEntries(file, "", true, budget)));
    else {
      budget.addFile();
      out.push(fromBlob(path, file));
    }
  }
  signal?.throwIfAborted();
  return stripCommonRoot(out);
}
