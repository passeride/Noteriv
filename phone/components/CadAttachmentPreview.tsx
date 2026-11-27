import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MobilePluginBlock, usePluginRenderers } from '@/components/MobilePluginHost';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { vaultRelativePath } from '@/lib/sync-state';

export default function CadAttachmentPreview({ path }: { path: string }) {
  const router = useRouter();
  const { vault } = useApp();
  const { colors } = useTheme();
  const renderer = usePluginRenderers().cad;
  const vaultPath = vault?.path;
  const prefix = vaultPath?.endsWith('/') ? vaultPath : vaultPath && vaultPath + '/';
  const model = vaultPath && prefix && path.startsWith(prefix)
    ? vaultRelativePath(vaultPath, path)
    : null;
  const name = model?.split('/').at(-1) ?? 'CAD model';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bgPrimary }]}>
      <View style={[styles.header, { backgroundColor: colors.bgSecondary, borderBottomColor: colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.back}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{name}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {renderer && vaultPath && model ? (
          <MobilePluginBlock renderer={renderer} vaultPath={vaultPath}
            block={{ code: model, language: 'cad', sourcePath: null, color: colors.bgPrimary }} />
        ) : (
          <Text style={{ color: colors.textSecondary }}>
            {model ? 'Install and enable CAD Viewer in Plugins to open this 3D model.' : 'This model is outside the active vault.'}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 48, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontWeight: '600', fontSize: 16, paddingRight: 12 },
  body: { padding: 12 },
});
