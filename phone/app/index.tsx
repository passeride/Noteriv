import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import VaultSwitcher from '@/components/VaultSwitcher';
import { fileExists } from '@/lib/file-system';
import { EditorScreen } from './editor';
import { vaultFileUri } from '@/lib/sync-state';

export default function HomeScreen() {
  const { colors } = useTheme();
  const { vault, setupComplete, isLoading } = useApp();
  const [vaultSwitcherVisible, setVaultSwitcherVisible] = useState(false);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.loading, { backgroundColor: colors.bgPrimary }]}>
        <ActivityIndicator size="large" color={colors.blue} />
      </SafeAreaView>
    );
  }

  if (!setupComplete) {
    return <Redirect href="/setup" />;
  }

  if (!vault) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
        <View style={styles.empty}>
          <Ionicons name="folder-open-outline" size={64} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>No Vault Selected</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Create a vault to start taking notes
          </Text>
          <TouchableOpacity
            style={[styles.emptyButton, { backgroundColor: colors.blue }]}
            onPress={() => setVaultSwitcherVisible(true)}
          >
            <Ionicons name="add" size={20} color={colors.bgPrimary} />
            <Text style={[styles.emptyButtonText, { color: colors.bgPrimary }]}>Create a Vault</Text>
          </TouchableOpacity>
        </View>
        <VaultSwitcher
          visible={vaultSwitcherVisible}
          onClose={() => setVaultSwitcherVisible(false)}
        />
      </SafeAreaView>
    );
  }

  const candidate = vault.homeFile ? vaultFileUri(vault.path, vault.homeFile) : undefined;
  return <EditorScreen key={vault.id} root homePath={candidate && fileExists(candidate) ? candidate : undefined} />;

}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '600',
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 15,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 24,
  },
  emptyButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
