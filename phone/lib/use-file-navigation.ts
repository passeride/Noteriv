import { useNavigation, useRoute, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { FileForwardHistory, type FileDestination } from '@/lib/file-navigation';

const histories = new Map<string, FileForwardHistory>();

function historyFor(id?: string) {
  if (!id) return;
  let history = histories.get(id);
  if (!history) {
    history = new FileForwardHistory();
    histories.set(id, history);
  }
  return history;
}

export function useFileNavigation() {
  const router = useRouter();
  const navigation = useNavigation();
  const { key, params } = useRoute();
  const { vault, flushFile } = useApp();
  const id = vault?.id;
  const { path, heading, line, fileForward } = (params ?? {}) as Partial<FileDestination>;

  const open = useCallback((destination: FileDestination) => {
    if (!flushFile()) return;
    historyFor(id)?.clear();
    router.push({ pathname: '/editor', params: destination });
  }, [id, router, flushFile]);

  const back = useCallback(() => {
    if (!router.canGoBack()) return false;
    const state = navigation.getState();
    const index = state?.routes.findIndex(item => item.key === key) ?? -1;
    const previous = index > 0 ? state?.routes[index - 1] : undefined;
    const history = historyFor(id);
    if (previous && (previous.name === 'index' || previous.name === 'editor') && typeof path === 'string') {
      const previousParams = previous.params as Partial<FileDestination> | undefined;
      history?.back({ key, fileForward }, { key: previous.key, fileForward: previousParams?.fileForward }, { path, heading, line });
    } else history?.clear();
    router.back();
    return true;
  }, [router, navigation, id, key, fileForward, path, heading, line]);

  const forward = useCallback((nextPath?: string) => {
    if (!flushFile()) return;
    const history = historyFor(id);
    const destination = history?.forward({ key, fileForward });
    if (destination) {
      router.push({ pathname: '/editor', params: destination });
    } else if (nextPath) {
      history?.clear();
      router.push({ pathname: '/editor', params: { path: nextPath } });
    }
  }, [flushFile, id, key, fileForward, router]);

  return { open, back, forward };
}
