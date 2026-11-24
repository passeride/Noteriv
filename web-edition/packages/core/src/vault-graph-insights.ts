import { buildLinkGraph } from "./graph-utils";
import type { NoteRef } from "./vault-adapter";

export interface HubNoteInfo {
  note: NoteRef;
  connections: number;
}

export interface SmartLinkSuggestion {
  targetNote: NoteRef;
  targetTitle: string;
  reason: "unlinked-mention" | "shared-topic";
  matchedTerm: string;
  description: string;
}

export interface VaultGraphAnalysis {
  totalNotes: number;
  totalEdges: number;
  connectedNotesCount: number;
  connectivityRatio: number;
  orphanNotes: NoteRef[];
  hubNotes: HubNoteInfo[];
}

/**
 * Analyzes the entire vault link graph to discover Hub Notes (knowledge centers),
 * Orphan Notes (isolated notes), and overall connectivity health.
 */
export function analyzeVaultGraph(
  notes: NoteRef[],
  contents: ReadonlyMap<string, string>,
  maxHubs = 5
): VaultGraphAnalysis {
  const graph = buildLinkGraph(notes, contents);
  const totalNotes = notes.length;
  const totalEdges = graph.edges.length;

  const orphanNotes: NoteRef[] = [];
  const connectedList: HubNoteInfo[] = [];

  for (const note of notes) {
    const count = graph.connections.get(note.id) ?? 0;
    if (count === 0) {
      orphanNotes.push(note);
    } else {
      connectedList.push({ note, connections: count });
    }
  }

  connectedList.sort((a, b) => b.connections - a.connections);
  const hubNotes = connectedList.slice(0, maxHubs);
  const connectedNotesCount = connectedList.length;
  const connectivityRatio =
    totalNotes > 0 ? Math.round((connectedNotesCount / totalNotes) * 100) : 0;

  return {
    totalNotes,
    totalEdges,
    connectedNotesCount,
    connectivityRatio,
    orphanNotes,
    hubNotes,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTags(content: string): Set<string> {
  const tags = new Set<string>();
  const matches = content.matchAll(/(?:^|\s)#([a-zA-Z0-9_\-\u00C0-\u1EF9]+)/g);
  for (const m of matches) {
    tags.add(m[1].toLowerCase());
  }
  return tags;
}

/**
 * Discovers smart link opportunities for the active note:
 * 1. Unlinked mentions: The active note mentions another note's title in plain text without [[wiki-link]].
 * 2. Shared tags/topics: Another note shares #tags with the active note but isn't linked yet.
 */
export function suggestSmartLinks(
  activeNotePath: string,
  activeContent: string,
  notes: NoteRef[],
  contents?: ReadonlyMap<string, string>,
  limit = 6
): SmartLinkSuggestion[] {
  if (!activeContent.trim()) return [];

  // Find already linked targets in activeContent
  const existingLinks = new Set<string>();
  for (const m of activeContent.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    existingLinks.add(m[1].trim().toLowerCase());
  }

  // Strip out existing [[...]] blocks when checking for unlinked plain-text mentions
  const contentWithoutWikiLinks = activeContent.replace(/\[\[[^\]]+\]\]/g, " ");
  const activeTags = extractTags(activeContent);

  const suggestions: SmartLinkSuggestion[] = [];

  for (const candidate of notes) {
    if (candidate.path === activeNotePath) continue;

    const rawTitle = candidate.name.replace(/\.md$/i, "").trim();
    if (rawTitle.length < 3) continue;

    const lowerTitle = rawTitle.toLowerCase();
    const lowerPath = candidate.path.replace(/\.md$/i, "").toLowerCase();

    if (existingLinks.has(lowerTitle) || existingLinks.has(lowerPath)) {
      continue;
    }

    // 1. Check unlinked mention of candidate's title in activeContent
    const regex = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(rawTitle)}(?=$|[^\\p{L}\\p{N}_])`, "iu");
    if (regex.test(contentWithoutWikiLinks)) {
      suggestions.push({
        targetNote: candidate,
        targetTitle: rawTitle,
        reason: "unlinked-mention",
        matchedTerm: rawTitle,
        description: `Đề cập trực tiếp tới "${rawTitle}" trong bài viết nhưng chưa gắn liên kết [[${rawTitle}]].`,
      });
      if (suggestions.length >= limit) break;
      continue;
    }

    // 2. Check shared tags if contents map is provided
    if (contents && activeTags.size > 0) {
      const candidateContent = contents.get(candidate.id) || "";
      if (candidateContent) {
        const candidateTags = extractTags(candidateContent);
        let sharedTag: string | null = null;
        for (const t of activeTags) {
          if (candidateTags.has(t)) {
            sharedTag = t;
            break;
          }
        }
        if (sharedTag) {
          suggestions.push({
            targetNote: candidate,
            targetTitle: rawTitle,
            reason: "shared-topic",
            matchedTerm: `#${sharedTag}`,
            description: `Cùng chủ đề thẻ #${sharedTag} với ghi chú này.`,
          });
          if (suggestions.length >= limit) break;
        }
      }
    }
  }

  return suggestions;
}
