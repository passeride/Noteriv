import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { getFileHistory } from '@/lib/git-history';
import type { GitCommit } from '../../packages/git-client/path-history';

export default function GitFileHistory({ vaultPath, filePath, onClose }: {
  vaultPath: string; filePath: string; onClose: () => void;
}) {
  const { colors } = useTheme();
  const [state, setState] = useState<{ entries?: GitCommit[]; error?: string }>({});
  useEffect(() => {
    let active = true;
    void getFileHistory(vaultPath, filePath).then(entries => {
      if (active) setState({ entries });
    }).catch(error => {
      if (active) setState({ error: String(error) });
    });
    return () => { active = false; };
  }, [vaultPath, filePath]);

  return (
    <Modal visible onRequestClose={onClose} animationType="slide">
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPrimary, paddingHorizontal: 16 }}>
        <Pressable accessibilityRole="button" onPress={onClose} style={{ paddingVertical: 12 }}>
          <Text style={{ color: colors.accent }}>Close Git history</Text>
        </Pressable>
        <Text accessibilityRole="header" style={{ color: colors.textPrimary, fontSize: 20 }}>Git file history</Text>
        <FlatList data={state.entries ?? []} keyExtractor={entry => entry.hash}
          ListEmptyComponent={<Text style={{ color: colors.textSecondary, paddingVertical: 12 }}>
            {state.error ?? (state.entries ? 'No commits for this file.' : 'Loading commits…')}
          </Text>}
          renderItem={({ item }) => <View style={{ paddingVertical: 12 }}>
            <Text style={{ color: colors.textPrimary }}>{item.message}</Text>
            <Text style={{ color: colors.textSecondary }}>
              {item.author} · {new Date(Number(item.date) * 1000).toLocaleString()} · {item.hash.slice(0, 8)}
            </Text>
          </View>} />
      </SafeAreaView>
    </Modal>
  );
}
