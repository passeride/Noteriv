export interface Vault {
  id: string;
  name: string;
  path: string;
  gitRemote: string | null;
  // Needed for arbitrary self-hosted hosts where the URL alone cannot identify the forge.
  gitProvider?: GitProvider;
  gitBranch: string;
  homeFolder?: string;
  homeFile?: string;
  autoSync: boolean;
  lastOpened: number;
}

export type GitProvider = 'github' | 'gitlab' | 'gitea';

export interface AppSettings {
  autoSaveInterval: number;
  spellCheck: boolean;
  hideReadingMetadata?: boolean;
  accentColor: string;
  fontSize: number;
  wordWrap: boolean;
  lineHeight: number;
  editorFont: string;
  tabSize: number;
  gitSyncInterval: number;
  syncOnSave: boolean;
  pullOnOpen: boolean;
  commitMessageFormat: string;
  theme: string;
  autoUpdate: boolean;
}

export interface WorkspaceState {
  openTabs: string[];
  activeTab: string | null;
  expandedFolders: string[];
  viewMode: 'edit' | 'preview';
  fileOrder?: Record<string, string[]>;
  bookmarks?: string[];
  fileIcons?: Record<string, { symbol: string; color: string }>;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface HotkeyBinding {
  action: string;
  keys: string;
}
