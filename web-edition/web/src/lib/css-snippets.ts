/**
 * Ported from desktop/src/lib/css-snippets.ts. `applySnippets`/`removeAllSnippets`/
 * `refreshSnippets` (DOM <style> injection) and the community-snippet fetchers
 * are pure/HTTP and unchanged. The CRUD functions are rewritten against webApi
 * instead of `window.electronAPI` on a `.noteriv/snippets/` directory + a
 * separate `.noteriv/snippet-config.json` for which ones are enabled — web
 * stores the whole snippet list (each with its own `enabled` flag, collapsing
 * what was two files into one) in the vault's `settings.cssSnippets` JSON.
 */

import { webApi } from "@/lib/webApi";

export interface CSSSnippet {
  id: string;
  name: string;
  filename: string;
  enabled: boolean;
  content: string;
}

async function readSnippets(vaultId: string): Promise<CSSSnippet[]> {
  const vault = await webApi.vaults.get(vaultId);
  return (vault.settings.cssSnippets as CSSSnippet[]) ?? [];
}

async function writeSnippets(vaultId: string, snippets: CSSSnippet[]): Promise<void> {
  const vault = await webApi.vaults.get(vaultId);
  await webApi.vaults.update(vaultId, { settings: { ...vault.settings, cssSnippets: snippets } });
}

export async function loadSnippets(vaultId: string): Promise<CSSSnippet[]> {
  const snippets = await readSnippets(vaultId);
  return [...snippets].sort((a, b) => a.name.localeCompare(b.name));
}

export async function toggleSnippet(vaultId: string, snippetId: string, enabled: boolean): Promise<void> {
  const snippets = await readSnippets(vaultId);
  await writeSnippets(
    vaultId,
    snippets.map((s) => (s.id === snippetId ? { ...s, enabled } : s))
  );
}

export async function createSnippet(vaultId: string, name: string, content: string = ""): Promise<CSSSnippet> {
  const id = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const snippet: CSSSnippet = { id, name, filename: `${id}.css`, enabled: false, content };
  const snippets = await readSnippets(vaultId);
  await writeSnippets(vaultId, [...snippets.filter((s) => s.id !== id), snippet]);
  return snippet;
}

export async function deleteSnippet(vaultId: string, snippetId: string): Promise<boolean> {
  const snippets = await readSnippets(vaultId);
  await writeSnippets(vaultId, snippets.filter((s) => s.id !== snippetId));
  return true;
}

export async function updateSnippetContent(vaultId: string, snippetId: string, content: string): Promise<boolean> {
  const snippets = await readSnippets(vaultId);
  await writeSnippets(
    vaultId,
    snippets.map((s) => (s.id === snippetId ? { ...s, content } : s))
  );
  return true;
}

export function applySnippets(snippets: CSSSnippet[]): void {
  // Remove existing injected snippets first
  removeAllSnippets();
  // Inject enabled snippets
  for (const snippet of snippets) {
    if (!snippet.enabled) continue;
    const style = document.createElement("style");
    style.setAttribute("data-snippet-id", snippet.id);
    style.textContent = snippet.content;
    document.head.appendChild(style);
  }
}

export function removeAllSnippets(): void {
  const existing = document.querySelectorAll("style[data-snippet-id]");
  existing.forEach((el) => el.remove());
}

export function refreshSnippets(snippets: CSSSnippet[]): void {
  removeAllSnippets();
  applySnippets(snippets);
}

// ── Community snippets ──

const COMMUNITY_SNIPPETS_BASE =
  "https://raw.githubusercontent.com/thejacedev/NoterivSnippets/master";

export interface CommunitySnippetEntry {
  id: string;
  name: string;
  description: string;
  file: string;
  category: string;
}

export interface CommunitySnippetManifest {
  name: string;
  description: string;
  version: string;
  snippets: CommunitySnippetEntry[];
}

export async function fetchSnippetManifest(): Promise<CommunitySnippetManifest | null> {
  try {
    const res = await fetch(`${COMMUNITY_SNIPPETS_BASE}/manifest.json`);
    if (!res.ok) return null;
    return (await res.json()) as CommunitySnippetManifest;
  } catch {
    return null;
  }
}

export async function fetchCommunitySnippetContent(file: string): Promise<string | null> {
  try {
    const res = await fetch(`${COMMUNITY_SNIPPETS_BASE}/${file}`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function installCommunitySnippet(
  vaultId: string,
  entry: CommunitySnippetEntry,
  content: string
): Promise<CSSSnippet> {
  const snippet: CSSSnippet = { id: entry.id, name: entry.name, filename: `${entry.id}.css`, enabled: false, content };
  const snippets = await readSnippets(vaultId);
  await writeSnippets(vaultId, [...snippets.filter((s) => s.id !== entry.id), snippet]);
  return snippet;
}
