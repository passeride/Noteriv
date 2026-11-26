import { DEFAULT_WORKSPACE_THEME } from "../../packages/appearance/workspace";
import { AppSettings } from '@/types';
import { getItem, setItem, KEYS } from './storage';

export const DEFAULT_SETTINGS: AppSettings = {
  autoSaveInterval: 30,
  spellCheck: true,
  accentColor: '#89b4fa',
  fontSize: 16,
  wordWrap: true,
  livePreviewReplacement: 'off',
  fileDrawerBreadcrumbs: false,
  lineHeight: 1.6,
  editorFont: 'monospace',
  tabSize: 4,
  gitSyncInterval: 0,
  syncOnSave: false,
  pullOnOpen: false,
  commitMessageFormat: 'Sync {date} {time}',
  theme: DEFAULT_WORKSPACE_THEME,
  autoUpdate: true,
};

export async function loadSettings(): Promise<AppSettings> {
  const saved = await getItem<Partial<AppSettings>>(KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setItem(KEYS.SETTINGS, settings);
}
