import React, { useCallback, useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Paths } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { migrateDecorations, readDecorations, saveDecoration } from '@/lib/file-decoration';
import { vaultRelativePath } from '@/lib/sync-state';
import { FileEntry } from '@/types';
import { readProperties } from '@/lib/properties';
import { readFile, rename, deleteFile, deleteDir, trashFile } from '@/lib/file-system';

const ICONS = ['📁', '📝', '⭐', '📚', '🏠', '💡', '📅', '✅', '🎯', '🛠️', '🔬', '🎵', '💻', '🌱', '💼', '📌'];
const ICON_COLORS = ['#6278B5', '#953F70', '#AA632D', '#378257', '#566575'];

function NoteIcon({ path, symbol, color }: { path: string; symbol?: string; color?: string }) {
  const { colors } = useTheme();
  const [metadata, setMetadata] = useState<{ path: string; symbol: string }>();
  useEffect(() => {
    if (!/\.(md|markdown)$/i.test(path)) return;
    let active = true;
    void readFile(path).then(content => {
      if (!active || !content) return;
      const icon = readProperties(content).find(property => property.key === 'icon')?.value;
      setMetadata(typeof icon === 'string' && icon.trim() ? { path, symbol: icon.trim() } : undefined);
    });
    return () => { active = false; };
  }, [path]);
  const resolved = symbol ?? (metadata?.path === path ? metadata.symbol : undefined);
  return <View style={[styles.fileIcon, { backgroundColor: resolved ? (color ?? ICON_COLORS[0]) + '38' : colors.bgTertiary }]}>
    {resolved ? <Text numberOfLines={1} style={{ color: colors.textPrimary, fontSize: 19 }}>{resolved}</Text>
      : <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />}
  </View>;
}

interface NotesListProps {
  files: FileEntry[];
  indentation?: Map<string, number>;
  expanded?: Set<string>;
  selectedPath?: string;
  editIconPath?: string;
  currentDir: string;
  vaultPath: string;
  onFilePress: (file: FileEntry) => void;
  onFolderPress: (folder: FileEntry) => void;
  onNavigateUp: () => void;
  onGoHome?: () => void;
  onRefresh: () => void;
  isAtRoot: boolean;
}

export default function NotesList({
  files,
  indentation,
  expanded,
  selectedPath,
  editIconPath,
  currentDir,
  vaultPath,
  onFilePress,
  onFolderPress,
  onNavigateUp,
  onGoHome,
  onRefresh,
  isAtRoot,
}: NotesListProps) {
  const { colors, metrics } = useTheme();
  const { workspace, updateWorkspace } = useApp();
  const [syncedIcons, setSyncedIcons] = useState(() => readDecorations(vaultPath));
  const fileIcons = useMemo(() => ({ ...workspace.fileIcons, ...syncedIcons }), [workspace.fileIcons, syncedIcons]);
  useEffect(() => {
    if (workspace.fileIcons && Object.keys(workspace.fileIcons).length &&
      migrateDecorations(vaultPath, workspace.fileIcons)) {
      updateWorkspace({ fileIcons: {} });
    }
    setSyncedIcons(readDecorations(vaultPath));
  }, [vaultPath, workspace.fileIcons, updateWorkspace, files]);
  const [iconTarget, setIconTarget] = useState<FileEntry | null>(null);
  const [symbol, setSymbol] = useState('');
  const [iconColor, setIconColor] = useState(ICON_COLORS[0]);
  const saveIcon = (value: string) => {
    if (!iconTarget) return;
    const key = vaultRelativePath(vaultPath, iconTarget.path).replace(/\/$/, '');
    if (!saveDecoration(vaultPath, key, { symbol: value, color: iconColor })) {
      Alert.alert('Could not save icon');
      return;
    }
    setSyncedIcons(readDecorations(vaultPath));
    const legacy = { ...workspace.fileIcons };
    delete legacy[key];
    updateWorkspace({ fileIcons: legacy });
    setIconTarget(null);
  };
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [sortMode, setSortMode] = useState<'name' | 'name-desc'>('name');

  const sortedFiles = useMemo(() => {
    if (indentation) return files;
    const sorted = [...files];
    if (sortMode === 'name-desc') {
      sorted.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return b.name.localeCompare(a.name);
      });
    }
    return sorted;
  }, [files, sortMode, indentation]);

  const folderName = useMemo(() => {
    if (isAtRoot) return null;
    return Paths.basename(currentDir);
  }, [currentDir, isAtRoot]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    onRefresh();
    setTimeout(() => setRefreshing(false), 300);
  }, [onRefresh]);

  useEffect(() => {
    if (!editIconPath) return;
    const icon = readDecorations(vaultPath)[vaultRelativePath(vaultPath, editIconPath)];
    setSymbol(icon?.symbol ?? '');
    setIconColor(icon?.color ?? ICON_COLORS[0]);
    setIconTarget({ path: editIconPath, name: Paths.basename(editIconPath), isDirectory: false });
  }, [editIconPath, vaultPath]);

  const handleLongPress = useCallback((entry: FileEntry) => {
    Alert.alert(
      entry.name,
      undefined,
      [
        {
          text: 'Rename',
          onPress: () => {
            setRenameTarget(entry);
            setRenameValue(entry.name);
          },
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              `Move to Trash?`,
              `"${entry.name}" will be moved to .trash and can be restored.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Move to Trash',
                  style: 'destructive',
                  onPress: () => {
                    if (entry.isDirectory) {
                      deleteDir(entry.path);
                    } else {
                      trashFile(entry.path, vaultPath);
                    }
                    onRefresh();
                  },
                },
              ]
            );
          },
        },
        { text: 'Change icon', onPress: () => {
          const icon = fileIcons?.[vaultRelativePath(vaultPath, entry.path).replace(/\/$/, '')];
          setSymbol(icon?.symbol ?? '');
          setIconColor(icon?.color ?? ICON_COLORS[0]);
          setIconTarget(entry);
        } },
      ],
      { cancelable: true }
    );
  }, [fileIcons, onRefresh, vaultPath]);

  const handleRename = useCallback(() => {
    if (!renameTarget || !renameValue.trim()) return;
    rename(renameTarget.path, renameValue.trim());
    setRenameTarget(null);
    onRefresh();
  }, [renameTarget, renameValue, onRefresh]);

  const renderItem = useCallback(
    ({ item }: { item: FileEntry }) => {
      const depth = indentation?.get(item.path) ?? 0;
      const treeStyle = indentation && { paddingLeft: 10 + Math.min(depth, 6) * 12, borderRadius: metrics.rowRadius, minHeight: 48, paddingVertical: 4 };
      const icon = fileIcons?.[vaultRelativePath(vaultPath, item.path).replace(/\/$/, '')];
      if (item.isDirectory) {
        return (
          <TouchableOpacity
            style={[styles.item, treeStyle]}
            onPress={() => onFolderPress(item)}
            accessibilityState={{ expanded: expanded?.has(item.path.endsWith('/') ? item.path : item.path + '/') }}
            onLongPress={() => handleLongPress(item)}
            activeOpacity={0.6}
          >
            <View style={[styles.folderIcon, { backgroundColor: colors.blue + '15' }]}>
              <Ionicons name={icon?.symbol ? 'folder-outline' : 'folder'} size={icon?.symbol ? 30 : 20} color={colors.blue} />
              {!!icon?.symbol && <Text numberOfLines={1} style={{ position: 'absolute', top: 12, fontSize: 12, maxWidth: 20, color: colors.textPrimary }}>{icon.symbol}</Text>}
            </View>
            <Text style={[styles.itemName, { color: colors.textPrimary }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Ionicons name={expanded?.has(item.path.endsWith('/') ? item.path : item.path + '/') ? 'chevron-down' : 'chevron-forward'} size={16} color={colors.textMuted} />
          </TouchableOpacity>
        );
      }

      const displayName = item.name.replace(/\.(md|markdown)$/i, '');
      return (
        <TouchableOpacity
          style={[styles.item, treeStyle, item.path === selectedPath && { backgroundColor: colors.accent + '20' }]}
          onPress={() => onFilePress(item)}
          accessibilityState={{ selected: item.path === selectedPath }}
          onLongPress={() => handleLongPress(item)}
          activeOpacity={0.6}
        >
          <NoteIcon path={item.path} symbol={icon?.symbol || undefined} color={icon?.color} />
          <Text style={[styles.itemName, { color: item.path === selectedPath ? colors.accent : colors.textPrimary }]} numberOfLines={1}>
            {displayName}
          </Text>
        </TouchableOpacity>
      );
    },
    [colors, fileIcons, vaultPath, selectedPath, onFilePress, onFolderPress, handleLongPress, indentation, expanded, metrics.rowRadius]
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={sortedFiles}
        keyExtractor={(item) => item.path}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.blue}
            colors={[colors.blue]}
            progressBackgroundColor={colors.bgTertiary}
          />
        }
        ListHeaderComponent={
          <>
            {onGoHome && (
              <TouchableOpacity accessibilityLabel="Go to home folder" style={styles.backRow} onPress={onGoHome}>
                <Ionicons name="home-outline" size={18} color={colors.blue} />
                <Text style={{ color: colors.blue }}>Home</Text>
              </TouchableOpacity>
            )}
            {!isAtRoot && (
              <TouchableOpacity style={[styles.backRow, { borderBottomColor: colors.bgTertiary }]} onPress={onNavigateUp}>
                <Ionicons name="chevron-back" size={20} color={colors.blue} />
                <Text style={[styles.backText, { color: colors.blue }]}>Back</Text>
                <Text style={[styles.folderTitle, { color: colors.textMuted }]} numberOfLines={1}>
                  {folderName}
                </Text>
              </TouchableOpacity>
            )}
            {!indentation && files.length > 0 && (
              <View style={[styles.sortRow, { borderBottomColor: colors.bgTertiary }]}>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{files.length} items</Text>
                <TouchableOpacity
                  style={styles.sortBtn}
                  onPress={() => setSortMode((m) => m === 'name' ? 'name-desc' : 'name')}
                >
                  <Ionicons
                    name={sortMode === 'name' ? 'arrow-down' : 'arrow-up'}
                    size={14}
                    color={colors.textMuted}
                  />
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>Name</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color={colors.border} />
            <Text style={[styles.emptyText, { color: colors.textMuted }]}>No notes yet</Text>
            <Text style={[styles.emptyHint, { color: colors.border }]}>
              Tap + to create your first note
            </Text>
          </View>
        }
        contentContainerStyle={files.length === 0 ? styles.emptyList : undefined}
        ItemSeparatorComponent={indentation ? undefined : () => <View style={[styles.separator, { backgroundColor: colors.bgTertiary }]} />}
      />

      {/* Rename modal */}
      <Modal visible={!!iconTarget} transparent animationType="fade" onRequestClose={() => setIconTarget(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalDialog, { backgroundColor: colors.bgTertiary, maxHeight: '85%' }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Icon for {iconTarget?.name}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ICONS.map(icon => <TouchableOpacity key={icon} accessibilityRole="button"
                  accessibilityState={{ selected: symbol === icon }} onPress={() => setSymbol(icon)}
                  style={{ padding: 8, borderRadius: 8, backgroundColor: symbol === icon ? iconColor : colors.bgPrimary }}>
                  <Text style={{ fontSize: 22 }}>{icon}</Text>
                </TouchableOpacity>)}
              </View>
              <TextInput accessibilityLabel="Custom emoji or symbol" placeholder="Custom emoji or symbol"
                placeholderTextColor={colors.textSecondary} value={symbol} onChangeText={setSymbol} maxLength={12}
                style={[styles.modalInput, { color: colors.textPrimary, borderColor: colors.border, marginTop: 12 }]} />
              <View style={{ flexDirection: 'row', gap: 12, marginVertical: 12 }}>
                {ICON_COLORS.map(color => <TouchableOpacity key={color} accessibilityRole="button"
                  accessibilityLabel={`Icon background ${color}`} accessibilityState={{ selected: color === iconColor }}
                  onPress={() => setIconColor(color)} style={{ width: 34, height: 34, borderRadius: 17,
                    backgroundColor: color, borderWidth: color === iconColor ? 2 : 0, borderColor: colors.textPrimary }} />)}
              </View>
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setIconTarget(null)}>
                  <Text style={{ color: colors.textSecondary }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCancel} onPress={() => saveIcon('')}>
                  <Text style={{ color: colors.textSecondary }}>Reset</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirm} disabled={!symbol.trim()} onPress={() => saveIcon(symbol.trim())}>
                  <Text style={{ color: colors.textPrimary }}>Save</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={renameTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalDialog, { backgroundColor: colors.bgTertiary }]}>
            <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>Rename</Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.bgPrimary, color: colors.textPrimary, borderColor: colors.border }]}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              selectTextOnFocus
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.blue}
              onSubmitEditing={handleRename}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setRenameTarget(null)}
              >
                <Text style={[styles.modalCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, { backgroundColor: colors.blue }]}
                onPress={handleRename}
              >
                <Text style={[styles.modalConfirmText, { color: colors.bgPrimary }]}>Rename</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
  },
  folderIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  separator: {
    height: 1,
    marginLeft: 70,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 4,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backText: {
    fontSize: 15,
    fontWeight: '500',
  },
  folderTitle: {
    fontSize: 15,
    marginLeft: 8,
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 8,
  },
  emptyHint: {
    fontSize: 14,
  },
  emptyList: {
    flex: 1,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  modalDialog: {
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  modalInput: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalCancel: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalCancelText: {
    fontSize: 15,
  },
  modalConfirm: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalConfirmText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
