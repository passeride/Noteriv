import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Animated, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, Image, type ScrollViewInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Paths } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { readDecorations } from '@/lib/file-decoration';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';
import { directoryExists, readDir, readFile, writeFile } from '@/lib/file-system';
import { hasGitHistory } from '@/lib/git-history';
import { native, nativeDir } from '@/lib/provider-sync';
import type { FileDrawerOpening, FileDrawerSort, FileEntry } from '@/types';
import { orderFileEntries, parseFileOrder } from '../../packages/git-client/path-history';
import NotesList from '@/components/NotesList';
import VaultSwitcher from '@/components/VaultSwitcher';
import CreateModal from '@/components/CreateModal';
import SyncToast from '@/components/SyncToast';
import type { EditorCommand } from '@/components/QuickLauncher';

const fileLocations = new Map<string, { folder: string; expanded: Set<string> }>();
const directoryUri = (path: string) => path.endsWith('/') ? path : path + '/';

function existingFolder(root: string, path: string) {
  if (!path.startsWith(root)) return root;
  while (path !== root && !directoryExists(path)) {
    path = path.slice(0, path.lastIndexOf('/', path.length - 2) + 1);
  }
  return path;
}

interface FileDrawerProps {
  vaultPath: string;
  vaultName: string;
  notePath: string;
  editIconPath?: string;
  fileCommands: EditorCommand[];
  onVaultChange: () => void;
  onRefresh: () => void;
  onPullToRefresh: () => Promise<void>;
  navigateIntoFolders: boolean;
  opening: FileDrawerOpening;
  syncMessage?: string;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  startCreating?: boolean;
}

export default function FileDrawer({ vaultPath, vaultName, notePath, editIconPath, fileCommands, onVaultChange,
  onRefresh, onPullToRefresh, navigateIntoFolders, opening, syncMessage, onClose, onOpenNote,
  startCreating = false }: FileDrawerProps) {
  const { colors, metrics } = useTheme();
  const { workspace, updateWorkspace, files } = useApp();
  const { width } = useWindowDimensions();
  const root = directoryUri(vaultPath);
  const saved = workspace.fileDrawerPosition;
  const remembered = opening === 'remember' && saved?.breadcrumbs === navigateIntoFolders &&
    existingFolder(root, saved.folder) === saved.folder ? saved : undefined;
  const sortMode = workspace.fileDrawerSort ?? saved?.sort ?? 'name';
  const setSortMode = (sort: FileDrawerSort) => updateWorkspace({ fileDrawerSort: sort });
  const latestOffset = useRef(remembered?.offset ?? 0);
  const [listStart, setListStart] = useState({ offset: remembered?.offset ?? 0, focus: opening === 'current' });
  const [location, setLocation] = useState(() => {
    const stored = fileLocations.get(vaultPath);
    const folder = opening === 'current'
      ? existingFolder(root, directoryUri(Paths.dirname(notePath)))
      : remembered?.folder ?? root;
    const expanded = new Set(remembered?.expanded ?? stored?.expanded);
    let next = root;
    for (const part of folder.slice(root.length).split('/').filter(Boolean)) {
      next += part + '/';
      expanded.add(next);
    }
    return { folder, expanded };
  });
  const { folder, expanded } = location;
  useEffect(() => {
    fileLocations.set(vaultPath, location);
  }, [vaultPath, location]);
  const [revision, setRevision] = useState(0);
  const breadcrumbScroll = useRef<ScrollViewInstance>(null);
  const breadcrumbs = useMemo(() => {
    const items = [{ name: vaultName, path: root }];
    let path = root;
    for (const part of folder.slice(root.length).split('/').filter(Boolean)) {
      const name = vaultRelativePath(path, path + part);
      path += part + '/';
      items.push({ name, path });
    }
    return items;
  }, [folder, root, vaultName]);

  useEffect(() => {
    if (navigateIntoFolders) breadcrumbScroll.current?.scrollToEnd({ animated: false });
  }, [folder, navigateIntoFolders]);
  const [mode, setMode] = useState<'files' | 'vaults' | 'actions'>('files');
  const [creating, setCreating] = useState(startCreating);
  const drawerWidth = Math.min(metrics.drawerWidth, width * 0.75);
  const offset = useRef(new Animated.Value(-drawerWidth)).current;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (!active) return;
      if (reduced) offset.setValue(0);
      else Animated.timing(offset, { toValue: 0, duration: 170, useNativeDriver: true }).start();
    }).catch(() => { if (active) offset.setValue(0); });
    return () => { active = false; offset.stopAnimation(); };
  }, [drawerWidth, offset]);

  const folders = useMemo(() => {
    const result = new Map<string, FileEntry[]>();
    const collect = (dir: string) => {
      const entries = readDir(dir, sortMode === 'last-change');
      result.set(dir, entries);
      if (!navigateIntoFolders) {
        for (const entry of entries) {
          const path = directoryUri(entry.path);
          if (entry.isDirectory && expanded.has(path)) collect(path);
        }
      }
    };
    collect(navigateIntoFolders ? folder : root);
    return result;
  // Files and revision invalidate metadata after sync or drawer changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateIntoFolders, folder, root, expanded, sortMode, revision, files]);
  const [manual, setManual] = useState<{ folders: typeof folders; orders: Map<string, string[]> }>();
  const [changes, setChanges] = useState<{ folders: typeof folders; dates: Record<string, number> }>();
  useEffect(() => {
    let cancelled = false;
    if (sortMode === 'manual') {
      void Promise.all([...folders.keys()].map(async dir =>
        [dir, parseFileOrder(await readFile(dir + '.order')) ?? []] as const))
        .then(pairs => { if (!cancelled) setManual({ folders, orders: new Map(pairs) }); });
    } else if (sortMode === 'last-change' && hasGitHistory(vaultPath)) {
      const paths = [...folders.values()].flat().map(entry =>
        vaultRelativePath(vaultPath, entry.path).replace(/\/$/, ''));
      void native<Record<string, number>>({ action: 'lastChanges', dir: nativeDir(vaultPath), paths })
        .then(dates => { if (!cancelled) setChanges({ folders, dates }); })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [folders, sortMode, vaultPath]);
  const tree = useMemo(() => {
    const sortedFolder = (dir: string) => {
      const entries = folders.get(dir) ?? [];
      if (sortMode === 'manual') return orderFileEntries(entries, manual?.folders === folders ? manual.orders.get(dir) ?? [] : []);
      if (sortMode === 'name') return entries;
      const dates = changes?.folders === folders ? changes.dates : undefined;
      const date = (entry: FileEntry) => {
        const path = vaultRelativePath(vaultPath, entry.path).replace(/\/$/, '');
        return (dates && Object.hasOwn(dates, path) ? dates[path] : undefined) ?? entry.mtime ?? 0;
      };
      return [...entries].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) ||
        (sortMode === 'last-change' ? date(b) - date(a) || a.name.localeCompare(b.name) : b.name.localeCompare(a.name)));
    };
    if (navigateIntoFolders) return { entries: sortedFolder(folder) };
    const entries: FileEntry[] = [];
    const indentation = new Map<string, number>();
    const walk = (path: string, depth: number) => {
      for (const entry of sortedFolder(path)) {
        entries.push(entry);
        indentation.set(entry.path, depth);
        if (entry.isDirectory && expanded.has(directoryUri(entry.path))) walk(entry.path, depth + 1);
      }
    };
    walk(root, 0);
    return { entries, indentation };
  }, [changes, expanded, folder, folders, manual, navigateIntoFolders, root, sortMode, vaultPath]);
  const reorder = async (entry: FileEntry, delta: number) => {
    const dir = directoryUri(Paths.dirname(entry.path.replace(/\/$/, '')));
    const orderFile = dir + '.order';
    const order = parseFileOrder(await readFile(orderFile)) ?? [];
    const names = orderFileEntries(readDir(dir), order).map(item => item.name);
    const from = names.indexOf(entry.name);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= names.length) return;
    names.splice(from, 1);
    names.splice(to, 0, entry.name);
    if (writeFile(orderFile, names.join('\n') + '\n')) setRevision(value => value + 1);
    else Alert.alert('Manual order', 'Could not save .order.');
  };
  const goToFolder = (path: string, folders = expanded) => {
    if (navigateIntoFolders && path !== folder) {
      latestOffset.current = 0;
      setListStart({ offset: 0, focus: false });
    }
    setLocation({ folder: path, expanded: folders });
  };
  const chooseFolder = (entry: FileEntry) => {
    const path = directoryUri(entry.path);
    if (navigateIntoFolders) {
      goToFolder(path);
      return;
    }
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    goToFolder(path, next);
  };
  const banner = useMemo(() => readDecorations(vaultPath)[vaultRelativePath(vaultPath, folder).replace(/\/$/, '')]?.banner,
    [vaultPath, folder, revision]);
  const refresh = () => {
    setLocation(current => {
      const path = existingFolder(root, current.folder);
      return path === current.folder ? current : { ...current, folder: path };
    });
    setRevision(value => value + 1);
    onRefresh();
  };
  const pullToRefresh = async () => {
    try {
      await onPullToRefresh();
    } finally {
      refresh();
    }
  };
  const rememberPosition = () => {
    updateWorkspace({ fileDrawerPosition: {
      folder, expanded: [...expanded], offset: latestOffset.current, sort: sortMode, breadcrumbs: navigateIntoFolders,
    } });
  };
  const dismiss = () => {
    rememberPosition();
    onClose();
  };
  const showMode = (next: typeof mode) => {
    setListStart({ offset: latestOffset.current, focus: false });
    setMode(next);
  };
  const close = () => {
    if (creating) setCreating(false);
    else if (mode !== 'files') showMode('files');
    else dismiss();
  };

  return (
    <Modal transparent animationType="none" onRequestClose={close}>
      <SafeAreaView style={styles.stage}>
        <Pressable accessibilityLabel="Close file drawer" style={StyleSheet.absoluteFill} onPress={close} />
        <Animated.View accessibilityViewIsModal style={[styles.drawer, {
          width: drawerWidth, backgroundColor: colors.bgSecondary, borderColor: colors.border,
          borderTopRightRadius: metrics.panelRadius, borderBottomRightRadius: metrics.panelRadius, transform: [{ translateX: offset }],
        }]}>
          <View style={[styles.header, { minHeight: metrics.toolbarHeight }]}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Files</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={mode === 'files' ? 'Close files' : 'Back to files'}
              style={styles.iconButton} onPress={close}>
              <Ionicons name={mode === 'files' ? 'close' : 'chevron-back'} size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={styles.controls}>
            <Pressable accessibilityRole="button" accessibilityLabel="Switch vault" accessibilityState={{ expanded: mode === 'vaults' }}
              onPress={() => showMode(mode === 'vaults' ? 'files' : 'vaults')}
              style={[styles.vaultButton, { borderColor: colors.border, borderRadius: metrics.controlRadius, backgroundColor: colors.bgPrimary }]}>
              <Ionicons name="folder-outline" size={17} color={colors.textMuted} />
              <Text numberOfLines={1} style={{ flex: 1, color: colors.textPrimary, fontWeight: '600' }}>{vaultName}</Text>
              <Ionicons name="chevron-down" size={15} color={colors.textMuted} />
            </Pressable>
            {fileCommands.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel={mode === 'actions' ? 'Show files' : 'File actions'}
              onPress={() => showMode(mode === 'actions' ? 'files' : 'actions')} style={styles.iconButton}>
              <Ionicons name={mode === 'actions' ? 'folder-outline' : 'ellipsis-horizontal'} size={20} color={colors.textPrimary} />
            </Pressable>}
          </View>
          {mode === 'vaults' ? <VaultSwitcher visible embedded onClose={() => showMode('files')}
            onVaultChange={() => { onClose(); onVaultChange(); }} />
            : mode === 'actions' ? <FlatList data={fileCommands} keyExtractor={(item, index) => item.label + ':' + index}
              renderItem={({ item }) => <Pressable accessibilityRole="button" style={styles.action} onPress={() => {
                dismiss();
                requestAnimationFrame(item.run);
              }}><Text style={{ color: colors.textPrimary }}>{item.label}</Text></Pressable>} />
            : <>
              {navigateIntoFolders && <ScrollView ref={breadcrumbScroll} horizontal showsHorizontalScrollIndicator={false}
                accessibilityLabel="Folder path" style={{ flexGrow: 0 }} contentContainerStyle={styles.breadcrumbs}
                onContentSizeChange={() => breadcrumbScroll.current?.scrollToEnd({ animated: false })}>
                {breadcrumbs.map(({ name, path }, index) => (
                  <View key={path} style={styles.breadcrumb}>
                    {index > 0 && <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />}
                    {path === folder ? <Text accessibilityRole="header" numberOfLines={1}
                      style={[styles.crumbLabel, { color: colors.textPrimary, fontWeight: '700' }]}>{name}</Text>
                      : <Pressable accessibilityRole="button" onPress={() => goToFolder(path)}>
                        <Text numberOfLines={1} style={[styles.crumbLabel, { color: colors.accent }]}>{name}</Text>
                      </Pressable>}
                  </View>
                ))}
              </ScrollView>}
              {banner && <Image source={{ uri: vaultFileUri(vaultPath, banner) }} resizeMode="cover"
                style={{ width: '100%', height: 80 }} />}
              <NotesList key={navigateIntoFolders ? folder : root} files={tree.entries} indentation={tree.indentation} expanded={navigateIntoFolders ? undefined : expanded}
                currentDir={folder} vaultPath={vaultPath} selectedPath={notePath} editIconPath={editIconPath}
                initialOffset={listStart.offset} focusSelected={listStart.focus} onScrollOffset={value => { latestOffset.current = value; }}
                sortMode={sortMode} onSortModeChange={setSortMode} onReorder={reorder}
                isAtRoot onNavigateUp={() => {}} onFolderPress={chooseFolder}
                onFilePress={entry => { dismiss(); onOpenNote(entry.path); }} onRefresh={refresh} onPullToRefresh={pullToRefresh} />
            </>}
        </Animated.View>
        {mode === 'files' && <Pressable accessibilityRole="button" accessibilityLabel="Create a note or folder in the selected folder"
          onPress={() => setCreating(true)} style={[styles.create, { borderRadius: metrics.panelRadius, backgroundColor: colors.accent }]}>
          <Ionicons name="add" size={21} color={colors.bgPrimary} />
          <Text style={{ color: colors.bgPrimary, fontWeight: '700' }}>New</Text>
        </Pressable>}
        {creating && <CreateModal visible inline currentDir={folder} onClose={() => setCreating(false)}
          onCreated={refresh} />}
        <SyncToast message={syncMessage} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: 'rgba(17,24,20,0.38)', alignItems: 'flex-start' },
  drawer: { flex: 1, alignSelf: 'flex-start', borderRightWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  title: { fontSize: 20, fontWeight: '700' },
  header: { paddingLeft: 16, paddingRight: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 4, paddingBottom: 5 },
  vaultButton: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 48, gap: 8, paddingHorizontal: 10, borderWidth: StyleSheet.hairlineWidth },
  breadcrumbs: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  breadcrumb: { flexDirection: 'row', alignItems: 'center' },
  crumbLabel: { paddingHorizontal: 6, paddingVertical: 10, maxWidth: 180 },
  action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 },
  create: { position: 'absolute', right: 10, bottom: 32, minHeight: 48, paddingHorizontal: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
});
