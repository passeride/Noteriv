import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { getPathActivity, hasGitHistory } from '@/lib/git-history';
import { vaultRelativePath } from '@/lib/sync-state';
import { activityFolder, activityTimeline } from '../../packages/git-client/path-history';

export default function GitHistoryBlock({ source, vaultPath, notePath }: {
  source: string; vaultPath: string; notePath?: string;
}) {
  const { colors } = useTheme();
  const { files } = useApp();
  const [state, setState] = useState<{ timeline?: ReturnType<typeof activityTimeline>; message?: string }>({});
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        if (!hasGitHistory(vaultPath)) {
          setState({ message: 'Git history is available in Git vaults.' });
          return;
        }
        const folder = activityFolder(source, notePath ? vaultRelativePath(vaultPath, notePath) : null);
        const entries = await getPathActivity(vaultPath, folder);
        if (active) setState({ timeline: activityTimeline(entries) });
      } catch (error) {
        if (active) setState({ message: String(error) });
      }
    }
    void load();
    return () => { active = false; };
  // A Git sync refreshes the vault listing even when this note's text is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, vaultPath, notePath, files]);
  const timeline = state.timeline;
  return (
    <View style={{ padding: 12, borderRadius: 8, gap: 8, backgroundColor: colors.bgTertiary }}>
      <Text accessibilityRole="header" style={{ color: colors.textPrimary, fontWeight: '600' }}>Git activity</Text>
      {timeline ? <>
        <Text style={{ color: colors.textSecondary }}>{timeline.first} – {timeline.last} · {timeline.total} commits</Text>
        <ScrollView horizontal contentContainerStyle={{ alignItems: 'flex-end', gap: 2 }}>
          {timeline.buckets.map(({ label, count }) => <View
            key={label} accessible accessibilityLabel={`${label}, ${count} commits`}
            style={{ width: 9, height: Math.max(3, Math.round(36 * count / timeline.peak)),
              borderRadius: 2, backgroundColor: count ? colors.accent : colors.border }} />)}
        </ScrollView>
      </> : <Text style={{ color: colors.textSecondary }}>
        {state.message ?? (timeline === null ? 'No commits in this folder.' : 'Loading Git activity…')}
      </Text>}
    </View>
  );
}
