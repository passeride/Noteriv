import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useRoute, type RouteProp } from 'expo-router/react-navigation';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { resolveOpenLink, type OpenLinkParams } from '@/lib/open-link';

const first = (value?: string | string[]) => Array.isArray(value) ? value[0] : value;
type OpenRouteParams = { [Key in keyof OpenLinkParams]: string | string[] };

export default function OpenNoteLink() {
  const router = useRouter();
  const { colors } = useTheme();
  const { params } = useRoute<RouteProp<{ open: OpenRouteParams | undefined }, 'open'>>();
  const vaultName = first(params?.vault);
  const repo = first(params?.repo);
  const file = first(params?.file);
  const heading = first(params?.heading);
  const line = first(params?.line);
  const fragment = first(params?.['#']);
  const app = useApp();
  const { isLoading, setupComplete } = app;
  const latestApp = useRef(app);
  latestApp.current = app;
  const pending = useRef(Promise.resolve());
  const [error, setError] = useState<string>();

  useFocusEffect(useCallback(() => {
    if (isLoading) return;
    if (!setupComplete) {
      router.replace('/setup');
      return;
    }
    let canceled = false;
    setError(undefined);

    pending.current = pending.current.then(async () => {
      if (canceled) return;
      const { vaults, vault } = latestApp.current;
      const target = await resolveOpenLink(
        { vault: vaultName, repo, file, heading, line, '#': fragment }, vaults, vault
      );
      if (canceled) return;
      const { vault: active, flushFile, switchVault } = latestApp.current;
      if (!flushFile()) throw new Error('The current note could not be saved.');
      if (active?.id !== target.vault.id && !await switchVault(target.vault.id)) {
        throw new Error('The vault in this link could not be opened.');
      }
      if (canceled) return;

      if (!target.path) {
        router.dismissTo('/');
        return;
      }
      router.replace({
        pathname: '/editor',
        params: { path: target.path, heading: target.heading, line: target.line },
      });
    }).catch((error: unknown) => {
      if (!canceled) setError(error instanceof Error ? error.message : 'The note could not be opened.');
    });

    return () => { canceled = true; };
  }, [isLoading, setupComplete, router, vaultName, repo, file, heading, line, fragment]));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      {error ? (
        <>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Could not open link</Text>
          <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.canGoBack() ? router.back() : router.replace('/')}>
            <Text style={[styles.back, { color: colors.accent }]}>Back to Noteriv</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator accessibilityLabel="Opening note link" color={colors.accent} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 20, fontWeight: '600' },
  back: { padding: 12, fontWeight: '600' },
});
