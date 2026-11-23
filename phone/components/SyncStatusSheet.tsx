import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { native, nativeDir, type NativeStatus } from '@/lib/provider-sync';

interface Props {
  vaultPath: string;
  busy: boolean;
  onSync: () => void;
  onClose: () => void;
  onSettings: () => void;
}

export default function SyncStatusSheet({ vaultPath, busy, onSync, onClose, onSettings }: Props) {
  const { colors, metrics } = useTheme();
  const [status, setStatus] = useState<NativeStatus>();
  const [error, setError] = useState('');

  useEffect(() => {
    if (busy) return;
    let active = true;
    void Promise.resolve().then(() => native({ action: 'status', dir: nativeDir(vaultPath) })).then(next => {
      if (!active) return;
      setStatus(next);
      setError('');
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not read sync status');
    });
    return () => { active = false; };
  }, [busy, vaultPath]);

  const pending = (status?.changes ?? 0) + (status?.ahead ?? 0);
  const syncError = error || status?.sync.lastError;
  const conflicts = status?.conflicts.length ?? 0;
  const running = busy || status?.inProgress;
  const title = running ? 'Syncing…' : conflicts ? 'Sync conflict' : syncError ? 'Sync needs attention'
    : pending ? 'Saved locally' : status ? 'Ready to sync' : 'Checking sync status…';
  const detail = conflicts ? 'Review the conflicting files in Git Sync settings.' : syncError
    || (pending ? 'Local changes are waiting to sync.' : status?.sync.lastSuccess
      ? 'Last synced ' + new Date(status.sync.lastSuccess * 1000).toLocaleString() : undefined);
  const statusColor = conflicts || syncError ? colors.red : colors.green;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView edges={['bottom']} style={styles.stage}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Close sync status" onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.bgPrimary, borderTopLeftRadius: metrics.panelRadius,
          borderTopRightRadius: metrics.panelRadius }]} accessibilityViewIsModal>
          <View style={styles.header}>
            <Ionicons name={conflicts || syncError ? 'warning-outline' : 'sync-outline'} size={22} color={statusColor} />
            <Text accessibilityRole="header" style={{ flex: 1, color: colors.textPrimary, fontSize: 20, fontWeight: '700' }}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close sync status" style={styles.close} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          {!!detail && <Text style={{ color: colors.textSecondary, marginVertical: 8 }} accessibilityLiveRegion="polite">{detail}</Text>}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={onSync} disabled={!!running || !!conflicts}
              style={[styles.action, { opacity: running || conflicts ? 0.45 : 1, borderRadius: metrics.controlRadius, backgroundColor: colors.accent + '18' }]}>
              <Text style={{ color: colors.accent, fontWeight: '700' }}>{syncError ? 'Retry sync' : 'Sync now'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => { onClose(); requestAnimationFrame(onSettings); }} style={styles.action}>
              <Text style={{ color: colors.accent, fontWeight: '700' }}>{conflicts ? 'Review conflicts' : 'Sync settings'}</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17,24,20,0.38)' },
  sheet: { padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  action: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 },
});
