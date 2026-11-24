import { webApi, ApiError, type ApiNote } from "@/lib/webApi";
import { t } from "@noteriv/ui/i18n";

/** The name of a new note in the interface language ("Untitled", "Chưa đặt tên"). */
const untitled = () => t("files.untitled");

/** "Untitled.md", "Untitled 2.md", … — the first name not already used in `folderId` according to the index. */
export function nextUntitledName(
  notes: { name: string; folderId: string | null }[],
  folderId: string | null,
  start = 1
): string {
  const base = untitled();
  const taken = new Set(notes.filter((n) => n.folderId === folderId).map((n) => n.name.toLowerCase()));
  for (let i = start; i < start + 500; i++) {
    const name = i === 1 ? `${base}.md` : `${base} ${i}.md`;
    if (!taken.has(name.toLowerCase())) return name;
  }
  return `${base} ${Date.now()}.md`;
}

/**
 * Creates an untitled note, picking a free name. The index can be stale and trashed notes still
 * occupy their path on the server, so a 409 (path_exists) just moves on to the next number.
 */
export async function createUntitledNote(
  vaultId: string,
  folderId: string | null,
  notes: { name: string; folderId: string | null }[],
  content = ""
): Promise<ApiNote> {
  let attempt = 1;
  for (let tries = 0; tries < 30; tries++) {
    const name = nextUntitledName(notes, folderId, attempt);
    try {
      return await webApi.notes.create(vaultId, { name, folderId, content });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const m = / (\d+)\.md$/.exec(name);
        attempt = m ? Number(m[1]) + 1 : 2;
        continue;
      }
      throw err;
    }
  }
  throw new Error("could not find a free note name");
}
