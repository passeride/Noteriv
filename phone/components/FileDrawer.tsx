import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, FlatList, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Paths } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { readDecorations } from '@/lib/file-decoration';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';
import { readDir } from '@/lib/file-system';
import type { FileEntry } from '@/types';
import NotesList from '@/components/NotesList';
import VaultSwitcher from '@/components/VaultSwitcher';
import CreateModal from '@/components/CreateModal';
import type { EditorCommand } from '@/components/QuickLauncher';

const fileLocations = new Map<string, { folder: string; expanded: Set<string> }>();
const directoryUri = (path: string) => path.endsWith('/') ? path : path + '/';

interface FileDrawerProps {
  vaultPath: string;
  vaultName: string;
  notePath: string;
  editIconPath?: string;
  fileCommands: EditorCommand[];
  onVaultChange: () => void;
  onRefresh: () => void;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  startCreating?: boolean;
}

export default function FileDrawer({ vaultPath, vaultName, notePath, editIconPath, fileCommands, onVaultChange,
  onRefresh, onClose, onOpenNote, startCreating = false }: FileDrawerProps) {
  const { colors, metrics } = useTheme();
  const { width } = useWindowDimensions();
  const root = directoryUri(vaultPath);
  const [location, setLocation] = useState(() => {
    const stored = fileLocations.get(vaultPath);
    if (stored) return stored;
    const parent = directoryUri(Paths.dirname(notePath));
    const folder = parent.startsWith(root) ? parent : root;
    const expanded = new Set<string>();
    let next = root;
    for (const part of folder.slice(root.length).split('/').filter(Boolean)) {
      next += part + '/';
      expanded.add(next);
    }
    return { folder, expanded };
  });
  const { folder, expanded } = location;
  const [revision, setRevision] = useState(0);
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

  const tree = useMemo(() => {
    const entries: FileEntry[] = [];
    const indentation = new Map<string, number>();
    // Read only the directories that the user has expanded.
    const walk = (path: string, depth: number) => {
      for (const entry of readDir(path)) {
        entries.push(entry);
        indentation.set(entry.path, depth);
        if (entry.isDirectory && expanded.has(directoryUri(entry.path))) walk(entry.path, depth + 1);
      }
    };
    walk(root, 0);
    return { entries, indentation };
  }, [root, expanded, revision]);
  const chooseFolder = (entry: FileEntry) => {
    const path = directoryUri(entry.path);
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    const updated = { folder: path, expanded: next };
    setLocation(updated);
    fileLocations.set(vaultPath, updated);
  };
  const banner = useMemo(() => readDecorations(vaultPath)[vaultRelativePath(vaultPath, folder).replace(/\/$/, '')]?.banner,
    [vaultPath, folder, revision]);
  const refresh = () => { setRevision(value => value + 1); onRefresh(); };
  const close = () => {
    if (creating) setCreating(false);
    else if (mode !== 'files') setMode('files');
    else onClose();
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
              onPress={() => setMode(mode === 'vaults' ? 'files' : 'vaults')}
              style={[styles.vaultButton, { borderColor: colors.border, borderRadius: metrics.controlRadius, backgroundColor: colors.bgPrimary }]}>
              <Ionicons name="folder-outline" size={17} color={colors.textMuted} />
              <Text numberOfLines={1} style={{ flex: 1, color: colors.textPrimary, fontWeight: '600' }}>{vaultName}</Text>
              <Ionicons name="chevron-down" size={15} color={colors.textMuted} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={mode === 'actions' ? 'Show files' : 'File actions'}
              onPress={() => setMode(mode === 'actions' ? 'files' : 'actions')} style={styles.iconButton}>
              <Ionicons name={mode === 'actions' ? 'folder-outline' : 'ellipsis-horizontal'} size={20} color={colors.textPrimary} />
            </Pressable>
          </View>
          {mode === 'vaults' ? <VaultSwitcher visible embedded onClose={() => setMode('files')}
            onVaultChange={() => { onClose(); onVaultChange(); }} />
            : mode === 'actions' ? <FlatList data={fileCommands} keyExtractor={(item, index) => item.label + ':' + index}
              renderItem={({ item }) => <Pressable accessibilityRole="button" style={styles.action} onPress={() => {
                onClose();
                requestAnimationFrame(item.run);
              }}><Text style={{ color: colors.textPrimary }}>{item.label}</Text></Pressable>} />
            : <>
              {banner && <Image source={{ uri: vaultFileUri(vaultPath, banner) }} resizeMode="cover"
                style={{ width: '100%', height: 80 }} />}
              <NotesList files={tree.entries} indentation={tree.indentation} expanded={expanded}
                currentDir={folder} vaultPath={vaultPath} selectedPath={notePath} editIconPath={editIconPath}
                isAtRoot onNavigateUp={() => {}} onFolderPress={chooseFolder}
                onFilePress={entry => { onClose(); onOpenNote(entry.path); }} onRefresh={refresh} />
            </>}
        </Animated.View>
        {mode === 'files' && <Pressable accessibilityRole="button" accessibilityLabel="Create a note or folder in the selected folder"
          onPress={() => setCreating(true)} style={[styles.create, { borderRadius: metrics.panelRadius, backgroundColor: colors.accent }]}>
          <Ionicons name="add" size={21} color={colors.bgPrimary} />
          <Text style={{ color: colors.bgPrimary, fontWeight: '700' }}>New</Text>
        </Pressable>}
        {creating && <CreateModal visible inline currentDir={folder} onClose={() => setCreating(false)}
          onCreated={refresh} />}
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
  action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 16 },
  create: { position: 'absolute', right: 10, bottom: 32, minHeight: 48, paddingHorizontal: 11,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
});
