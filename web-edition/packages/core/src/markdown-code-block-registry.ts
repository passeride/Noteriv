// ─── Markdown code-block processor registry ───
// Lets plugins register a custom renderer for a fenced code-block language
// (e.g. ```chessboard), without the core markdown renderer knowing about
// any specific plugin. Kept as a standalone module (rather than inside
// plugin-api.ts) so both `lib/plugin-api.ts` and
// `components/markdown/renderers/code-blocks.ts` can import it without
// creating a circular dependency between `lib/` and `components/markdown/`.

export interface CodeBlockProcessorContext {
  /** Same as the `source` parameter; kept for symmetry with Obsidian's API. */
  source: string;
  /** The fence language exactly as registered (lowercased). */
  language: string;
  /** Vault-relative path of the note being rendered, if known. Best-effort, may be null. */
  sourcePath: string | null;
}

export type CodeBlockProcessor = (
  source: string,
  el: HTMLElement,
  ctx: CodeBlockProcessorContext
) => void | (() => void);

interface RegistryEntry {
  pluginId: string;
  processor: CodeBlockProcessor;
}

// Languages the core app renders natively — plugins cannot override these. Empty since 2.5: Mermaid and Dataview,
// the two that were here, are core plugins now and register like any other.
const RESERVED_LANGUAGES = new Set<string>();

/**
 * A processor that draws asynchronously (a diagram library to load, a vault to scan) marks the element it is still
 * filling with this attribute and removes it when done. Export waits for it to go (`preRenderCodeBlocks`).
 */
export const PENDING_ATTRIBUTE = "data-nrv-pending";

const registry = new Map<string, RegistryEntry>();

// Registration can happen after notes are already on screen (plugins boot in
// iframes asynchronously), so open editors need a nudge to re-render fences that
// just gained a processor. Widgets compare `getRegistryVersion()` in eq(), and
// views subscribe here to re-run their decorations.
let registryVersion = 0;
const listeners = new Set<() => void>();

export function getRegistryVersion(): number {
  return registryVersion;
}

export function subscribeCodeBlockRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function bump() {
  registryVersion++;
  listeners.forEach((l) => l());
}

export function registerCodeBlockProcessor(
  pluginId: string,
  language: string,
  processor: CodeBlockProcessor
): void {
  const key = language.trim().toLowerCase();
  if (!key) return;
  if (RESERVED_LANGUAGES.has(key)) {
    console.warn(`[plugin:${pluginId}] cannot register processor for reserved language "${key}"`);
    return;
  }
  const existing = registry.get(key);
  if (existing && existing.pluginId !== pluginId) {
    console.warn(
      `[plugin:${pluginId}] overriding code block processor for "${key}" previously registered by "${existing.pluginId}"`
    );
  }
  registry.set(key, { pluginId, processor });
  bump();
}

export function unregisterCodeBlockProcessor(pluginId: string, language: string): void {
  const key = language.trim().toLowerCase();
  const existing = registry.get(key);
  if (existing && existing.pluginId === pluginId) {
    registry.delete(key);
    bump();
  }
}

/** Called from PluginManager.unloadPlugin — removes every processor owned by this plugin. */
export function unregisterAllCodeBlockProcessorsForPlugin(pluginId: string): void {
  let removed = false;
  for (const [key, entry] of registry) {
    if (entry.pluginId === pluginId) {
      registry.delete(key);
      removed = true;
    }
  }
  if (removed) bump();
}

export function getCodeBlockProcessor(language: string): RegistryEntry | undefined {
  const key = language.trim().toLowerCase();
  return registry.get(key);
}
