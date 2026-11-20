import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Paths } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { readDir } from '@/lib/file-system';

export type EditorCommand = { label: string; run: () => void };
type Props = {
  mode: 'files' | 'commands';
  vaultPath: string;
  notePath: string;
  commands: EditorCommand[];
  onClose: () => void;
  onOpenNote: (path: string) => void;
};

export default function EditorOverlay({ mode, vaultPath, notePath, commands, onClose, onOpenNote }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [folder, setFolder] = useState(() => {
    const parent = Paths.dirname(notePath);
    return parent.endsWith('/') ? parent : parent + '/';
  });
  const [query, setQuery] = useState('');
  const isFiles = mode === 'files';
  const items = useMemo(() => isFiles
    ? readDir(folder).filter(entry => entry.isDirectory || /\.(md|markdown)$/i.test(entry.name))
    : [], [folder, isFiles]);
  const matched = commands.filter(command => command.label.toLowerCase().includes(query.trim().toLowerCase()));
  const exit = (run: () => void) => { onClose(); run(); };
  const goUp = () => {
    const parent = Paths.dirname(folder);
    const normalized = parent.endsWith('/') ? parent : parent + '/';
    setFolder(normalized.startsWith(vaultPath) ? normalized : vaultPath);
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={[styles.stage, !isFiles && styles.paletteStage]}>
        <Pressable accessibilityLabel="Close overlay" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View accessibilityViewIsModal style={[
          styles.panel, { backgroundColor: colors.bgSecondary, borderColor: colors.border },
          isFiles ? { width: Math.min(340, width * 0.78), flex: 1 } : styles.palette,
        ]}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
              {isFiles ? 'Files' : 'Command palette'}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={12} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          {isFiles ? (
            <>
              <View style={styles.header}>
                <Pressable accessibilityRole="button" onPress={() => setFolder(vaultPath)}>
                  <Text style={{ color: colors.accent }}>Vault</Text>
                </Pressable>
                {folder !== vaultPath && (
                  <Pressable accessibilityRole="button" onPress={goUp}>
                    <Text style={{ color: colors.accent }}>Up · {Paths.basename(folder)}</Text>
                  </Pressable>
                )}
              </View>
              <FlatList data={items} keyExtractor={entry => entry.path}
                ListEmptyComponent={<Text style={[styles.empty, { color: colors.textMuted }]}>No notes or folders</Text>}
                renderItem={({ item }) => (
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: item.path === notePath }}
                    style={[styles.row, item.path === notePath && { backgroundColor: colors.bgTertiary }]}
                    onPress={() => item.isDirectory ? setFolder(item.path.endsWith('/') ? item.path : item.path + '/') : exit(() => onOpenNote(item.path))}>
                    <Ionicons name={item.isDirectory ? 'folder-outline' : 'document-text-outline'} size={20} color={colors.accent} />
                    <Text numberOfLines={2} style={{ color: colors.textPrimary, flex: 1 }}>{item.name}</Text>
                  </Pressable>
                )} />
            </>
          ) : (
            <>
              <TextInput autoFocus accessibilityLabel="Search commands" placeholder="Search commands"
                placeholderTextColor={colors.textMuted} value={query} onChangeText={setQuery}
                autoCapitalize="none" autoCorrect={false} returnKeyType="go"
                onSubmitEditing={() => { if (matched.length === 1) exit(matched[0].run); }}
                style={[styles.input, { color: colors.textPrimary, borderColor: colors.border }]} />
              <FlatList keyboardShouldPersistTaps="handled" data={matched} keyExtractor={item => item.label}
                ListEmptyComponent={<Text style={[styles.empty, { color: colors.textMuted }]}>No matching commands</Text>}
                renderItem={({ item }) => (
                  <Pressable accessibilityRole="button" style={styles.row} onPress={() => exit(item.run)}>
                    <Text style={{ color: colors.textPrimary }}>{item.label}</Text>
                  </Pressable>
                )} />
            </>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
