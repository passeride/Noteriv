import {
  COMMUNITY_SOURCE, PLUGIN_SOURCES_PATH, fetchPluginCatalog, installCatalogPlugin, isCatalogUpdate,
  parsePluginSource, parseStoredPluginSources, sourceKey,
  type CatalogPlugin, type PluginSource,
} from '../../packages/plugin-catalog/catalog';
import { Directory, File } from 'expo-file-system';
import { vaultFileUri } from '@/lib/sync-state';
import { pluginEvents } from './plugin-events';
import { readDir, readFile, writeFile, createDir, deleteDir, fileExists, movePath } from '@/lib/file-system';

// --- Types ---

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  main: string;
  /** Fenced code-block languages this plugin renders (e.g. ["chessboard"]). */
  codeBlockLanguages?: string[];
  mobileHost?: boolean;
  catalogSource?: PluginSource;
}

export interface PluginInstance {
  manifest: PluginManifest;
  enabled: boolean;
  loaded: boolean;
  error?: string;
}

export interface PluginConfig {
  enabled: string[];
}

// --- Constants ---

const PLUGINS_DIR = '.noteriv/plugins';
const PLUGIN_CONFIG_FILE = '.noteriv/plugin-config.json';

// --- Helpers ---

function pluginsPath(vaultPath: string): string {
  return `${vaultPath}/${PLUGINS_DIR}`;
}

function configPath(vaultPath: string): string {
  return `${vaultPath}/${PLUGIN_CONFIG_FILE}`;
}

async function loadConfig(vaultPath: string): Promise<PluginConfig> {
  const raw = await readFile(configPath(vaultPath));
  if (!raw) return { enabled: [] };
  try {
    return JSON.parse(raw) as PluginConfig;
  } catch {
    return { enabled: [] };
  }
}

function saveConfig(vaultPath: string, config: PluginConfig): void {
  createDir(`${vaultPath}/.noteriv`);
  if (writeFile(configPath(vaultPath), JSON.stringify(config, null, 2))) pluginEvents.emit('config', vaultPath);
}

// --- Public API ---

export function pluginMainPath(vaultPath: string, plugin: PluginManifest): string | null {
  if (!plugin.id || !/^[a-z0-9_.-]+$/i.test(plugin.id) || plugin.id.startsWith('.')) return null;
  const main = plugin.main || 'main.js';
  if (typeof main !== 'string' || main.split('/').some(part => !part || part.startsWith('.') || /[\\:\0]/.test(part))) return null;
  return vaultFileUri(vaultPath, `${PLUGINS_DIR}/${plugin.id}/${main}`);
}

export async function getInstalledPlugins(vaultPath: string): Promise<PluginManifest[]> {
  const dir = pluginsPath(vaultPath);
  createDir(dir);

  const entries = readDir(dir);
  const plugins: PluginManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) continue;

    const manifestPath = `${entry.path}/manifest.json`;
    if (!fileExists(manifestPath)) continue;

    const raw = await readFile(manifestPath);
    if (!raw) continue;

    try {
      const manifest = JSON.parse(raw) as PluginManifest;
      if (manifest && typeof manifest.name === 'string') plugins.push({ ...manifest, id: entry.name });
    } catch {
      // Skip malformed manifests
    }
  }

  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getEnabledPluginIds(vaultPath: string): Promise<string[]> {
  const config = await loadConfig(vaultPath);
  return config.enabled;
}

export async function setPluginEnabled(
  vaultPath: string,
  id: string,
  enabled: boolean
): Promise<void> {
  const config = await loadConfig(vaultPath);
  if (enabled && !config.enabled.includes(id)) {
    config.enabled.push(id);
  } else if (!enabled) {
    config.enabled = config.enabled.filter((pid) => pid !== id);
  }
  saveConfig(vaultPath, config);
}

export function uninstallPlugin(vaultPath: string, id: string): void {
  const dir = `${pluginsPath(vaultPath)}/${id}`;
  deleteDir(dir);
  pluginEvents.emit('config', vaultPath);

  // Also remove from config
  const cfgPath = configPath(vaultPath);
  if (fileExists(cfgPath)) {
    readFile(cfgPath).then((raw) => {
      if (!raw) return;
      try {
        const config: PluginConfig = JSON.parse(raw);
        config.enabled = config.enabled.filter((pid) => pid !== id);
        saveConfig(vaultPath, config);
      } catch {}
    });
  }
}

/** Import the same manifest-and-JavaScript folder used by the desktop app. */
export async function installLocalPlugin(vaultPath: string): Promise<PluginManifest> {
  const folder = await Directory.pickDirectoryAsync();
  const files = folder.list().filter((entry): entry is File => entry instanceof File);
  const file = files.find(entry => entry.name === 'manifest.json');
  if (!file) throw new Error('The selected folder has no manifest.json.');
  const manifest = JSON.parse(await file.text()) as PluginManifest;
  const main = pluginMainPath(vaultPath, manifest);
  const entry = files.find(item => item.name === (manifest.main || 'main.js'));
  if (!main || !entry || typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new Error('The manifest must name a plugin ID, a plugin name and a JavaScript entry in the selected folder.');
  }
  const code = await entry.text();
  if (code.length > 500_000) throw new Error('The plugin script exceeds the size limit.');
  const target = vaultFileUri(vaultPath, `${PLUGINS_DIR}/${manifest.id}`);
  if (!createDir(target)) throw new Error('Unable to create the plugin folder.');
  for (const item of files) {
    if (item === file || item === entry || item.name.startsWith('.')) continue;
    if (!writeFile(vaultFileUri(vaultPath, `${PLUGINS_DIR}/${manifest.id}/${item.name}`), await item.text())) {
      throw new Error(`Unable to import ${item.name}.`);
    }
  }
  if (!writeFile(main, code) ||
      !writeFile(vaultFileUri(vaultPath, `${PLUGINS_DIR}/${manifest.id}/manifest.json`), JSON.stringify(manifest, null, 2))) {
    throw new Error('Unable to save the plugin.');
  }
  pluginEvents.emit('config', vaultPath);
  return manifest;
}

// --- GitHub plugin sources ---

export { COMMUNITY_SOURCE, fetchPluginCatalog, isCatalogUpdate, parsePluginSource, sourceKey };
export type { CatalogPlugin, PluginSource };

export async function loadPluginSources(vaultPath: string): Promise<PluginSource[]> {
  return parseStoredPluginSources(await readFile(vaultFileUri(vaultPath, PLUGIN_SOURCES_PATH)));
}

export function savePluginSources(vaultPath: string, sources: PluginSource[]): void {
  if (!writeFile(vaultFileUri(vaultPath, PLUGIN_SOURCES_PATH), JSON.stringify(sources, null, 2) + '\n')) {
    throw new Error('Unable to save plugin sources in the vault.');
  }
}

const pendingInstalls = new Set<string>();

export async function installCommunityPlugin(vaultPath: string, entry: CatalogPlugin, update = false): Promise<void> {
  const plugins = vaultFileUri(vaultPath, PLUGINS_DIR);
  const target = vaultFileUri(vaultPath, `${PLUGINS_DIR}/${entry.id}`);
  const stage = vaultFileUri(vaultPath, `.noteriv/.plugin-install-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const backup = stage + '-previous';
  const manifestPath = target + '/manifest.json';
  const hasPlugin = () => readDir(plugins).some(file => file.name.toLowerCase() === entry.id.toLowerCase());
  if (pendingInstalls.has(target)) throw new Error('This plugin is already being installed or updated.');
  pendingInstalls.add(target);
  try {
    const previous = update ? await readFile(manifestPath) : null;
    if (update && (!previous || !isCatalogUpdate(JSON.parse(previous), entry))) {
      throw new Error('No newer version is available from this source.');
    }
    await installCatalogPlugin(entry, {
      hasPlugin,
      createStage: () => createDir(plugins) && createDir(stage),
      write: (name, content) => writeFile(`${stage}/${name}`, content),
      async publish() {
        if (!update) return !hasPlugin() && movePath(stage, target);
        if (await readFile(manifestPath) !== previous || !movePath(target, backup)) return false;
        if (movePath(stage, target)) {
          deleteDir(backup);
          return true;
        }
        if (!movePath(backup, target)) throw new Error('Unable to restore the previous plugin. Backup: ' + backup);
        return false;
      },
      discardStage: () => deleteDir(stage),
    }, update);
    pluginEvents.emit('config', vaultPath);
  } finally {
    pendingInstalls.delete(target);
  }
}
