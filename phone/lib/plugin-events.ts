export type PluginSelection = { start: number; end: number };

type Payloads = {
  config: string;
  saved: string;
  created: string;
  deleted: string;
  selection: { path: string; range: PluginSelection };
  event: { vault: string; sender?: string; name: string; args: unknown[] };
};

const listeners: { [K in keyof Payloads]: Set<(value: Payloads[K]) => void> } = {
  config: new Set(),
  saved: new Set(),
  created: new Set(),
  deleted: new Set(),
  selection: new Set(),
  event: new Set(),
};

export const pluginEvents = {
  emit<K extends keyof Payloads>(type: K, value: Payloads[K]) {
    for (const listener of listeners[type]) listener(value);
  },
  addListener<K extends keyof Payloads>(type: K, listener: (value: Payloads[K]) => void) {
    listeners[type].add(listener);
    return { remove: () => { listeners[type].delete(listener); } };
  },
};

let currentSelection: { path: string; range: PluginSelection } | undefined;

export function setPluginSelection(path: string, range: PluginSelection) {
  currentSelection = { path, range };
}

export function getPluginSelection(path: string | null, length: number): PluginSelection {
  if (!currentSelection || currentSelection.path !== path) return { start: 0, end: 0 };
  const { start, end } = currentSelection.range;
  return { start: Math.min(start, length), end: Math.min(end, length) };
}

const unloaders = new Map<string, Set<() => Promise<void>>>();

export function registerPluginUnloader(vault: string, unload: () => Promise<void>): () => void {
  const entries = unloaders.get(vault) ?? new Set();
  unloaders.set(vault, entries);
  entries.add(unload);
  return () => {
    entries.delete(unload);
    if (entries.size === 0) unloaders.delete(vault);
  };
}

export async function stopVaultPlugins(vault: string): Promise<void> {
  await Promise.allSettled([...unloaders.get(vault) ?? []].map(unload => unload()));
}
