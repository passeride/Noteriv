import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, Modal, StyleSheet, ActivityIndicator,
  Keyboard, Platform, KeyboardAvoidingView, Pressable, type TextInputInstance,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { quickSearch } from '@/lib/file-system';
import { matchSearchFiles, type ContentHit, type SearchFile } from '@/lib/quick-search';

export type LauncherMode = 'files' | 'commands';
export type EditorCommand = { label: string; run: () => void };

let recentCommands: string[] = [];

interface QuickLauncherProps {
  mode: LauncherMode;
  onModeChange: (mode: LauncherMode) => void;
  commands: EditorCommand[];
  onClose: () => void;
  vaultPath: string;
  onFileSelect: (path: string, line?: number) => void;
  draft?: { path: string; text: string };
}

type SearchRow = (SearchFile & { kind: 'file' }) | (ContentHit & { kind: 'content' });

export default function QuickLauncher({ mode, onModeChange, commands, onClose, vaultPath, onFileSelect, draft }: QuickLauncherProps) {
  const { colors, metrics } = useTheme();
  const [fileQuery, setFileQuery] = useState('');
  const [commandQuery, setCommandQuery] = useState('');
  const isFiles = mode === 'files';
  const query = isFiles ? fileQuery : commandQuery;
  const setQuery = isFiles ? setFileQuery : setCommandQuery;
  const [listing, setListing] = useState<{ vault: string; files: SearchFile[] }>();
  const [contents, setContents] = useState<{ query: string; vault: string; revision: number; hits: ContentHit[] }>();
  const [error, setError] = useState(false);
  const revision = useSyncExternalStore(quickSearch.subscribe, quickSearch.version, quickSearch.version);
  const inputRef = useRef<TextInputInstance>(null);
  const term = query.trim();

  const requestedFocus = useRef(false);
  const focusInput = () => {
    if (requestedFocus.current) return;
    requestedFocus.current = true;
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const switchMode = (next: LauncherMode) => {
    onModeChange(next);
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!isFiles) return;
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
  }, [vaultPath, isFiles, revision]);

  const draftPath = draft?.path;
  const draftText = draft?.text;
  useEffect(() => {
    if (!isFiles || !term) return;
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
  }, [isFiles, term, vaultPath, revision, draftPath, draftText]);

  const fileRows = useMemo(() => listing?.vault === vaultPath
    ? matchSearchFiles(listing.files, term).map(file => ({ ...file, kind: 'file' as const }))
    : [], [listing, vaultPath, term]);
  const contentMatches = contents?.query === term && contents.vault === vaultPath && contents.revision === revision;
  const rows: SearchRow[] = term && contentMatches
    ? [...fileRows, ...contents.hits.map(hit => ({ ...hit, kind: 'content' as const }))]
    : fileRows;
  const pending = !error && (listing?.vault !== vaultPath || (!!term && !contentMatches));
  const commandRows = useMemo(() => {
    if (isFiles) return [];
    const query = commandQuery.trim().toLowerCase();
    return commands.map(command => {
      const label = command.label.toLowerCase();
      let position = 0;
      for (const char of label) if (char === query[position]) position++;
      const score = label.startsWith(query) ? 3 : label.includes(query) ? 2 : position === query.length ? 1 : 0;
      const recent = recentCommands.indexOf(command.label);
      return { command, score, recent: recent < 0 ? Infinity : recent };
    }).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.recent - b.recent)
      .map(item => item.command);
  }, [commands, commandQuery, isFiles]);

  function select(file: SearchRow) {
    Keyboard.dismiss();
    onClose();
    onFileSelect(file.filePath, file.kind === 'content' ? file.line : undefined);
  }

  function execute(command: EditorCommand) {
    recentCommands = [command.label, ...recentCommands.filter(label => label !== command.label)].slice(0, 8);
    Keyboard.dismiss();
    onClose();
    requestAnimationFrame(command.run);
  }

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };
  const body = (
    <KeyboardAvoidingView style={styles.stage} pointerEvents="box-none" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close quick launcher" onPress={close} />
      <View style={[styles.panel, { maxWidth: metrics.launcherWidth, backgroundColor: colors.bgPrimary,
        borderColor: colors.border, borderRadius: metrics.panelRadius }]} accessibilityViewIsModal>
        <View style={[styles.inputContainer, { backgroundColor: colors.bgSecondary, borderColor: colors.border, borderRadius: metrics.controlRadius }]}>
          <Ionicons name={isFiles ? 'search' : 'terminal-outline'} size={19} color={colors.accent} />
          <TextInput ref={inputRef} value={query} onChangeText={setQuery}
            onLayout={Platform.OS === 'android' ? focusInput : undefined}
            style={[styles.input, { color: colors.textPrimary }]}
            placeholder={isFiles ? 'Search file names and contents' : 'Search commands'}
            accessibilityLabel={isFiles ? 'Search file names and contents' : 'Search commands'} placeholderTextColor={colors.textMuted}
            autoCapitalize="none" autoCorrect={false} returnKeyType={isFiles ? 'search' : 'go'}
            onSubmitEditing={() => {
              if (isFiles && rows[0]) select(rows[0]);
              if (!isFiles && commandRows[0]) execute(commandRows[0]);
            }} />
          {isFiles && pending && <ActivityIndicator color={colors.accent} size="small"
            accessibilityLabel={term ? 'Searching contents' : 'Loading files'} />}
          {!!query && <TouchableOpacity onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>}
          <TouchableOpacity onPress={close} accessibilityRole="button" accessibilityLabel="Close quick launcher" style={styles.close}>
            <Ionicons name="close" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={[styles.tabs, { borderColor: colors.border }]} accessibilityRole="tablist">
          {(['files', 'commands'] as const).map(tab => (
            <Pressable key={tab} accessibilityRole="tab" accessibilityState={{ selected: tab === mode }}
              onPress={() => switchMode(tab)} style={[styles.tab, { borderRadius: metrics.controlRadius },
                tab === mode && { backgroundColor: colors.accent + '18' }]}>
              <Text style={{ color: tab === mode ? colors.accent : colors.textSecondary, fontWeight: '600' }}>
                {tab === 'files' ? 'Files & contents' : 'Commands'}
              </Text>
            </Pressable>
          ))}
        </View>
        {isFiles ? <FlatList data={rows} keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          keyExtractor={item => item.kind === 'file' ? 'file:' + item.filePath : 'content:' + item.filePath + ':' + item.line}
          renderItem={({ item, index }) => (
            <TouchableOpacity style={[styles.row, { borderRadius: metrics.rowRadius },
              index === 0 && !!term && { backgroundColor: colors.accent + '14' }]}
              accessibilityRole="button"
              accessibilityLabel={item.kind === 'file' ? 'File name match: ' + item.fileName
                : 'Content match in ' + item.fileName + ', line ' + item.line + ': ' + item.text}
              onPress={() => select(item)}>
              <Ionicons name={item.kind === 'file' ? 'document-outline' : 'reader-outline'}
                size={20} color={item.kind === 'file' ? colors.accent : colors.textSecondary} />
              <View style={styles.result}>
                <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>{item.fileName}</Text>
                <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={1}>{item.relativePath}</Text>
                {item.kind === 'content' && (
                  <Text style={[styles.detail, { color: colors.textSecondary }]} numberOfLines={2}>L{item.line} · {item.text}</Text>
                )}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={!pending ? <Text style={[styles.status, { color: colors.textMuted }]}>
            {error ? 'Search could not be completed' : term ? 'No matches found' : 'No searchable files'}
          </Text> : undefined} />
        : <FlatList data={commandRows} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}
            keyExtractor={(item, index) => item.label + ':' + index}
            ListEmptyComponent={<Text style={[styles.status, { color: colors.textMuted }]}>No matching commands</Text>}
            renderItem={({ item, index }) => (
              <Pressable accessibilityRole="button" onPress={() => execute(item)}
                style={[styles.row, { borderRadius: metrics.rowRadius },
                  index === 0 && !!term && { backgroundColor: colors.accent + '14' }]}>
                <Ionicons name="terminal-outline" size={18} color={colors.accent} />
                <Text style={{ flex: 1, color: colors.textPrimary }}>{item.label}</Text>
              </Pressable>
            )} />}
      </View>
    </KeyboardAvoidingView>
  );

  if (Platform.OS === 'android') return <View style={[styles.inline, styles.scrim]}>{body}</View>;
  return (
    <Modal transparent animationType="fade" onRequestClose={close} onShow={focusInput}>
      <SafeAreaView style={styles.scrim}>{body}</SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  inline: { ...StyleSheet.absoluteFill, zIndex: 220 },
  scrim: { flex: 1, backgroundColor: 'rgba(17,24,20,0.38)' },
  stage: { flex: 1, alignItems: 'center', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  panel: { width: '100%', flexShrink: 1, maxHeight: '100%', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 10,
    marginTop: 10, paddingLeft: 10, borderWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, fontSize: 15, minHeight: 48 },
  close: { width: 40, height: 48, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: 4, marginTop: 4, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, marginVertical: 4 },
  list: { paddingHorizontal: 8, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 8, minHeight: 48 },
  result: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontWeight: '600' },
  detail: { fontSize: 12 },
  status: { textAlign: 'center', paddingVertical: 18 },
});
