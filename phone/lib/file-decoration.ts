import { File } from 'expo-file-system';
import { writeFile } from './file-system';
import { vaultFileUri } from './sync-state';

export type Decoration = { symbol?: string; color?: string; banner?: string };
export type Decorations = Record<string, Decoration>;
const CONFIG = '.noteriv-decorations.json';

export function readDecorations(vault: string): Decorations {
  const file = new File(vaultFileUri(vault, CONFIG));
  try {
    const entries: unknown = file.exists ? JSON.parse(file.textSync()) : {};
    return entries && typeof entries === 'object' && !Array.isArray(entries) ? entries as Decorations : {};
  } catch {
    return {};
  }
}

export function saveDecoration(vault: string, key: string, change: Decoration): boolean {
  const entries = readDecorations(vault);
  entries[key] = { ...entries[key], ...change };
  return writeFile(vaultFileUri(vault, CONFIG), JSON.stringify(entries, null, 2) + '\n');
}

export function migrateDecorations(vault: string, legacy: Decorations): boolean {
  const entries = readDecorations(vault);
  let changed = false;
  for (const [path, icon] of Object.entries(legacy)) {
    const key = path.replace(/\/$/, '');
    if (entries[key]?.symbol !== undefined) continue;
    entries[key] = { ...entries[key], ...icon };
    changed = true;
  }
  return !changed || writeFile(vaultFileUri(vault, CONFIG), JSON.stringify(entries, null, 2) + '\n');
}
