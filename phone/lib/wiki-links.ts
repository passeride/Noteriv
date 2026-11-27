import { filePreviewKind } from '@/lib/file-preview';
import { fileExists, readFile, listAllMarkdownFiles } from '@/lib/file-system';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';

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

const noteKey = (path: string) => path.replace(/\.(md|markdown)$/i, '').normalize('NFC').toLowerCase();

async function buildLinkIndex(vaultPath: string) {
  const paths = new Map<string, string>();
  const suffixes = new Map<string, string>();
  for (const file of await listAllMarkdownFiles(vaultPath)) {
    const path = noteKey(vaultRelativePath(vaultPath, file.filePath));
    if (!paths.has(path)) paths.set(path, file.filePath);
    const segments = path.split('/');
    for (let i = 0; i < segments.length; i++) {
      const suffix = segments.slice(i).join('/');
      if (!suffixes.has(suffix)) suffixes.set(suffix, file.filePath);
    }
  }
  return { paths, suffixes };
}

let linkIndex: { vault: string; expires: number; promise: ReturnType<typeof buildLinkIndex> } | undefined;

function getLinkIndex(vault: string) {
  if (linkIndex?.vault === vault && linkIndex.expires > Date.now()) return linkIndex.promise;
  const promise = buildLinkIndex(vault);
  linkIndex = { vault, expires: Date.now() + 60_000, promise };
  void promise.catch(() => {
    if (linkIndex?.promise === promise) linkIndex = undefined;
  });
  return promise;
}

export function warmWikiLinks(vault: string): void {
  void getLinkIndex(vault);
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

  const sourcePath = source ? vaultRelativePath(vaultPath, source) : '';
  const sourceDir = sourcePath.split('/').slice(0, -1);

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
  const localPath = relative.join('/');
  const explicit = markdown || /^[.]{1,2}\//.test(name);
  if (filePreviewKind(localPath)) {
    const rootPath = name.replace(/^\//, '');
    const candidates = [localPath];
    if (!/^[.]{1,2}\//.test(name) && !rootPath.split('/').includes('..')) candidates.push(rootPath);
    const attachment = candidates.map(file => vaultFileUri(vaultPath, file)).find(fileExists);
    if (attachment) return attachment;
  }
  const rooted = !explicit && name.includes('/') && !name.split('/').some(part => part === '..' || part === '.') ? name.replace(/^\//, '') : undefined;
  const direct = (path: string) => {
    const candidates = /\.(md|markdown)$/i.test(path)
      ? [path] : [path + '.md', path + '.markdown'];
    return candidates.map(file => vaultFileUri(vaultPath, file)).find(fileExists);
  };
  const found = (rooted ? direct(rooted) : undefined) ?? direct(localPath);
  if (found) return found;

  const lookup = async () => {
    const { paths, suffixes } = await getLinkIndex(vaultPath);
    return (rooted ? paths.get(noteKey(rooted)) : undefined) ?? paths.get(noteKey(localPath))
      ?? (explicit ? undefined : suffixes.get(noteKey(name)));
  };
  const cached = linkIndex?.vault === vaultPath && linkIndex.expires > Date.now();
  let match = await lookup();
  if (cached && (!match || !fileExists(match))) {
    if (linkIndex?.vault === vaultPath) linkIndex = undefined;
    match = await lookup();
  }
  return match && fileExists(match) ? match : null;
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
