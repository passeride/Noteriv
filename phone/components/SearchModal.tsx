import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Modal, StyleSheet, ActivityIndicator,
  Keyboard, Platform, KeyboardAvoidingView, type TextInputInstance,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { quickSearch } from '@/lib/file-system';
import { matchSearchFiles, type ContentHit, type SearchFile } from '@/lib/quick-search';

interface SearchModalProps {
  visible: boolean;
  onClose: () => void;
  vaultPath: string;
  onFileSelect: (path: string) => void;
  draft?: { path: string; text: string };
}

type SearchRow = (SearchFile & { kind: 'file' }) | (ContentHit & { kind: 'content' });

export default function SearchModal({ visible, onClose, vaultPath, onFileSelect, draft }: SearchModalProps) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [listing, setListing] = useState<{ vault: string; files: SearchFile[] }>();
  const [contents, setContents] = useState<{ query: string; vault: string; revision: number; hits: ContentHit[] }>();
  const [error, setError] = useState(false);
  const revision = useSyncExternalStore(quickSearch.subscribe, quickSearch.version, quickSearch.version);
  const inputRef = useRef<TextInputInstance>(null);
  const term = query.trim();

  useEffect(() => {
    if (!visible) {
      setQuery('');
      return;
    }
    const focus = setTimeout(() => inputRef.current?.focus(), 160);
    return () => clearTimeout(focus);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setError(false);
    void quickSearch.list(vaultPath).then(
      files => {
        if (!active) return;
        setListing({ vault: vaultPath, files });
        quickSearch.warm(vaultPath);
      },
      () => { if (active) setError(true); },
    );
    return () => { active = false; };
  }, [vaultPath, visible, revision]);

  const draftPath = draft?.path;
  const draftText = draft?.text;
  useEffect(() => {
    if (!visible || !term) return;
    const abort = new AbortController();
    setError(false);
    const timer = setTimeout(async () => {
      try {
        const override = draftPath && draftText !== undefined ? { path: draftPath, text: draftText } : undefined;
        const hits = await quickSearch.search(vaultPath, term, abort.signal, override);
        if (!abort.signal.aborted) setContents({ query: term, vault: vaultPath, revision, hits });
      } catch {
        if (!abort.signal.aborted) setError(true);
      }
    }, 85);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [visible, term, vaultPath, revision, draftPath, draftText]);

  const fileRows = useMemo(() => listing?.vault === vaultPath
    ? matchSearchFiles(listing.files, term).map(file => ({ ...file, kind: 'file' as const }))
    : [], [listing, vaultPath, term]);
  const contentMatches = contents?.query === term && contents.vault === vaultPath && contents.revision === revision;
  const rows: SearchRow[] = term && contentMatches
    ? [...fileRows, ...contents.hits.map(hit => ({ ...hit, kind: 'content' as const }))]
    : fileRows;
  const pending = !error && (listing?.vault !== vaultPath || (!!term && !contentMatches));
  function select(file: SearchRow) {
    Keyboard.dismiss();
    onFileSelect(file.filePath);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.header, { backgroundColor: colors.bgSecondary }]}>
            <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close search" hitSlop={10}>
              <Ionicons name="close" size={23} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.textPrimary }]}>Search</Text>
            <View style={styles.spacer} />
          </View>
          <View style={[styles.inputContainer, { backgroundColor: colors.bgTertiary, borderColor: colors.border }]}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput ref={inputRef} value={query} onChangeText={setQuery}
              style={[styles.input, { color: colors.textPrimary }]}
              placeholder="Search file names and contents"
              accessibilityLabel="Search file names and contents" placeholderTextColor={colors.textMuted}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search"
              onSubmitEditing={() => { if (rows[0]) select(rows[0]); }} />
            {pending && <ActivityIndicator color={colors.blue} size="small"
              accessibilityLabel={term ? 'Searching contents' : 'Loading files'} />}
            {!!query && <TouchableOpacity onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>}
          </View>
          <FlatList data={rows} keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}
            keyExtractor={item => item.kind === 'file' ? 'file:' + item.filePath : 'content:' + item.filePath + ':' + item.line}
            renderItem={({ item }) => (
              <TouchableOpacity style={[styles.row, { borderBottomColor: colors.bgTertiary }]}
                accessibilityRole="button"
                accessibilityLabel={item.kind === 'file' ? 'File name match: ' + item.fileName
                  : 'Content match in ' + item.fileName + ', line ' + item.line + ': ' + item.text}
                onPress={() => select(item)}>
                <Ionicons name={item.kind === 'file' ? 'document-outline' : 'reader-outline'}
                  size={19} color={item.kind === 'file' ? colors.blue : colors.textSecondary} />
                <View style={styles.result}>
                  <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>{item.fileName}</Text>
                  <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={1}>{item.relativePath}</Text>
                  {item.kind === 'content' && (
                    <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>L{item.line} · {item.text}</Text>
                  )}
                </View>
              </TouchableOpacity>
            )}
            ListFooterComponent={!pending && (error || !rows.length) ? <Text style={[styles.status, { color: colors.textMuted }]}>
              {error ? 'Search could not be completed' : term ? 'No matches found' : 'No searchable files'}
            </Text> : undefined} />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { flex: 1, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  spacer: { width: 23 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16,
    marginVertical: 8, borderRadius: 10, paddingHorizontal: 12, borderWidth: 1 },
  input: { flex: 1, fontSize: 15, paddingVertical: 12 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
    paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  result: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  detail: { fontSize: 12 },
  status: { textAlign: 'center', paddingVertical: 18 },
});
