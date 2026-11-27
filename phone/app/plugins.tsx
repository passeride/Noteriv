import { useLocalSearchParams } from 'expo-router';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import {
  PluginManifest,
  type CatalogPlugin,
  type PluginSource,
  COMMUNITY_SOURCE,
  fetchPluginCatalog,
  isCatalogUpdate,
  loadPluginSources,
  parsePluginSource,
  savePluginSources,
  sourceKey,
  getInstalledPlugins,
  getEnabledPluginIds,
  setPluginEnabled,
  uninstallPlugin,
  installCommunityPlugin,
  installLocalPlugin,
} from '@/lib/plugins';

type Tab = 'installed' | 'community';

interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
}

export default function PluginsScreen() {
  const { vault } = useApp();
  const { colors } = useTheme();

  const { action } = useLocalSearchParams<{ action?: string }>();
  const [activeTab, setActiveTab] = useState<Tab>(action === 'sources' ? 'community' : 'installed');
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [communityPlugins, setCommunityPlugins] = useState<CatalogPlugin[]>([]);
  const [loadingCommunity, setLoadingCommunity] = useState(false);
  const [updateEntries, setUpdateEntries] = useState<CatalogPlugin[]>([]);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatesUnavailable, setUpdatesUnavailable] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [sources, setSources] = useState<PluginSource[] | null>(null);
  const [source, setSource] = useState<PluginSource>(COMMUNITY_SOURCE);
  const [repository, setRepository] = useState('');
  const [branch, setBranch] = useState('main');
  const [sourceError, setSourceError] = useState('');
  const [reload, setReload] = useState(0);
  const sourceOptions = [COMMUNITY_SOURCE, ...(sources ?? [])];
  const officialSelected = sourceKey(source) === sourceKey(COMMUNITY_SOURCE);

  const vaultPath = vault?.path ?? '';

  const refreshPlugins = useCallback(async () => {
    if (!vaultPath) return;
    const [manifests, enabledIds] = await Promise.all([
      getInstalledPlugins(vaultPath),
      getEnabledPluginIds(vaultPath),
    ]);
    setPlugins(
      manifests.map((m) => ({
        manifest: m,
        enabled: enabledIds.includes(m.id),
      }))
    );
  }, [vaultPath]);

  useEffect(() => {
    refreshPlugins();
  }, [refreshPlugins]);

  useEffect(() => {
    if (!vaultPath) return;
    let active = true;
    setSources(null);
    setSource(COMMUNITY_SOURCE);
    loadPluginSources(vaultPath).then(
      value => { if (active) setSources(value); },
      error => { if (active) setSourceError(String(error)); },
    );
    return () => { active = false; };
  }, [vaultPath]);

  useEffect(() => {
    if (!vaultPath || activeTab !== 'community') return;
    const abort = new AbortController();
    setLoadingCommunity(true);
    setCatalogError('');
    fetchPluginCatalog(source, abort.signal).then(
      entries => { if (!abort.signal.aborted) setCommunityPlugins(entries); },
      error => { if (!abort.signal.aborted) setCatalogError(String(error)); },
    ).finally(() => { if (!abort.signal.aborted) setLoadingCommunity(false); });
    return () => abort.abort();
  }, [activeTab, source, reload, vaultPath]);

  useEffect(() => {
    if (!vaultPath || activeTab !== 'installed' || !sources || !plugins.length) return;
    const abort = new AbortController();
    setCheckingUpdates(true);
    setUpdatesUnavailable(false);
    setUpdateEntries([]);
    void Promise.allSettled([COMMUNITY_SOURCE, ...sources].map(item => fetchPluginCatalog(item, abort.signal)))
      .then(results => {
        if (abort.signal.aborted) return;
        setUpdatesUnavailable(results.some(result => result.status === 'rejected'));
        setUpdateEntries(results.flatMap(result => result.status === 'fulfilled' ? result.value : []));
        setCheckingUpdates(false);
      });
    return () => abort.abort();
  }, [activeTab, sources, vaultPath, plugins.length, reload]);

  useEffect(() => {
    if (action === 'sources') setActiveTab('community');
  }, [action]);

  function selectSource(next: PluginSource) {
    setCommunityPlugins([]);
    if (sourceKey(next) === sourceKey(source)) setReload(count => count + 1);
    setSource(next);
  }

  function editSources(remove = false) {
    if (!sources || !vaultPath) return;
    setSourceError('');
    try {
      const next = remove ? COMMUNITY_SOURCE : parsePluginSource(repository, branch);
      const duplicate = sourceOptions.some(item => sourceKey(item) === sourceKey(next));
      if (remove || !duplicate) {
        const updated = remove ? sources.filter(item => sourceKey(item) !== sourceKey(source)) : [...sources, next];
        savePluginSources(vaultPath, updated);
        setSources(updated);
      }
      if (!remove) setRepository('');
      selectSource(next);
    } catch (error) {
      setSourceError(String(error));
    }
  }

  const handleToggle = useCallback(
    async (plugin: InstalledPlugin) => {
      if (!vaultPath) return;
      const newEnabled = !plugin.enabled;
      await setPluginEnabled(vaultPath, plugin.manifest.id, newEnabled);
      setPlugins((prev) =>
        prev.map((p) =>
          p.manifest.id === plugin.manifest.id ? { ...p, enabled: newEnabled } : p
        )
      );
    },
    [vaultPath]
  );

  const handleUninstall = useCallback(
    (plugin: InstalledPlugin) => {
      Alert.alert(
        'Uninstall Plugin',
        `Uninstall "${plugin.manifest.name}"? This will remove all plugin files.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Uninstall',
            style: 'destructive',
            onPress: () => {
              uninstallPlugin(vaultPath, plugin.manifest.id);
              setPlugins((prev) =>
                prev.filter((p) => p.manifest.id !== plugin.manifest.id)
              );
            },
          },
        ]
      );
    },
    [vaultPath]
  );

  const handleInstallCommunity = useCallback(
    async (entry: CatalogPlugin, update = false) => {
      if (!vaultPath || installingId) return;
      setInstallingId(entry.id);
      try {
        await installCommunityPlugin(vaultPath, entry, update);
        await refreshPlugins();
      } catch (error) {
        Alert.alert(update ? 'Unable to update plugin' : 'Unable to install plugin', String(error));
      } finally {
        setInstallingId(null);
      }
    },
    [vaultPath, refreshPlugins, installingId]
  );

  const requestedInstall = useRef(false);
  const importPlugin = useCallback(async () => {
    if (!vaultPath) return;
    try {
      await installLocalPlugin(vaultPath);
      await refreshPlugins();
      setActiveTab('installed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/cancel/i.test(message)) Alert.alert('Unable to import plugin', message);
    }
  }, [vaultPath, refreshPlugins]);

  useEffect(() => {
    if (action !== 'install' || !vaultPath || requestedInstall.current) return;
    requestedInstall.current = true;
    void importPlugin();
  }, [action, vaultPath, importPlugin]);

  const installedManifests = new Map(plugins.map(plugin => [plugin.manifest.id.toLowerCase(), plugin.manifest]));
  const availableUpdates = new Map(plugins.map(({ manifest }) => {
    const matches = updateEntries.filter(entry => isCatalogUpdate(manifest, entry));
    return [manifest.id, matches.length === 1 ? matches[0] : undefined] as const;
  }));

  return (
    <View style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: colors.bgSecondary, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'installed' && { borderBottomColor: colors.accent, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('installed')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'installed' ? colors.accent : colors.textMuted }]}>
            Installed
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'community' && { borderBottomColor: colors.accent, borderBottomWidth: 2 }]}
          onPress={() => setActiveTab('community')}
        >
          <Text style={[styles.tabText, { color: activeTab === 'community' ? colors.accent : colors.textMuted }]}>
            Community
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'installed' ? (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          <TouchableOpacity accessibilityRole="button" onPress={() => void importPlugin()} disabled={installingId !== null}
            style={{ paddingVertical: 14 }}>
            <Text style={{ color: colors.accent }}>Install plugin from folder</Text>
          </TouchableOpacity>
          {plugins.length > 0 && (
            <TouchableOpacity accessibilityRole="button" onPress={() => setReload(count => count + 1)}
              disabled={checkingUpdates || installingId !== null} style={{ paddingVertical: 8 }}>
              <Text style={{ color: colors.accent }}>{checkingUpdates ? 'Checking for updates…' : 'Check for updates'}</Text>
            </TouchableOpacity>
          )}
          {updatesUnavailable && <Text style={{ color: colors.textSecondary }}>Some plugin sources could not be checked.</Text>}
          {plugins.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="extension-puzzle-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                No plugins installed
              </Text>
              <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
                Browse the community tab to find plugins
              </Text>
            </View>
          ) : (
            plugins.map((plugin) => {
              const update = availableUpdates.get(plugin.manifest.id);
              return (
                <TouchableOpacity
                  key={plugin.manifest.id}
                  style={[styles.pluginCard, { backgroundColor: colors.bgTertiary, borderColor: colors.border }]}
                  onLongPress={installingId === null ? () => handleUninstall(plugin) : undefined}
                  activeOpacity={0.7}
                >
                  <View style={styles.pluginCardBody}>
                    <View style={styles.pluginNameRow}>
                      <Text style={[styles.pluginName, { color: colors.textPrimary }]}>
                        {plugin.manifest.name}
                      </Text>
                      <Text style={[styles.pluginVersion, { color: colors.textMuted }]}>
                        v{plugin.manifest.version}
                      </Text>
                    </View>
                    <Text style={[styles.pluginAuthor, { color: colors.textMuted }]}>
                      by {plugin.manifest.author}
                    </Text>
                    <Text style={[styles.pluginDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                      {plugin.manifest.description}
                    </Text>
                  </View>
                  <View style={styles.pluginActions}>
                    {update && (
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Update ${plugin.manifest.name}`}
                        style={[styles.installButton, { backgroundColor: colors.accent }]}
                        onPress={() => void handleInstallCommunity(update, true)} disabled={installingId !== null}>
                        <Text style={[styles.installButtonText, { color: colors.bgPrimary }]}>
                          {installingId === update.id ? 'Updating…' : 'Update'}
                        </Text>
                      </TouchableOpacity>
                    )}
                    <Switch
                      value={plugin.enabled}
                      disabled={installingId !== null}
                      onValueChange={() => handleToggle(plugin)}
                      trackColor={{ false: colors.border, true: colors.accent }}
                      thumbColor={colors.textPrimary}
                    />
                  </View>
                </TouchableOpacity>
              );
            })
          )}

          {plugins.length > 0 && (
            <Text style={[styles.hintText, { color: colors.textMuted }]}>
              Long press a plugin to uninstall
            </Text>
          )}
        </ScrollView>
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.sourceSection}>
            <Text style={[styles.pluginName, { color: colors.textPrimary }]}>GitHub plugin sources</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sourceOptions}>
              {sourceOptions.map(item => {
                const selected = sourceKey(item) === sourceKey(source);
                return (
                  <TouchableOpacity key={sourceKey(item)} accessibilityRole="button"
                    accessibilityState={{ selected }} onPress={() => selectSource(item)}
                    style={[styles.sourceChip, { backgroundColor: selected ? colors.accent : colors.bgTertiary }]}>
                    <Text style={{ color: selected ? colors.bgPrimary : colors.textPrimary }}>
                      {item === COMMUNITY_SOURCE ? 'Noteriv Community' : item.repository + ' · ' + item.branch}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TextInput style={[styles.sourceInput, { color: colors.textPrimary, borderColor: colors.border }]}
              accessibilityLabel="GitHub repository" placeholder="owner/repo" placeholderTextColor={colors.textMuted}
              autoCapitalize="none" autoCorrect={false} value={repository} onChangeText={setRepository} />
            <TextInput style={[styles.sourceInput, { color: colors.textPrimary, borderColor: colors.border }]}
              accessibilityLabel="GitHub branch" placeholder="Branch" placeholderTextColor={colors.textMuted}
              autoCapitalize="none" autoCorrect={false} value={branch} onChangeText={setBranch} />
            <View style={styles.sourceOptions}>
              <TouchableOpacity accessibilityRole="button"
                disabled={!sources || !repository.trim() || !branch.trim()} onPress={() => editSources()}>
                <Text style={{ color: sources && repository.trim() && branch.trim() ? colors.accent : colors.textMuted }}>
                  Add source
                </Text>
              </TouchableOpacity>
              {!officialSelected && (
                <TouchableOpacity accessibilityRole="button" onPress={() => editSources(true)}>
                  <Text style={{ color: colors.accent }}>Remove source</Text>
                </TouchableOpacity>
              )}
            </View>
            {!!sourceError && <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>{sourceError}</Text>}
          </View>
          {loadingCommunity ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={[styles.loadingText, { color: colors.textMuted }]}>
                Fetching community plugins...
              </Text>
            </View>
          ) : catalogError ? (
            <View style={styles.emptyState}>
              <Text accessibilityRole="alert" style={{ color: colors.textPrimary }}>{catalogError}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={() => setReload(value => value + 1)}>
                <Text style={{ color: colors.accent }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : communityPlugins.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="cloud-offline-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                No community plugins available
              </Text>

            </View>
          ) : (
            communityPlugins.map((entry) => {
              const installed = installedManifests.get(entry.id.toLowerCase());
              const canUpdate = installed !== undefined && isCatalogUpdate(installed, entry);
              const isDisabled = !!installed && !canUpdate;
              const isInstalling = installingId === entry.id;

              return (
                <View
                  key={entry.id}
                  style={[styles.communityCard, { backgroundColor: colors.bgTertiary, borderColor: colors.border }]}
                >
                  <View style={styles.communityCardBody}>
                    <View style={styles.pluginNameRow}>
                      <Text style={[styles.communityName, { color: colors.textPrimary }]}>
                        {entry.name}
                      </Text>
                      <Text style={[styles.pluginVersion, { color: colors.textMuted }]}>
                        v{entry.version}
                      </Text>
                    </View>
                    <Text style={[styles.pluginAuthor, { color: colors.textMuted }]}>
                      by {entry.author}
                    </Text>
                    <Text style={[styles.communityDescription, { color: colors.textSecondary }]} numberOfLines={2}>
                      {entry.description}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.installButton,
                      { backgroundColor: isDisabled ? colors.bgSecondary : colors.accent },
                      isInstalling && { opacity: 0.6 },
                    ]}
                    onPress={() => void handleInstallCommunity(entry, canUpdate)}
                    disabled={isDisabled || installingId !== null}
                  >
                    {isInstalling ? (
                      <ActivityIndicator size="small" color={colors.bgPrimary} />
                    ) : (
                      <Text
                        style={[
                          styles.installButtonText,
                          { color: isDisabled ? colors.textMuted : colors.bgPrimary },
                        ]}
                      >
                        {canUpdate ? 'Update' : installed ? 'Installed' : 'Install'}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },

  sourceSection: { gap: 10, marginBottom: 18 },
  sourceOptions: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  sourceChip: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  sourceInput: { borderWidth: 1, borderRadius: 8, padding: 10 },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtext: {
    fontSize: 14,
  },

  // Loading
  loadingState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
  },

  // Plugin card
  pluginCard: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  pluginCardBody: {
    flex: 1,
    marginRight: 12,
  },
  pluginNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pluginName: {
    fontSize: 15,
    fontWeight: '600',
  },
  pluginVersion: {
    fontSize: 12,
  },
  pluginAuthor: {
    fontSize: 12,
    marginTop: 2,
  },
  pluginDescription: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  pluginActions: {
    gap: 8,
    alignItems: 'center',
  },

  // Hint text
  hintText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },

  // Community card
  communityCard: {
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  communityCardBody: {
    flex: 1,
    marginRight: 12,
  },
  communityName: {
    fontSize: 15,
    fontWeight: '600',
  },
  communityDescription: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },

  // Install button
  installButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  installButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
