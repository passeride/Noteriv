import type { PrismaClient } from "@prisma/client";

const WIKILINK_PATTERN = /(!)?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

interface ParsedLink {
  target: string;
  isEmbed: boolean;
}

/** Extracts `[[Target]]`, `[[Target|Alias]]`, `[[Target#Heading]]` and `![[Target]]` references from markdown. */
export function parseWikilinks(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  for (const match of content.matchAll(WIKILINK_PATTERN)) {
    const target = match[2].trim();
    if (target) links.push({ target, isEmbed: match[1] === "!" });
  }
  return links;
}

function stripExtension(name: string): string {
  return name.replace(/\.md$/i, "");
}

/**
 * Recomputes the backlink rows for a note's current content: deletes what it used to
 * link to and inserts fresh rows for whatever it resolves to now. Call this after any
 * create/update that changes `content`. Unresolved link targets are silently skipped —
 * tracking "broken" links is left for a later phase.
 */
export async function recomputeBacklinksForNote(
  prisma: PrismaClient,
  vaultId: string,
  noteId: string,
  content: string
): Promise<void> {
  const links = parseWikilinks(content);

  await prisma.backlink.deleteMany({ where: { sourceNoteId: noteId } });
  if (links.length === 0) return;

  const vaultNotes = await prisma.note.findMany({
    where: { vaultId },
    select: { id: true, name: true, path: true },
  });

  const byStrippedName = new Map<string, string>();
  const byPath = new Map<string, string>();
  for (const n of vaultNotes) {
    byStrippedName.set(stripExtension(n.name).toLowerCase(), n.id);
    byPath.set(stripExtension(n.path).toLowerCase(), n.id);
  }

  const resolved = new Map<string, "wikilink" | "embed">();
  for (const link of links) {
    const key = stripExtension(link.target).toLowerCase();
    const targetId = byPath.get(key) ?? byStrippedName.get(key);
    if (!targetId || targetId === noteId) continue;
    const existing = resolved.get(targetId);
    // embed takes precedence if a note is both wikilinked and embedded
    if (!existing || link.isEmbed) {
      resolved.set(targetId, link.isEmbed ? "embed" : "wikilink");
    }
  }

  if (resolved.size === 0) return;

  await prisma.backlink.createMany({
    data: Array.from(resolved.entries()).map(([targetNoteId, linkType]) => ({
      vaultId,
      sourceNoteId: noteId,
      targetNoteId,
      linkType,
    })),
    skipDuplicates: true,
  });
}
