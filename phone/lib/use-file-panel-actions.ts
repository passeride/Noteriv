import { useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorCommand } from '@/components/QuickLauncher';
import { useApp } from '@/context/AppContext';
import { getOrCreateDailyNote } from '@/lib/daily-note';
import { getRandomNote } from '@/lib/random-note';
import { describeOutcome } from '@/lib/webdav-sync';

export function useFilePanelActions({
  openFile, openSearch, root = false,
}: {
  openFile: (path: string) => void;
  openSearch: () => void;
  root?: boolean;
}) {
  const router = useRouter();
  const { vault, flushFile, syncCurrentVault } = useApp();
  const [syncStatusVisible, setSyncStatusVisible] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const syncInFlight = useRef<Promise<void> | null>(null);
  const [syncNotice, setSyncNotice] = useState<{ vaultId: string; message: string }>();
  const syncMessage = syncNotice?.vaultId === vault?.id ? syncNotice?.message : undefined;
  const syncProvider = vault?.gitRemote ? 'Git' : vault?.webdav?.url ? 'WebDAV' : undefined;

  useEffect(() => {
    if (!syncNotice) return;
    const timeout = setTimeout(() => setSyncNotice(undefined), 4500);
    return () => clearTimeout(timeout);
  }, [syncNotice]);

  const syncVault = useCallback(async () => {
    if (!vault || !syncProvider) return;
    if (syncInFlight.current) return syncInFlight.current;
    setSyncBusy(true);
    setSyncNotice(undefined);
    const operation = (async () => {
      try {
        const result = await syncCurrentVault();
        if (!result) return;
        const { outcome } = result;
        const message = result.provider === 'webdav'
          ? describeOutcome(result.outcome)
          : outcome.errors[0] || (outcome.pulled || outcome.pushed
            ? `Pulled ${outcome.pulled}, pushed ${outcome.pushed}.`
            : 'Up to date.');
        setSyncNotice({ vaultId: vault.id, message });
      } catch (error) {
        setSyncNotice({ vaultId: vault.id, message: error instanceof Error ? error.message : String(error) });
      } finally {
        setSyncBusy(false);
      }
    })();
    syncInFlight.current = operation;
    try {
      await operation;
    } finally {
      syncInFlight.current = null;
    }
  }, [syncCurrentVault, syncProvider, vault]);

  function push(target: Href) {
    if (flushFile()) router.push(target);
  }

  async function openLibraryNote(kind: 'daily' | 'random') {
    if (!vault || !flushFile()) return;
    const path = await (kind === 'daily' ? getOrCreateDailyNote(vault.path) : getRandomNote(vault.path));
    if (path) openFile(path);
  }

  const openSyncStatus = () => setSyncStatusVisible(true);
  const closeSyncStatus = () => setSyncStatusVisible(false);
  const openSyncSettings = () => push({ pathname: '/settings', params: { section: 'vault' } });
  const commands: EditorCommand[] = [
    ...(vault?.gitRemote ? [{ label: 'Git: Sync status', run: openSyncStatus }] : []),
    ...(syncProvider && !syncBusy ? [{ label: `${syncProvider}: Sync now`, run: () => void syncVault() }] : []),
    { label: 'Daily note', run: () => void openLibraryNote('daily') },
    { label: 'Calendar', run: () => push('/calendar') },
    { label: 'Flashcards', run: () => push('/flashcards') },
    { label: 'Vault graph', run: () => push('/graph') },
    { label: 'Random note', run: () => void openLibraryNote('random') },
    { label: 'Quick open or search', run: openSearch },
    { label: 'Settings', run: () => push('/settings') },
    ...(vault?.homeFile && !root ? [{ label: 'Start note', run: () => { if (flushFile()) router.dismissTo('/'); } }] : []),
  ];

  return { commands, syncVault, syncBusy, syncMessage, syncStatusVisible, openSyncStatus, closeSyncStatus, openSyncSettings };
}
