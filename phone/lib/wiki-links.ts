import { readFile, listAllMarkdownFiles } from '@/lib/file-system';
import { vaultRelativePath } from '@/lib/sync-state';

export interface ParsedWikiLink {
  raw: string;
  target: string;
  display: string;
  heading: string | null;
}

export interface Backlink {
  filePath: string;
  fileName: string;
  line: number;
  text: string;
}

const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

/**
 * Parse a single wiki link string (including the brackets) into its components.
 *
 * Supports:
 * - [[file]]
 * - [[file|display]]
 * - [[file#heading]]
 * - [[file#heading|display]]
 */
export function parseWikiLink(raw: string): ParsedWikiLink {
  // Strip outer brackets
  let inner = raw;
  if (inner.startsWith('[[') && inner.endsWith(']]')) {
    inner = inner.slice(2, -2);
  }

  let target = inner;
  let display = inner;
  let heading: string | null = null;

  // Check for alias (pipe)
  const pipeIndex = inner.indexOf('|');
  if (pipeIndex !== -1) {
    target = inner.slice(0, pipeIndex).trim();
    display = inner.slice(pipeIndex + 1).trim();
  }

  // Check for heading anchor
  const hashIndex = target.indexOf('#');
  if (hashIndex !== -1) {
    heading = target.slice(hashIndex + 1).trim();
    target = target.slice(0, hashIndex).trim();
  }

  // If no alias was given, the display is the target (without heading)
  if (pipeIndex === -1) {
    display = target || heading || inner;
  }

  return { raw, target, display, heading };
}

/**
 * Find all wiki links in a block of markdown content.
 */
export function findWikiLinks(content: string): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  let match: RegExpExecArray | null;

  // Reset lastIndex for safety
  WIKI_LINK_REGEX.lastIndex = 0;

  while ((match = WIKI_LINK_REGEX.exec(content)) !== null) {
    links.push(parseWikiLink(match[0]));
  }

  return links;
}

/** Resolve an Obsidian link while retaining the original file URI for navigation. */
export async function resolveWikiLink(
  raw: string,
  vaultPath: string,
  source?: string | null,
  markdown = false
): Promise<string | null> {
  const { target, heading } = parseWikiLink(raw);
  if (!target) return heading ? source ?? null : null;

  const key = (path: string) => path.replace(/\.(md|markdown)$/i, '').normalize('NFC').toLowerCase();
  const sourcePath = source ? vaultRelativePath(vaultPath, source) : '';
  const sourceDir = sourcePath.split('/').slice(0, -1);
  const files = await listAllMarkdownFiles(vaultPath);
  const candidates = files.map(file => ({
    uri: file.filePath,
    path: key(vaultRelativePath(vaultPath, file.filePath)),
    name: key(file.fileName),
  }));

  let name = target.trim();
  if (markdown) {
    try { name = decodeURIComponent(name); } catch { return null; }
  }
  const relative = name.startsWith('/') ? [] : [...sourceDir];
  for (const part of name.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!relative.length) return null;
      relative.pop();
    } else {
      relative.push(part);
    }
  }
  const exact = (path: string) => candidates.find(file => file.path === key(path))?.uri;
  const local = exact(relative.join('/'));
  if (markdown) return local ?? null;
  if (name.startsWith('./') || name.startsWith('../')) return local ?? null;
  return (name.includes('/') ? exact(name.replace(/^\//, '')) ?? local : local)
    ?? candidates.find(file => name.includes('/') ? file.path.endsWith('/' + key(name)) : file.name === key(name))?.uri
    ?? null;
}

/**
 * Find all files in the vault that contain a wiki link pointing to the given file.
 */
export async function findBacklinks(
  filePath: string,
  vaultPath: string
): Promise<Backlink[]> {
  const allFiles = await listAllMarkdownFiles(vaultPath);
  const backlinks: Backlink[] = [];

  // Determine the target name we are looking for
  const targetName = fileNameFromPath(filePath).toLowerCase();

  for (const file of allFiles) {
    // Skip the file itself
    if (file.filePath === filePath) continue;

    const content = await readFile(file.filePath);
    if (!content) continue;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineLinks = findWikiLinksInLine(lines[i]);

      for (const link of lineLinks) {
        if (link.target.toLowerCase() === targetName) {
          backlinks.push({
            filePath: file.filePath,
            fileName: file.fileName,
            line: i + 1,
            text: lines[i].trim(),
          });
          // Only record one backlink per line per file
          break;
        }
      }
    }
  }

  return backlinks;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findWikiLinksInLine(line: string): ParsedWikiLink[] {
  const links: ParsedWikiLink[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    links.push(parseWikiLink(match[0]));
  }

  return links;
}

function fileNameFromPath(filePath: string): string {
  const segments = filePath.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  return last.replace(/\.(md|markdown)$/i, '');
}
