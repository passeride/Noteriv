import { pluginEvents } from '@/lib/plugin-events';
import { PluginStatusBar, usePluginCommands } from '@/components/MobilePluginHost';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Linking,
  BackHandler,
  ActivityIndicator,
  Keyboard,
  Modal,
  FlatList,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import Animated, {
  useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { GestureDetector, usePinchGesture, useExclusiveGestures, useSimultaneousGestures } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Paths } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import MarkdownEditor from '@/components/MarkdownEditor';
import LiveMarkdownEditor from '@/components/LiveMarkdownEditor';
import { getLineInfo, replaceLineRange, toggleTaskMarker } from '@/lib/markdown';
import { markdownLinkTarget } from '@/lib/markdown-links';
import { Directory, File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Git from '@/lib/provider-sync';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';
import { hasInvalidProperties, setProperty } from '@/lib/properties';
import QuickLauncher, { type EditorCommand } from '@/components/QuickLauncher';
import NoteDetails from '@/components/NoteDetails';
import SyncStatusSheet from '@/components/SyncStatusSheet';
import SyncToast from '@/components/SyncToast';
import MarkdownPreview from '@/components/MarkdownPreview';
import AttachmentPreview from '@/components/AttachmentPreview';
import { filePreviewKind } from '@/lib/file-preview';
import BoardView from '@/components/BoardView';
import FileDrawer from '@/components/FileDrawer';
import { rename as renameFile, listAllMarkdownFiles } from '@/lib/file-system';
import { lintMarkdown, LintWarning } from '@/lib/markdown-lint';
import { isBoardContent, isBoardFile } from '@/lib/board-utils';
import { parseWikiLink, resolveWikiLink, warmWikiLinks } from '@/lib/wiki-links';
import { useFileSwipes } from '@/components/useFileSwipes';
import { useCommandPull } from '@/components/CommandPull';
import { useFileNavigation } from '@/lib/use-file-navigation';
import { useFilePanelActions } from '@/lib/use-file-panel-actions';
import { clampNoteFontSize } from '../../packages/appearance/note-text';

// The toolbar uses bundled Ionicons artwork with fixed layout bounds.
const toolbarIcons = {
  back: require('../assets/images/editor-toolbar/back.png'),
  files: require('../assets/images/editor-toolbar/files.png'),
};

export default function EditorRoute() {
  const { path } = useLocalSearchParams<{ path: string }>();
  const kind = typeof path === 'string' ? filePreviewKind(path) : null;
  if (kind) return <AttachmentPreview key={path} path={path} kind={kind} />;
  return <EditorScreen />;
}

export function EditorScreen({ root = false, homePath }: { root?: boolean; homePath?: string }) {
  const router = useRouter();
  const { open: openFileDestination, back: goBackInFiles, forward: goForwardInFiles } = useFileNavigation();
  const { path: routePath, heading, line } = useLocalSearchParams<{ path: string; heading?: string; line?: string }>();
  const path = root ? homePath : routePath;
  const [anchor, setAnchor] = useState<{ heading?: string; line?: number } | null>(() =>
    heading ? { heading } : line && Number.isSafeInteger(Number(line)) && Number(line) > 0 ? { line: Number(line) } : null
  );
  const { colors, metrics } = useTheme();
  const {
    currentFile,
    content,
    setContent,
    setCurrentFile,
    saveFile,
    flushFile,
    isDirty,
    settings,
    updateSettings,
    workspace,
    updateWorkspace,
    vault,
    files,
    refreshFiles,
  } = useApp();

  const [overlay, setOverlay] = useState<'files' | 'commands' | 'search' | null>(root && !homePath ? 'files' : null);
  const [editIconPath, setEditIconPath] = useState<string>();
  const [pinchFontSize, setPinchFontSize] = useState<number>();
  const pinchZoom = useRef<{ startSize: number; size: number } | null>(null);
  const fontSize = pinchFontSize ?? settings.fontSize;
  const liveReplacement = settings.livePreviewReplacement;
  const isEditing = workspace.viewMode !== 'preview' && !anchor;
  const usesLiveEditor = isEditing
    ? workspace.viewMode === 'live' || (workspace.viewMode === 'edit' && liveReplacement === 'both')
    : liveReplacement !== 'off';
  const canToggleViewMode = !(usesLiveEditor && liveReplacement === 'both');
  const preferredEditMode = useRef<'edit' | 'live'>(workspace.viewMode === 'live' ? 'live' : 'edit');
  const inlineLauncher = (overlay === 'commands' || overlay === 'search') && Platform.OS === 'android';
  const [startCreating, setStartCreating] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [focusMode, setFocusMode] = useState(false);
  const [lintVisible, setLintVisible] = useState(false);
  const [lintWarnings, setLintWarnings] = useState<LintWarning[]>([]);
  const activePath = useRef(currentFile);
  activePath.current = currentFile;
  const linkRequest = useRef(0);
  const [openingLink, setOpeningLink] = useState(false);

  // A board is a file named *.board.md or one whose front matter says
  // "board: true", as on the desktop.
  const isBoard = (!!currentFile && isBoardFile(currentFile)) || isBoardContent(content);

  // Sibling notes for swipe navigation
  const siblingNotes = useMemo(() => {
    return files.filter((f) => !f.isDirectory && /\.(md|markdown)$/i.test(f.name));
  }, [files]);

  const currentIndex = useMemo(() => {
    if (!path) return -1;
    return siblingNotes.findIndex((f) => f.path === path);
  }, [siblingNotes, path]);

  const nextFile = currentIndex >= 0 ? siblingNotes[currentIndex + 1]?.path : undefined;
  const forward = () => goForwardInFiles(nextFile);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setEditIconPath(undefined);
    setStartCreating(false);
  }, []);

  const handleBack = useCallback(() => {
    if (inlineLauncher) {
      Keyboard.dismiss();
      closeOverlay();
      return;
    }
    if (!flushFile()) {
      Alert.alert('Error', 'Failed to save file.');
      return;
    }
    if (root || !router.canGoBack()) {
      setOverlay('files');
      return;
    }
    void setCurrentFile(null);
    goBackInFiles();
  }, [closeOverlay, flushFile, inlineLauncher, root, setCurrentFile, router, goBackInFiles]);

  useFocusEffect(useCallback(() => {
    if ((path || root) && activePath.current !== (path ?? null)) void setCurrentFile(path ?? null);
    return () => {
      linkRequest.current++;
      setOpeningLink(false);
    };
  }, [path, root, setCurrentFile]));

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
  }, [handleBack]));

  useFocusEffect(useCallback(() => {
    if (!path || root) return;
    const listener = pluginEvents.addListener('deleted', deleted => {
      if (deleted !== path) return;
      if (router.canGoBack()) router.back();
      else router.replace('/');
    });
    return () => listener.remove();
  }, [path, root, router]));

  const handleSave = useCallback(async () => {
    const ok = await saveFile();
    if (!ok) {
      Alert.alert('Error', 'Failed to save file.');
    }
  }, [saveFile]);

  const selectEditMode = useCallback((mode: 'edit' | 'live' | 'source') => {
    setAnchor(null);
    preferredEditMode.current = mode === 'live' ? 'live' : 'edit';
    updateWorkspace({ viewMode: mode });
  }, [updateWorkspace]);

  const toggleViewMode = useCallback(() => {
    if (isEditing) {
      preferredEditMode.current = workspace.viewMode === 'live' ? 'live' : 'edit';
      updateWorkspace({ viewMode: 'preview' });
    } else {
      selectEditMode(liveReplacement === 'off' ? preferredEditMode.current : 'edit');
    }
  }, [isEditing, workspace.viewMode, selectEditMode, updateWorkspace, liveReplacement]);

  const handleBookmark = useCallback(() => {
    if (!currentFile) return;
    const bookmarks = workspace.bookmarks ?? [];
    const isBookmarked = bookmarks.includes(currentFile);
    updateWorkspace({
      bookmarks: isBookmarked
        ? bookmarks.filter((b) => b !== currentFile)
        : [...bookmarks, currentFile],
    });
    setMenuVisible(false);
  }, [currentFile, workspace.bookmarks, updateWorkspace]);

  const handleDelete = useCallback(() => {
    Alert.alert('Delete File', 'Are you sure you want to delete this file?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setCurrentFile(null);
          router.back();
        },
      },
    ]);
    setMenuVisible(false);
  }, [setCurrentFile, router]);

  const handleRename = useCallback(() => {
    setMenuVisible(false);
    setRenameValue(fileName);
    setRenameVisible(true);
  }, []);

  const vaultPath = vault?.path;
  useEffect(() => {
    if (!vaultPath) return;
    const timer = setTimeout(() => warmWikiLinks(vaultPath), 250);
    return () => clearTimeout(timer);
  }, [vaultPath]);

  const openNoteLink = useCallback(async (name: string, markdown = false) => {
    if (!vault) return;
    const request = ++linkRequest.current;
    const indicator = setTimeout(() => {
      if (request === linkRequest.current) setOpeningLink(true);
    }, 180);
    try {
      const resolved = await resolveWikiLink(name, vault.path, currentFile, markdown);
      if (request !== linkRequest.current) return;
      if (!resolved) {
        Alert.alert('Note not found', name);
        return;
      }
      const targetHeading = parseWikiLink(name).heading;
      if (resolved === currentFile) {
        if (targetHeading) setAnchor({ heading: targetHeading });
        return;
      }
      openFileDestination({ path: resolved, ...(targetHeading ? { heading: targetHeading } : {}) });
    } catch {
      if (request === linkRequest.current) Alert.alert('Could not open note', name);
    } finally {
      clearTimeout(indicator);
      if (request === linkRequest.current) setOpeningLink(false);
    }
  }, [vault, currentFile, openFileDestination]);

  const handleMarkdownLink = useCallback((url: string) => {
    void openNoteLink(url, true);
  }, [openNoteLink]);

  const handleLiveLink = useCallback((url: string) => {
    const target = markdownLinkTarget(url);
    if (target?.kind === 'note') handleMarkdownLink(target.url);
    if (target?.kind === 'external') {
      void Linking.openURL(target.url).catch(() => Alert.alert('Could not open link'));
    }
  }, [handleMarkdownLink]);

  const handleLiveTask = useCallback((line: number) => {
    const info = getLineInfo(content, line);
    setContent(replaceLineRange(content, line, line, toggleTaskMarker(info.text)));
  }, [content, setContent]);

  const handleLint = useCallback(async () => {
    setMenuVisible(false);
    if (!vault) return;
    const files = await listAllMarkdownFiles(vault.path);
    const fileNames = files.map((f) => f.fileName);
    const warnings = lintMarkdown(content, vault.path, fileNames);
    setLintWarnings(warnings);
    setLintVisible(true);
  }, [content, vault]);

  const confirmRename = useCallback(() => {
    if (!currentFile || !renameValue.trim()) return;
    const newName = renameValue.trim().endsWith('.md')
      ? renameValue.trim()
      : renameValue.trim() + '.md';
    if (!flushFile() || !renameFile(currentFile, newName)) return;
    setRenameVisible(false);
    if (root) {
      void setCurrentFile(null);
      setOverlay('files');
    } else router.back();
  }, [currentFile, flushFile, renameValue, root, router, setCurrentFile]);

  const displayedPath = root ? path : path || currentFile;
  const fileName = displayedPath ? Paths.basename(displayedPath) : 'Note';
  const loadingNote = Boolean(path && currentFile !== path);
  const [showNoteSpinner, setShowNoteSpinner] = useState(false);
  useEffect(() => {
    if (!loadingNote) {
      setShowNoteSpinner(false);
      return;
    }
    const timer = setTimeout(() => setShowNoteSpinner(true), 180);
    return () => clearTimeout(timer);
  }, [loadingNote]);

  const collapsibleHeader = !!displayedPath && !loadingNote && !focusMode && !isBoard && !usesLiveEditor &&
    (workspace.viewMode === 'preview' || !!anchor);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [headerHidden, setHeaderHidden] = useState(false);
  const headerTravel = useSharedValue(0);
  const previousScrollY = useSharedValue(0);
  const scrollingUp = useSharedValue(false);

  useEffect(() => {
    headerTravel.value = 0;
    previousScrollY.value = 0;
    scrollingUp.value = false;
  }, [collapsibleHeader, displayedPath, headerTravel, previousScrollY, scrollingUp]);

  const readingScroll = useAnimatedScrollHandler({
    onBeginDrag: event => {
      previousScrollY.value = Math.max(0, event.contentOffset.y);
    },
    onScroll: event => {
      const maximum = Math.max(0, event.contentSize.height - event.layoutMeasurement.height);
      const y = Math.min(maximum, Math.max(0, event.contentOffset.y));
      const delta = y - previousScrollY.value;
      previousScrollY.value = y;
      if (y === 0 || maximum < headerHeight) {
        headerTravel.value = 0;
      } else if (delta !== 0) {
        scrollingUp.value = delta < 0;
        // Reveal the actions after a small reverse scroll.
        headerTravel.value = Math.min(headerHeight, Math.max(0, headerTravel.value + delta * (delta < 0 ? 3 : 1)));
      }
    },
    onEndDrag: () => {
      headerTravel.value = withTiming(!scrollingUp.value && headerTravel.value >= headerHeight / 2 ? headerHeight : 0, { duration: 140 });
    },
    onMomentumEnd: () => {
      headerTravel.value = withTiming(!scrollingUp.value && headerTravel.value >= headerHeight / 2 ? headerHeight : 0, { duration: 140 });
    },
  });
  const readingHeaderStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: collapsibleHeader ? -headerTravel.value : 0 }],
  }));
  useAnimatedReaction(
    () => collapsibleHeader && headerHeight > 0 && headerTravel.value >= headerHeight,
    (hidden, previous) => {
      if (hidden !== previous) scheduleOnRN(setHeaderHidden, hidden);
    }
  );

  const isBookmarked =
    currentFile && (workspace.bookmarks ?? []).includes(currentFile);

  const openOverlay = useCallback((mode: 'files' | 'commands' | 'search') => {
    if (mode === 'files') Keyboard.dismiss();
    setMenuVisible(false);
    setOverlay(mode);
  }, []);
  const openCommands = useCallback(() => openOverlay('commands'), [openOverlay]);
  const pullDownCommands = vault && !overlay && !menuVisible && Platform.OS !== 'web' ? openCommands : undefined;
  const openFiles = useCallback(() => openOverlay('files'), [openOverlay]);
  const openSearch = useCallback(() => openOverlay('search'), [openOverlay]);
  const openDetails = useCallback(() => { setMenuVisible(false); Keyboard.dismiss(); setDetailsVisible(true); }, []);
  const newEntry = () => { setStartCreating(true); openFiles(); };
  const canSwipeFiles = !!vault && !overlay && !menuVisible && Platform.OS !== 'web';
  const hasMarkdownNote = !!displayedPath && !loadingNote && !isBoard;
  const setNoteFontSize = useCallback((size: number) => {
    const nextSize = clampNoteFontSize(size);
    if (nextSize !== settings.fontSize) void updateSettings({ fontSize: nextSize });
  }, [settings.fontSize, updateSettings]);
  // The hook-based gesture survives Android's multiline input taking native touch ownership.
  const pinch = usePinchGesture({
    enabled: hasMarkdownNote && !overlay && !menuVisible,
    runOnJS: true,
    onActivate: () => {
      pinchZoom.current = { startSize: settings.fontSize, size: settings.fontSize };
    },
    onUpdate: ({ scale }) => {
      const zoom = pinchZoom.current;
      if (!zoom) return;
      const nextSize = clampNoteFontSize(zoom.startSize * scale);
      if (nextSize === zoom.size) return;
      zoom.size = nextSize;
      setPinchFontSize(nextSize);
    },
    onDeactivate: ({ canceled }) => {
      const zoom = pinchZoom.current;
      if (!zoom) return;
      pinchZoom.current = null;
      if (!canceled) setNoteFontSize(zoom.size);
      setPinchFontSize(undefined);
    },
  });
  const bodySwipe = useFileSwipes(canSwipeFiles, openFiles, openCommands, forward,
    isEditing && !usesLiveEditor && !settings.wordWrap);
  const noteGestures = useSimultaneousGestures(bodySwipe, pinch);
  const headerSwipe = useFileSwipes(canSwipeFiles, openFiles, openCommands, forward);
  const headerScroll = useSharedValue(0);
  const { gesture: headerPull } = useCommandPull(pullDownCommands, headerScroll);
  const headerGestures = useExclusiveGestures(headerSwipe, headerPull);
  const openNote = (notePath: string, targetLine?: number) => {
    if (notePath === currentFile) {
      if (targetLine) setAnchor({ line: targetLine });
      return;
    }
    openFileDestination({ path: notePath, ...(targetLine ? { line: String(targetLine) } : {}) });
  };
  const {
    commands: libraryCommands, syncVault, syncBusy, syncMessage, syncStatusVisible,
    openSyncStatus, closeSyncStatus, openSyncSettings,
  } = useFilePanelActions({ openFile: openNote, openSearch, root });
  const [history, setHistory] = useState<{ hash: string; date: string; author: string; message: string }[]>();

  const showFileHistory = async () => {
    if (!vault || !currentFile) return;
    try {
      setHistory(await Git.native<NonNullable<typeof history>>({
        action: 'fileHistory', dir: Git.nativeDir(vault.path), path: vaultRelativePath(vault.path, currentFile),
      }));
    } catch (error) {
      Alert.alert('File history', String(error));
    }
  };
  const chooseBanner = async () => {
    if (!vault || !currentFile || !flushFile()) return;
    if (hasInvalidProperties(content)) {
      Alert.alert('Set banner', 'Fix the invalid YAML frontmatter first.');
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const ext = asset.name.match(/\.(png|jpe?g|webp|gif|heic)$/i)?.[0];
      if (!ext) throw new Error('Choose a PNG, JPEG, WebP, GIF or HEIC image.');
      const relative = `_attachments/banners/banner-${Date.now()}${ext.toLowerCase()}`;
      const dir = new Directory(vaultFileUri(vault.path, '_attachments/banners'));
      if (!dir.exists) dir.create({ intermediates: true });
      new File(asset.uri).copy(new File(vaultFileUri(vault.path, relative)));
      setContent(setProperty(content, 'banner', relative));
      if (await saveFile()) updateWorkspace({ viewMode: 'preview' });
      else Alert.alert('Set banner', 'Could not save the note.');
    } catch (error) {
      Alert.alert('Set banner', String(error));
    }
  };
  const pluginCommands = usePluginCommands();
  const commands: EditorCommand[] = [
    ...pluginCommands,
    ...(vault ? [{ label: 'Install plugin from folder', run: () => {
      if (flushFile()) router.push({ pathname: '/plugins', params: { action: 'install' } });
    } }, { label: 'GitHub plugin sources', run: () => {
      if (flushFile()) router.push({ pathname: '/plugins', params: { action: 'sources' } });
    } }] : []),
    ...libraryCommands,
    ...(hasMarkdownNote ? [
      { label: 'Increase note font size', run: () => setNoteFontSize(settings.fontSize + 1) },
      { label: 'Decrease note font size', run: () => setNoteFontSize(settings.fontSize - 1) },
      ...(usesLiveEditor || liveReplacement === 'both' ? [] : [{ label: 'Edit with live preview', run: () => selectEditMode('live') }]),
      ...(!isEditing || usesLiveEditor ? [{
        label: 'Edit Markdown source', run: () => selectEditMode(liveReplacement === 'both' ? 'source' : 'edit'),
      }] : []),
    ] : []),
    ...(hasMarkdownNote && isEditing && !usesLiveEditor ? [
      { label: settings.wordWrap ? 'Turn off editor word wrap' : 'Turn on editor word wrap',
        run: () => updateSettings({ wordWrap: !settings.wordWrap }) },
    ] : []),
    { label: settings.hideReadingMetadata ? 'Show metadata in reading view' : 'Hide metadata in reading view',
      run: () => updateSettings({ hideReadingMetadata: !settings.hideReadingMetadata }) },
    ...(displayedPath && displayedPath === currentFile ? [
      { label: 'Set file icon', run: () => { setEditIconPath(displayedPath); setOverlay('files'); } },
      { label: 'Set banner from local image', run: () => void chooseBanner() },
      { label: 'Git: File history and changelog', run: () => void showFileHistory() },
    ] : []),
    { label: 'Browse files', run: openFiles },
    ...(vault ? [{
      label: settings.fileDrawerBreadcrumbs ? 'Use folder tree in file panel' : 'Use breadcrumbs in file panel',
      run: () => updateSettings({ fileDrawerBreadcrumbs: !settings.fileDrawerBreadcrumbs }),
    }, {
      label: 'File panel settings',
      run: () => { if (flushFile()) router.push({ pathname: '/settings', params: { section: 'vault' } }); },
    }] : []),
    { label: 'New note or folder', run: newEntry },
    ...(displayedPath && currentFile === displayedPath ? [{ label: 'Note details', run: openDetails }] : []),
    { label: 'Save note', run: handleSave },
    ...(hasMarkdownNote && canToggleViewMode ? [{
      label: liveReplacement === 'both' ? 'Switch to Live Preview' : isEditing ? 'Switch to reading mode' : 'Switch to editing mode',
      run: toggleViewMode,
    }] : []),
    { label: focusMode ? 'Exit focus mode' : 'Enter focus mode', run: () => setFocusMode(value => !value) },
    { label: isBookmarked ? 'Remove bookmark' : 'Bookmark note', run: handleBookmark },
    { label: 'Open graph', run: () => { if (flushFile()) router.push({ pathname: '/graph', params: { note: currentFile ?? undefined } }); } },
    { label: 'Open settings', run: () => { if (flushFile()) router.push('/settings'); } },
  ];

  const toolbarIconStyle = [styles.headerIcon, { tintColor: colors.textPrimary }];
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <View style={styles.container}>
      <View style={styles.container} importantForAccessibility={inlineLauncher ? 'no-hide-descendants' : 'auto'}>
      <Modal visible={history !== undefined} onRequestClose={() => setHistory(undefined)} animationType="slide">
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPrimary, padding: 16 }}>
          <TouchableOpacity accessibilityRole="button" onPress={() => setHistory(undefined)}>
            <Text style={{ color: colors.accent, paddingVertical: 12 }}>Close file history</Text>
          </TouchableOpacity>
          <FlatList data={history ?? []} keyExtractor={item => item.hash}
            ListEmptyComponent={<Text style={{ color: colors.textSecondary }}>No commits for this file.</Text>}
            renderItem={({ item }) => <View style={{ paddingVertical: 12 }}>
              <Text style={{ color: colors.textPrimary }}>{item.message}</Text>
              <Text style={{ color: colors.textSecondary }}>{item.author} · {item.date} · {item.hash.slice(0, 8)}</Text>
            </View>} />
        </SafeAreaView>
      </Modal>
      {/* Header */}
      {!focusMode && <View style={collapsibleHeader ? styles.headerOverlay : undefined}
        pointerEvents={collapsibleHeader && headerHidden ? 'none' : 'box-none'}
        accessibilityElementsHidden={collapsibleHeader && headerHidden}
        importantForAccessibility={collapsibleHeader && headerHidden ? 'no-hide-descendants' : 'auto'}>
        <GestureDetector gesture={headerGestures}>
        <Animated.View onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}
          style={[styles.header, { minHeight: metrics.toolbarHeight, backgroundColor: colors.bgSecondary, borderBottomColor: colors.border }, readingHeaderStyle]}>
        <TouchableOpacity
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={handleBack}
          activeOpacity={0.7}
        >
          <Image source={toolbarIcons.back} style={toolbarIconStyle} />
        </TouchableOpacity>

        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Browse files"
          style={styles.headerButton} onPress={openFiles}>
          <Image source={toolbarIcons.files} style={toolbarIconStyle} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerCenter} accessibilityRole="button" accessibilityLabel="Note actions"
          accessibilityState={{ expanded: menuVisible }} onPress={() => setMenuVisible(!menuVisible)}>
          <Text style={[styles.fileName, { color: colors.textPrimary }]} numberOfLines={1}>
            {fileName.replace(/\.(md|markdown)$/i, '')}
          </Text>
          {isDirty && <View accessibilityLabel="Unsaved changes" style={[styles.dirtyDot, { backgroundColor: colors.peach }]} />}
          <Ionicons name="chevron-down" size={13} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.headerActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Find files and contents"
            onPress={openSearch} onLongPress={openCommands} accessibilityHint="Hold for commands" style={styles.headerButton}>
            <Ionicons name="search" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          {displayedPath && !isBoard && canToggleViewMode && <TouchableOpacity
            style={[styles.modeButton, { borderRadius: metrics.controlRadius, backgroundColor: colors.accent + '18' }]}
            accessibilityRole="button"
            accessibilityLabel={liveReplacement === 'both' ? 'Switch to Live Preview' : isEditing ? 'Read note' : 'Write note'}
            onPress={toggleViewMode}
          >
            <Text style={{ color: colors.accent, fontWeight: '700' }}>
              {liveReplacement === 'both' ? 'Live' : isEditing ? 'Read' : 'Write'}
            </Text>
          </TouchableOpacity>}
        </View>
        </Animated.View>
        </GestureDetector>
      </View>}

      {/* More Menu */}
      {menuVisible && (
        <ScrollView style={[styles.menu, { top: headerHeight || metrics.toolbarHeight, backgroundColor: colors.bgSecondary, borderRadius: metrics.panelRadius }]} keyboardShouldPersistTaps="handled">
          {displayedPath && <>
            <TouchableOpacity style={styles.menuItem} onPress={openDetails}>
              <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Note details</Text>
            </TouchableOpacity>
            {isDirty && <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); void handleSave(); }}>
              <Ionicons name="save-outline" size={20} color={colors.accent} />
              <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Save note</Text>
            </TouchableOpacity>}
          </>}
          {vault?.gitRemote && <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuVisible(false); openSyncStatus(); }}>
            <Ionicons name="sync-outline" size={20} color={colors.accent} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Sync status</Text>
          </TouchableOpacity>}
          <TouchableOpacity style={styles.menuItem} onPress={openCommands}>
            <Ionicons name="terminal-outline" size={20} color={colors.accent} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Commands</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={handleBookmark}>
            <Ionicons
              name={isBookmarked ? 'bookmark' : 'bookmark-outline'}
              size={20}
              color={
                isBookmarked ? colors.yellow : colors.textPrimary
              }
            />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>
              {isBookmarked ? 'Remove Bookmark' : 'Bookmark'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={handleRename}>
            <Ionicons
              name="pencil-outline"
              size={20}
              color={colors.textPrimary}
            />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Rename</Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              router.push('/templates');
            }}
          >
            <Ionicons name="copy-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Templates</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              if (currentFile && vault) {
                router.push({
                  pathname: '/backlinks',
                  params: { filePath: currentFile, vaultPath: vault.path },
                });
              }
            }}
          >
            <Ionicons name="link-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Backlinks</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              if (currentFile) {
                router.push({
                  pathname: '/recovery',
                  params: { filePath: currentFile },
                });
              }
            }}
          >
            <Ionicons name="time-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>File Recovery</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              router.push('/frontmatter');
            }}
          >
            <Ionicons name="code-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Frontmatter</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              if (currentFile) {
                router.push({
                  pathname: '/publish',
                  params: { filePath: currentFile },
                });
              }
            }}
          >
            <Ionicons name="globe-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Publish as HTML</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              router.push('/slides');
            }}
          >
            <Ionicons name="easel-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Present as Slides</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => {
              setMenuVisible(false);
              router.push('/attachments');
            }}
          >
            <Ionicons name="attach-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Attachments</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={handleLint}>
            <Ionicons name="warning-outline" size={20} color={colors.textPrimary} />
            <Text style={[styles.menuItemText, { color: colors.textPrimary }]}>Lint</Text>
          </TouchableOpacity>
          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
          <TouchableOpacity style={styles.menuItem} onPress={handleDelete}>
            <Ionicons name="trash-outline" size={20} color={colors.red} />
            <Text style={[styles.menuItemText, { color: colors.red }]}>
              Delete
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Dismiss menu on tap */}
      {menuVisible && (
        <TouchableOpacity
          style={[styles.menuOverlay, { top: headerHeight || 56 }]}
          onPress={() => setMenuVisible(false)}
          activeOpacity={1}
        />
      )}

      {(openingLink || (loadingNote && showNoteSpinner)) && (
        <View accessibilityRole="progressbar" style={{ flexDirection: 'row', gap: 8, padding: 12 }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: colors.textSecondary }}>Opening note…</Text>
        </View>
      )}

      {/* Editor / Preview / Board */}
      <GestureDetector gesture={noteGestures}>
        <View style={styles.editorContainer}>
          {loadingNote ? null : !displayedPath ? (
            <Text style={{ color: colors.textSecondary, padding: 20 }}>Open a note from the file panel.</Text>
          ) : isBoard ? (
            <BoardView content={content} onChange={setContent} />
          ) : usesLiveEditor ? (
            <LiveMarkdownEditor
              key={displayedPath}
              content={content}
              anchor={anchor ?? undefined}
              onChange={setContent}
              fontSize={fontSize}
              pinchGesture={pinch}
              sideSwipe={bodySwipe}
              onPullDown={pullDownCommands}
              focusMode={focusMode}
              onToggleFocusMode={() => setFocusMode((f) => !f)}
              onLinkPress={handleLiveLink}
              onWikiLinkPress={openNoteLink}
              onToggleTask={handleLiveTask}
            />
          ) : isEditing ? (
            <MarkdownEditor
              notePath={displayedPath}
              content={content}
              onChange={setContent}
              fontSize={fontSize}
              wordWrap={settings.wordWrap}
              pinchGesture={pinch}
              sideSwipe={bodySwipe}
              onPullDown={pullDownCommands}
              lineSpacing={settings.lineHeight}
              spellCheck={settings.spellCheck}
              focusMode={focusMode}
              onToggleFocusMode={() => setFocusMode((f) => !f)}
            />
          ) : (
            <MarkdownPreview
              content={content}
              fontSize={fontSize}
              pinchGesture={pinch}
              sideSwipe={bodySwipe}
              vaultPath={vault?.path}
              notePath={displayedPath}
              showLocation
              headerInset={collapsibleHeader ? headerHeight : undefined}
              onScroll={collapsibleHeader ? readingScroll : undefined}
              onPullDown={pullDownCommands}
              hideReadingMetadata={settings.hideReadingMetadata}
              anchor={anchor ?? undefined}
              onWikiLinkPress={openNoteLink}
              onLinkPress={handleMarkdownLink}
            />
          )}
        </View>
      </GestureDetector>
      {!focusMode && <PluginStatusBar />}

      {/* Lint Modal */}
      <Modal
        visible={lintVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLintVisible(false)}
      >
        <View style={styles.lintOverlay}>
          <View style={[styles.lintSheet, { backgroundColor: colors.bgSecondary }]}>
            <View style={[styles.lintHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.lintTitle, { color: colors.textPrimary }]}>Lint</Text>
              <TouchableOpacity onPress={() => setLintVisible(false)} style={styles.lintClose}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.lintBody}>
              {lintWarnings.length === 0 ? (
                <View style={styles.lintEmpty}>
                  <Ionicons name="checkmark-circle" size={40} color={colors.green} />
                  <Text style={[styles.lintEmptyText, { color: colors.textSecondary }]}>No issues found</Text>
                </View>
              ) : (
                lintWarnings.map((w, i) => {
                  const iconColor = w.type === 'error' ? colors.red : w.type === 'warning' ? colors.yellow : colors.blue;
                  const iconName = w.type === 'error' ? 'close-circle-outline' : w.type === 'warning' ? 'warning-outline' : 'information-circle-outline';
                  return (
                    <View key={i} style={[styles.lintItem, { borderLeftColor: iconColor }]}>
                      <Ionicons name={iconName as any} size={16} color={iconColor} style={{ marginTop: 1 }} />
                      <View style={styles.lintItemBody}>
                        <Text style={[styles.lintMessage, { color: colors.textPrimary }]}>{w.message}</Text>
                        <Text style={[styles.lintMeta, { color: colors.textMuted }]}>
                          Line {w.line} · {w.rule}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Rename Modal */}
      <Modal
        visible={renameVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <View style={styles.renameOverlay}>
          <View style={[styles.renameDialog, { backgroundColor: colors.bgTertiary }]}>
            <Text style={[styles.renameTitle, { color: colors.textPrimary }]}>Rename File</Text>
            <TextInput
              style={[styles.renameInput, { backgroundColor: colors.bgPrimary, color: colors.textPrimary, borderColor: colors.border }]}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
              selectTextOnFocus
              placeholderTextColor={colors.textMuted}
            />
            <View style={styles.renameActions}>
              <TouchableOpacity
                style={styles.renameCancelBtn}
                onPress={() => setRenameVisible(false)}
              >
                <Text style={[styles.renameCancelText, { color: colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.renameConfirmBtn, { backgroundColor: colors.blue }]}
                onPress={confirmRename}
              >
                <Text style={[styles.renameConfirmText, { color: colors.bgPrimary }]}>Rename</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
      </View>
      {vault && overlay === 'files' && (
        <FileDrawer key={vault.id} vaultPath={vault.path} notePath={displayedPath || vault.path}
          editIconPath={editIconPath} vaultName={vault.name} fileCommands={libraryCommands} startCreating={startCreating}
          onVaultChange={() => { if (!root) router.dismissTo('/'); }} onRefresh={refreshFiles}
          onPullToRefresh={syncVault} navigateIntoFolders={settings.fileDrawerBreadcrumbs} opening={settings.fileDrawerOpening} syncMessage={syncMessage}
          onClose={closeOverlay} onOpenNote={openNote} />
      )}
      {vault && (overlay === 'commands' || overlay === 'search') && (
        <QuickLauncher key={vault.id} mode={overlay === 'search' ? 'files' : 'commands'}
          onModeChange={mode => setOverlay(mode === 'files' ? 'search' : 'commands')}
          commands={commands} vaultPath={vault.path} onClose={closeOverlay} onFileSelect={openNote}
          draft={isDirty && currentFile ? { path: currentFile, text: content } : undefined} />
      )}
      {overlay !== 'files' && !syncStatusVisible && <SyncToast message={syncMessage} />}
      {vault?.gitRemote && syncStatusVisible && (
        <SyncStatusSheet vaultPath={vault.path} busy={syncBusy} syncMessage={syncMessage} onSync={() => void syncVault()}
          onClose={closeSyncStatus} onSettings={openSyncSettings} />
      )}
      {vault && currentFile && detailsVisible && (
        <NoteDetails content={content} onClose={() => setDetailsVisible(false)} onJump={target => setAnchor({ line: target })}
          onEditProperties={() => { if (flushFile()) router.push('/frontmatter'); }}
          onOpenLinks={() => { if (flushFile()) router.push({ pathname: '/backlinks', params: { filePath: currentFile, vaultPath: vault.path } }); }}
          onOpenHistory={() => void showFileHistory()} />
      )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
    flexShrink: 1,
  },
  dirtyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerButton: {
    width: 40,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIcon: { width: 24, height: 24 },
  modeButton: { minHeight: 44, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  menu: {
    position: 'absolute',
    top: 56,
    right: 12,
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 180,
    maxHeight: '80%',
    zIndex: 100,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemText: {
    fontSize: 15,
  },
  menuDivider: {
    height: 1,
    marginHorizontal: 12,
  },
  menuOverlay: {
    ...StyleSheet.absoluteFill,
    top: 56,
    zIndex: 99,
  },
  editorContainer: {
    flex: 1,
  },
  // Rename modal
  renameOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  renameDialog: {
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
  },
  renameTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  renameInput: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    marginBottom: 20,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  renameCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  renameCancelText: {
    fontSize: 15,
  },
  renameConfirmBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  renameConfirmText: {
    fontSize: 15,
    fontWeight: '600',
  },
  lintOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  lintSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
  },
  lintHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  lintTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  lintClose: { padding: 4 },
  lintBody: { padding: 16, gap: 10, paddingBottom: 32 },
  lintEmpty: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  lintEmptyText: { fontSize: 15 },
  lintItem: {
    flexDirection: 'row',
    gap: 10,
    paddingLeft: 10,
    borderLeftWidth: 3,
    paddingVertical: 2,
  },
  lintItemBody: { flex: 1, gap: 2 },
  lintMessage: { fontSize: 14, lineHeight: 20 },
  lintMeta: { fontSize: 12 },
});
