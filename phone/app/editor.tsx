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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Paths } from 'expo-file-system';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import MarkdownEditor from '@/components/MarkdownEditor';
import { Directory, File } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Git from '@/lib/provider-sync';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';
import { hasInvalidProperties, setProperty } from '@/lib/properties';
import CreateModal from '@/components/CreateModal';
import VaultSwitcher from '@/components/VaultSwitcher';
import { getOrCreateDailyNote } from '@/lib/daily-note';
import { getRandomNote } from '@/lib/random-note';
import SearchModal from '@/components/SearchModal';
import MarkdownPreview from '@/components/MarkdownPreview';
import BoardView from '@/components/BoardView';
import EditorOverlay, { type EditorCommand } from '@/components/EditorOverlay';
import { rename as renameFile, listAllMarkdownFiles } from '@/lib/file-system';
import { lintMarkdown, LintWarning } from '@/lib/markdown-lint';
import { isBoardContent, isBoardFile } from '@/lib/board-utils';
import { parseWikiLink, resolveWikiLink, warmWikiLinks } from '@/lib/wiki-links';

// The toolbar uses bundled Ionicons artwork with fixed layout bounds.
const toolbarIcons = {
  back: require('../assets/images/editor-toolbar/back.png'),
  files: require('../assets/images/editor-toolbar/files.png'),
  commands: require('../assets/images/editor-toolbar/commands.png'),
  edit: require('../assets/images/editor-toolbar/edit.png'),
  preview: require('../assets/images/editor-toolbar/preview.png'),
  more: require('../assets/images/editor-toolbar/more.png'),
};

function filePanelSwipe(enabled: boolean, openFiles: () => void) {
  return Gesture.Pan()
    .enabled(enabled)
    .hitSlop({ left: 0, width: 56 })
    .activeOffsetX(18)
    .failOffsetX(-8)
    .failOffsetY([-16, 16])
    .maxPointers(1)
    .runOnJS(true)
    .onEnd((event, success) => {
      if (success && event.translationX >= 48 && event.translationX > Math.abs(event.translationY) * 1.5) {
        openFiles();
      }
    });
}

export default function EditorRoute() {
  return <EditorScreen />;
}

export function EditorScreen({ root = false, homePath }: { root?: boolean; homePath?: string }) {
  const router = useRouter();
  const { path: routePath, heading } = useLocalSearchParams<{ path: string; heading?: string }>();
  const path = root ? homePath : routePath;
  const [anchor, setAnchor] = useState<{ heading: string } | null>(() => heading ? { heading } : null);
  const { colors } = useTheme();
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

  const [searchVisible, setSearchVisible] = useState(false);
  const [overlay, setOverlay] = useState<'files' | 'commands' | null>(root && !homePath ? 'files' : null);
  const [editIconPath, setEditIconPath] = useState<string>();
  const inlineCommands = overlay === 'commands' && Platform.OS === 'android';
  const [createDir, setCreateDir] = useState<string>();
  const [browseDir, setBrowseDir] = useState<string>();
  const [vaultSwitcherVisible, setVaultSwitcherVisible] = useState(false);
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
    if (!currentFile) return -1;
    return siblingNotes.findIndex((f) => f.path === currentFile);
  }, [siblingNotes, currentFile]);

  const navigateToNote = useCallback(async (notePath: string) => {
    if (!flushFile()) return;
    const target = { pathname: '/editor' as const, params: { path: notePath } };
    if (root) router.push(target);
    else router.replace(target);
  }, [flushFile, root, router]);

  const swipeBetweenNotes = Gesture.Pan()
    .activeOffsetX([-30, 30])
    .failOffsetY([-10, 10])
    .onEnd((e, success) => {
      if (!success || Math.abs(e.velocityX) < 300) return;
      if (e.translationX > 80 && currentIndex > 0) {
        navigateToNote(siblingNotes[currentIndex - 1].path);
      } else if (e.translationX < -80 && currentIndex < siblingNotes.length - 1) {
        navigateToNote(siblingNotes[currentIndex + 1].path);
      }
    })
    .runOnJS(true);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
    setEditIconPath(undefined);
  }, []);

  const handleBack = useCallback(() => {
    if (inlineCommands) {
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
    router.back();
  }, [closeOverlay, flushFile, inlineCommands, root, setCurrentFile, router]);

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

  const toggleViewMode = useCallback(() => {
    if (anchor) {
      setAnchor(null);
      updateWorkspace({ viewMode: 'edit' });
      return;
    }
    updateWorkspace({
      viewMode: workspace.viewMode === 'edit' ? 'preview' : 'edit',
    });
  }, [anchor, workspace.viewMode, updateWorkspace]);

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
      if (!flushFile()) return;
      router.push({ pathname: '/editor', params: { path: resolved, ...(targetHeading ? { heading: targetHeading } : {}) } });
    } catch {
      if (request === linkRequest.current) Alert.alert('Could not open note', name);
    } finally {
      clearTimeout(indicator);
      if (request === linkRequest.current) setOpeningLink(false);
    }
  }, [vault, currentFile, flushFile, router]);

  const handleMarkdownLink = useCallback((url: string) => {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//')) {
      void openNoteLink(url, true);
    }
  }, [openNoteLink]);

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

  const collapsibleHeader = !!displayedPath && !loadingNote && !focusMode && !isBoard &&
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

  const openOverlay = useCallback((mode: 'files' | 'commands') => {
    if (mode === 'files') Keyboard.dismiss();
    setMenuVisible(false);
    setOverlay(mode);
  }, []);
  const openCommands = useCallback(() => openOverlay('commands'), [openOverlay]);
  const openFiles = useCallback(() => openOverlay('files'), [openOverlay]);
  const canSwipeFiles = !!vault && !overlay && !searchVisible && !menuVisible && Platform.OS !== 'web';
  const noteGestures = Gesture.Exclusive(filePanelSwipe(canSwipeFiles, openFiles), swipeBetweenNotes);
  const pullHeader = Gesture.Pan()
    .enabled(!!vault && !overlay && !searchVisible)
    .activeOffsetY(18)
    .failOffsetX([-20, 20])
    .failOffsetY([-12, 10000])
    .onEnd(event => {
      if (event.translationY >= 52 && event.translationY > Math.abs(event.translationX) * 1.5) openCommands();
    })
    .runOnJS(true);
  const headerGestures = Gesture.Race(filePanelSwipe(canSwipeFiles, openFiles), pullHeader);
  const openNote = (notePath: string) => {
    if (notePath !== currentFile && flushFile()) {
      router.push({ pathname: '/editor', params: { path: notePath } });
    }
  };
  const openLibraryNote = async (kind: 'daily' | 'random') => {
    if (!vault || !flushFile()) return;
    const notePath = await (kind === 'daily' ? getOrCreateDailyNote(vault.path) : getRandomNote(vault.path));
    if (notePath) openNote(notePath);
  };
  const [gitBusy, setGitBusy] = useState(false);
  const [history, setHistory] = useState<{ hash: string; date: string; author: string; message: string }[]>();
  const syncVault = async () => {
    if (!vault?.gitRemote || gitBusy || !flushFile()) return;
    setGitBusy(true);
    try {
      const token = await Git.getVaultToken(vault.id);
      const result = await Git.sync(vault.path, token ?? '', vault.gitRemote, vault.gitBranch || undefined, vault.gitProvider);
      Alert.alert('Git sync', result.errors.join('\n') || (result.conflicts?.length
        ? 'Conflicts need attention in Git settings.'
        : `Pulled ${result.pulled}, pushed ${result.pushed}.`));
    } catch (error) {
      Alert.alert('Git sync', String(error));
    } finally {
      setGitBusy(false);
    }
  };
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
  const libraryCommands: EditorCommand[] = [
    ...(vault?.gitRemote && !gitBusy ? [{ label: 'Git: Sync now', run: () => void syncVault() }] : []),
    { label: 'Daily note', run: () => void openLibraryNote('daily') },
    { label: 'Calendar', run: () => { if (flushFile()) router.push('/calendar'); } },
    { label: 'Flashcards', run: () => { if (flushFile()) router.push('/flashcards'); } },
    { label: 'Vault graph', run: () => { if (flushFile()) router.push('/graph'); } },
    { label: 'Random note', run: () => void openLibraryNote('random') },
    { label: 'Quick open or search', run: () => setSearchVisible(true) },
    { label: 'Settings', run: () => { if (flushFile()) router.push('/settings'); } },
    ...(vault?.homeFile && !root ? [{ label: 'Start note', run: () => { if (flushFile()) router.dismissTo('/'); } }] : []),
  ];
  const pluginCommands = usePluginCommands();
  const commands: EditorCommand[] = [
    ...pluginCommands,
    ...(vault ? [{ label: 'Install plugin from folder', run: () => {
      if (flushFile()) router.push({ pathname: '/plugins', params: { action: 'install' } });
    } }, { label: 'GitHub plugin sources', run: () => {
      if (flushFile()) router.push({ pathname: '/plugins', params: { action: 'sources' } });
    } }] : []),
    ...libraryCommands,
    { label: settings.hideReadingMetadata ? 'Show metadata in reading view' : 'Hide metadata in reading view',
      run: () => updateSettings({ hideReadingMetadata: !settings.hideReadingMetadata }) },
    ...(displayedPath && displayedPath === currentFile ? [
      { label: 'Set file icon', run: () => { setEditIconPath(displayedPath); setOverlay('files'); } },
      { label: 'Set banner from local image', run: () => void chooseBanner() },
      { label: 'Git: File history and changelog', run: () => void showFileHistory() },
    ] : []),
    { label: 'Browse files', run: openFiles },
    { label: 'Save note', run: handleSave },
    { label: (workspace.viewMode === 'edit' && !anchor) ? 'Switch to reading mode' : 'Switch to editing mode', run: toggleViewMode },
    { label: focusMode ? 'Exit focus mode' : 'Enter focus mode', run: () => setFocusMode(value => !value) },
    { label: isBookmarked ? 'Remove bookmark' : 'Bookmark note', run: handleBookmark },
    { label: 'Open graph', run: () => { if (flushFile()) router.push({ pathname: '/graph', params: { note: currentFile ?? undefined } }); } },
    { label: 'Open settings', run: () => { if (flushFile()) router.push('/settings'); } },
  ];

  const toolbarIconStyle = [styles.headerIcon, { tintColor: colors.textPrimary }];
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <View style={styles.container}>
      <View style={styles.container} importantForAccessibility={inlineCommands ? 'no-hide-descendants' : 'auto'}>
      {vault && <>
        <SearchModal visible={searchVisible} vaultPath={vault.path}
          onClose={() => setSearchVisible(false)} onFileSelect={openNote}
          draft={isDirty && currentFile ? { path: currentFile, text: content } : undefined} />
        <VaultSwitcher visible={vaultSwitcherVisible} onClose={() => setVaultSwitcherVisible(false)} />
        <CreateModal visible={!!createDir} currentDir={createDir ?? vault.path}
          onClose={() => { setCreateDir(undefined); setOverlay('files'); }} onCreated={refreshFiles} />
      </>}
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
          style={[styles.header, { backgroundColor: colors.bgSecondary, borderBottomColor: colors.bgTertiary }, readingHeaderStyle]}>
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
        <View style={styles.headerCenter}>
          <Text style={[styles.fileName, { color: colors.textPrimary }]} numberOfLines={1}>
            {fileName}
          </Text>
          {isDirty && <View style={[styles.dirtyDot, { backgroundColor: colors.peach }]} />}
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Command palette"
            style={styles.headerButton} onPress={openCommands}>
            <Image source={toolbarIcons.commands} style={toolbarIconStyle} />
          </TouchableOpacity>
          {isDirty && (
            <TouchableOpacity
              style={[styles.saveButton, { backgroundColor: colors.blue }]}
              onPress={handleSave}
              activeOpacity={0.7}
            >
              <Text style={[styles.saveButtonText, { color: colors.bgPrimary }]}>Save</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel={workspace.viewMode === 'edit' && !anchor ? 'Read note' : 'Edit note'}
            onPress={toggleViewMode}
          >
            <Image source={workspace.viewMode === 'edit' && !anchor ? toolbarIcons.preview : toolbarIcons.edit}
              style={toolbarIconStyle} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="More actions"
            onPress={() => setMenuVisible(!menuVisible)}
          >
            <Image source={toolbarIcons.more} style={toolbarIconStyle} />
          </TouchableOpacity>
        </View>
        </Animated.View>
        </GestureDetector>
      </View>}

      {/* More Menu */}
      {menuVisible && (
        <View style={[styles.menu, { top: headerHeight || 56, backgroundColor: colors.bgTertiary }]}>
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
        </View>
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
          ) : workspace.viewMode === 'edit' && !anchor ? (
            <MarkdownEditor
              notePath={displayedPath}
              content={content}
              onChange={setContent}
              fontSize={settings.fontSize}
              focusMode={focusMode}
              onToggleFocusMode={() => setFocusMode((f) => !f)}
            />
          ) : (
            <MarkdownPreview
              content={content}
              fontSize={settings.fontSize}
              vaultPath={vault?.path}
              notePath={displayedPath}
              headerInset={collapsibleHeader ? headerHeight : undefined}
              onScroll={collapsibleHeader ? readingScroll : undefined}
              onPullDown={vault && Platform.OS !== 'web' ? openCommands : undefined}
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
      {overlay && vault && (
        <EditorOverlay key={overlay} mode={overlay} vaultPath={vault.path} notePath={displayedPath || vault.path}
          editIconPath={editIconPath} initialFolder={browseDir} vaultName={vault.name} commands={commands} fileCommands={libraryCommands}
          onSwitchVault={() => { if (flushFile()) setVaultSwitcherVisible(true); }}
          onCreate={folder => { setBrowseDir(folder); setCreateDir(folder); }} onRefresh={refreshFiles}
          onClose={closeOverlay} onOpenNote={openNote} />
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
  saveButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 4,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  menu: {
    position: 'absolute',
    top: 56,
    right: 12,
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 180,
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
