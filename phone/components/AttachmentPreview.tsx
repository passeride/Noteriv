import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { startActivityAsync } from 'expo-intent-launcher';
import { useRouter } from 'expo-router';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FileDrawer from '@/components/FileDrawer';
import { AudioPreview, VideoPreview } from '@/components/MediaPreview';
import { MobilePluginBlock, usePluginRenderers } from '@/components/MobilePluginHost';
import PdfPreview from '@/components/PdfPreview';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import type { FilePreviewKind } from '@/lib/file-preview';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';

export default function AttachmentPreview({ path, kind }: { path: string; kind: FilePreviewKind }) {
  const router = useRouter();
  const { vault, settings, refreshFiles, syncCurrentVault } = useApp();
  const { colors } = useTheme();
  const renderer = usePluginRenderers().cad;
  const [failed, setFailed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  const vaultPath = vault?.path;
  const prefix = vaultPath?.endsWith('/') ? vaultPath : vaultPath && vaultPath + '/';
  const relativePath = vaultPath && prefix && path.startsWith(prefix) ? vaultRelativePath(vaultPath, path) : null;
  const parts = relativePath?.split('/');
  const inVault = !!parts && parts.every(part => part && part !== '.' && part !== '..' && !/[\\\x00-\x1f\x7f]/.test(part));
  const uri = inVault && vaultPath && relativePath ? vaultFileUri(vaultPath, relativePath) : null;
  const name = parts?.at(-1) || 'Attachment';

  async function openExternally() {
    if (!uri) return;
    try {
      const mimeType = new File(uri).type || undefined;
      if (Platform.OS === 'android') {
        // Grant the receiving app read access to this one vault file.
        try {
          const data = await getContentUriAsync(uri);
          await startActivityAsync('android.intent.action.VIEW', { data, type: mimeType ?? 'application/octet-stream', flags: 1 });
          return;
        } catch {
          // Offer the system share sheet if no app handles the MIME type.
        }
      }
      if (!await isAvailableAsync()) throw new Error('Unavailable');
      await shareAsync(uri, { mimeType, dialogTitle: 'Open with' });
    } catch {
      Alert.alert('Could not open this attachment', 'An app that supports this file type may be needed.');
    }
  }

  const message = (text: string) => <Text style={[styles.body, { color: colors.textSecondary }]}>{text}</Text>;
  let preview;
  if (!uri || !vaultPath || !relativePath) {
    preview = message('This attachment is outside the active vault.');
  } else if (failed) {
    preview = message('Could not preview this file. Try Open with.');
  } else {
    switch (kind) {
      case 'image':
        preview = <Image accessibilityLabel={name} style={styles.image}
          source={{ uri }} contentFit="contain" autoplay onError={onError} />;
        break;
      case 'pdf':
        preview = <PdfPreview uri={uri} onError={onError} />;
        break;
      case 'audio':
        preview = <AudioPreview uri={uri} onError={onError} />;
        break;
      case 'video':
        preview = <VideoPreview uri={uri} onError={onError} />;
        break;
      case 'cad':
        preview = renderer ? (
          <MobilePluginBlock renderer={renderer} vaultPath={vaultPath}
            block={{ code: relativePath, language: 'cad', sourcePath: null, color: colors.bgPrimary, layout: 'viewport' }} />
        ) : message('Install and enable CAD Viewer in Plugins to open this 3D model.');
        break;
      case 'external':
        preview = message('Use Open with to open this attachment in another app.');
        break;
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bgPrimary }]}>
      <View style={[styles.header, { backgroundColor: colors.bgSecondary, borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.iconButton}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </Pressable>
        {vault && <Pressable accessibilityRole="button" accessibilityLabel="Browse files" style={styles.iconButton}
          onPress={() => setDrawerOpen(true)}>
          <Ionicons name="folder-outline" size={21} color={colors.textPrimary} />
        </Pressable>}
        <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{name}</Text>
        {uri && <Pressable accessibilityRole="button" accessibilityLabel="Open with" style={styles.iconButton}
          onPress={() => void openExternally()}>
          <Ionicons name="open-outline" size={22} color={colors.textPrimary} />
        </Pressable>}
      </View>
      {preview}
      {vault && drawerOpen && <FileDrawer vaultPath={vault.path} vaultName={vault.name} notePath={path}
        fileCommands={[]} onVaultChange={() => router.dismissTo('/')} onRefresh={refreshFiles}
        onPullToRefresh={async () => { await syncCurrentVault(); }} navigateIntoFolders={settings.fileDrawerBreadcrumbs}
        opening={settings.fileDrawerOpening} onClose={() => setDrawerOpen(false)}
        onOpenNote={next => { if (next !== path) router.replace({ pathname: '/editor', params: { path: next } }); }} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontWeight: '600', fontSize: 16, paddingRight: 12 },
  image: { flex: 1, width: '100%' },
  body: { padding: 16 },
});
