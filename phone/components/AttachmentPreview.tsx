import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobilePluginBlock, usePluginRenderers } from '@/components/MobilePluginHost';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';

export default function AttachmentPreview({ path, kind }: { path: string; kind: 'image' | 'cad' }) {
  const router = useRouter();
  const { vault } = useApp();
  const { colors } = useTheme();
  const renderer = usePluginRenderers().cad;
  const [imageFailed, setImageFailed] = useState(false);
  const vaultPath = vault?.path;
  const prefix = vaultPath?.endsWith('/') ? vaultPath : vaultPath && vaultPath + '/';
  const relativePath = vaultPath && prefix && path.startsWith(prefix)
    ? vaultRelativePath(vaultPath, path)
    : null;
  const parts = relativePath?.split('/');
  const inVault = !!parts && parts.every(part => part && part !== '.' && part !== '..' && !/[\\\x00-\x1f\x7f]/.test(part));
  const name = parts?.at(-1) || (kind === 'image' ? 'Image' : 'CAD model');

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bgPrimary }]}>
      <View style={[styles.header, { backgroundColor: colors.bgSecondary, borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{name}</Text>
      </View>
      {!inVault || !vaultPath || !relativePath ? (
        <Text style={[styles.body, { color: colors.textSecondary }]}>This attachment is outside the active vault.</Text>
      ) : kind === 'image' ? (
        imageFailed ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>Could not display this image.</Text>
        ) : (
          <Image accessibilityLabel={name} style={styles.image}
            source={{ uri: vaultFileUri(vaultPath, relativePath) }} contentFit="contain"
            onError={() => setImageFailed(true)} />
        )
      ) : renderer ? (
        <MobilePluginBlock renderer={renderer} vaultPath={vaultPath}
          block={{ code: relativePath, language: 'cad', sourcePath: null, color: colors.bgPrimary, layout: 'viewport' }} />
      ) : (
        <Text style={[styles.body, { color: colors.textSecondary }]}>Install and enable CAD Viewer in Plugins to open this 3D model.</Text>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontWeight: '600', fontSize: 16, paddingRight: 12 },
  image: { flex: 1, width: '100%' },
  body: { padding: 12 },
});
