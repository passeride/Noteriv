import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Animated, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions, type TextInputInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Paths } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { Image } from 'react-native';
import { readDecorations } from '@/lib/file-decoration';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';
import NotesList from '@/components/NotesList';
import { readDir } from '@/lib/file-system';

let recentCommands: string[] = [];

export type EditorCommand = { label: string; run: () => void };
type Props = {
  mode: 'files' | 'commands';
  vaultPath: string;
  notePath: string;
  commands: EditorCommand[];
  fileCommands: EditorCommand[];
  vaultName: string;
  initialFolder?: string;
  editIconPath?: string;
  onSwitchVault: () => void;
  onCreate: (folder: string) => void;
  onRefresh: () => void;
  onClose: () => void;
  onOpenNote: (path: string) => void;
};

export default function EditorOverlay({ mode, vaultPath, notePath, commands, fileCommands, vaultName, initialFolder, editIconPath, onSwitchVault, onCreate, onRefresh, onClose, onOpenNote }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [folder, setFolder] = useState(() => {
    if (initialFolder) return initialFolder;
    const parent = Paths.dirname(notePath);
    if (notePath === vaultPath || !parent.startsWith(vaultPath)) return vaultPath;
    return parent.endsWith('/') ? parent : parent + '/';
  });
  const [query, setQuery] = useState('');
  const isFiles = mode === 'files';
  const inlineCommands = !isFiles && Platform.OS === 'android';
  const commandInput = useRef<TextInputInstance>(null);
  const requestedFocus = useRef(false);
  const focusCommands = () => {
    if (requestedFocus.current) return;
    requestedFocus.current = true;
    requestAnimationFrame(() => commandInput.current?.focus());
  };
  const [revision, setRevision] = useState(0);
  const [showActions, setShowActions] = useState(false);
  const items = useMemo(() => isFiles ? readDir(folder) : [], [folder, isFiles, revision]);
  const fabOffset = useRef(new Animated.Value(80)).current;
  useEffect(() => {
    if (!isFiles) return;
    const animation = Animated.timing(fabOffset, { toValue: 0, duration: 180, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [fabOffset, isFiles]);
  const banner = useMemo(() => isFiles
    ? readDecorations(vaultPath)[vaultRelativePath(vaultPath, folder).replace(/\/$/, '')]?.banner
    : undefined, [folder, isFiles, vaultPath, revision]);
  const term = query.trim().toLowerCase();
  const ranked = commands.map(command => {
    const label = command.label.toLowerCase();
    let position = 0;
    for (const character of label) {
      if (character === term[position]) position++;
    }
    const score = label.startsWith(term) ? 3 : label.includes(term) ? 2 : position === term.length ? 1 : 0;
    const recent = recentCommands.indexOf(command.label);
    return { command, score, recent: recent < 0 ? Infinity : recent };
  });
  const matched = ranked.filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.recent - b.recent)
    .map(item => item.command);
  const exit = (run: () => void) => { onClose(); run(); };
  const execute = (command: EditorCommand) => {
    recentCommands = [command.label, ...recentCommands.filter(label => label !== command.label)].slice(0, 8);
    exit(command.run);
  };
  const goUp = () => {
    const parent = Paths.dirname(folder);
    const normalized = parent.endsWith('/') ? parent : parent + '/';
    setFolder(normalized.startsWith(vaultPath) ? normalized : vaultPath);
  };

  const body = (
    <>
        <Pressable accessibilityLabel="Close overlay" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View accessibilityViewIsModal style={[
          styles.panel, { backgroundColor: colors.bgSecondary, borderColor: colors.border },
          isFiles ? { width: Math.min(340, width * 0.78), flex: 1 } : styles.palette,
        ]}>
          <View style={styles.header}>
            <Text onPress={isFiles ? () => exit(onSwitchVault) : undefined} accessibilityRole={isFiles ? "button" : "header"} style={[styles.title, { color: colors.textPrimary }]}>
              {isFiles ? vaultName + ' ⌄' : 'Command palette'}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          {isFiles ? (
            <>
              <View style={styles.header}>
                <Pressable accessibilityRole="button" onPress={() => setFolder(vaultPath)}>
                  <Text style={{ color: colors.accent }}>Vault root</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setShowActions(value => !value)}>
                  <Text style={{ color: colors.accent }}>{showActions ? 'Files' : 'Actions'}</Text>
                </Pressable>
              </View>
              {banner && <Image source={{ uri: vaultFileUri(vaultPath, banner) }}
                resizeMode="cover" style={{ width: '100%', height: 90 }} />}
              {showActions ? <FlatList data={fileCommands} keyExtractor={item => item.label}
                renderItem={({ item }) => (
                  <Pressable accessibilityRole="button" style={styles.row} onPress={() => exit(item.run)}>
                    <Text style={{ color: colors.textPrimary }}>{item.label}</Text>
                  </Pressable>
                )} /> : <NotesList files={items} currentDir={folder} vaultPath={vaultPath}
                selectedPath={notePath} editIconPath={editIconPath} isAtRoot={folder === vaultPath} onNavigateUp={goUp}
                onFolderPress={entry => setFolder(entry.path)}
                onFilePress={entry => exit(() => onOpenNote(entry.path))}
                onRefresh={() => { setRevision(value => value + 1); onRefresh(); }} />}
            </>
          ) : (
            <>
              <TextInput ref={commandInput} accessibilityLabel="Search commands" placeholder="Search commands"
                onLayout={inlineCommands ? focusCommands : undefined}
                placeholderTextColor={colors.textMuted} value={query} onChangeText={setQuery}
                autoCapitalize="none" autoCorrect={false} returnKeyType="go"
                onSubmitEditing={() => { if (matched.length) execute(matched[0]); }}
                style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} />
              <FlatList keyboardShouldPersistTaps="handled" data={matched} keyExtractor={item => item.label}
                ListEmptyComponent={<Text style={[styles.empty, { color: colors.textMuted }]}>No matching commands</Text>}
                renderItem={({ item }) => (
                  <Pressable accessibilityRole="button" style={styles.row} onPress={() => execute(item)}>
                    <Text style={{ color: colors.textPrimary }}>{item.label}</Text>
                  </Pressable>
                )} />
            </>
          )}
        </View>
        {isFiles && <Animated.View style={[styles.fab, { transform: [{ translateX: fabOffset }] }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="New note or folder"
            style={[styles.fabButton, { backgroundColor: colors.accent }]}
            onPress={() => exit(() => onCreate(folder))}>
            <Ionicons name="add" size={28} color={colors.bgPrimary} />
          </Pressable>
        </Animated.View>}
    </>
  );

  // Keep the input in Android's focused activity window so native focus can open the IME.
  if (inlineCommands) {
    return <View style={[styles.inline, styles.stage, styles.paletteStage]}>{body}</View>;
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} onShow={isFiles ? undefined : focusCommands}>
      <SafeAreaView style={[styles.stage, !isFiles && styles.paletteStage]}>{body}</SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 16, bottom: 32 },
  fabButton: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  inline: { ...StyleSheet.absoluteFill, zIndex: 200 },
  stage: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'flex-start' },
  paletteStage: { alignItems: 'center', paddingTop: 24, paddingHorizontal: 16 },
  panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden' },
  palette: { width: '100%', maxWidth: 480, maxHeight: '70%' },
  header: { padding: 14, gap: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '600' },
  row: { minHeight: 46, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { borderWidth: 1, borderRadius: 8, marginHorizontal: 12, marginBottom: 8, padding: 10 },
  empty: { padding: 14 },
});
