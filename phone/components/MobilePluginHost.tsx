import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';
import { readFile } from '@/lib/file-system';
import { getEnabledPluginIds, getInstalledPlugins, pluginMainPath } from '@/lib/plugins';
import { getPluginSelection, pluginEvents, registerPluginUnloader, setPluginSelection, type PluginSelection } from '@/lib/plugin-events';
import { mobilePluginDocument, type PluginBlock } from '@/lib/mobile-plugin-document';
import { pluginShortcut } from '@/lib/plugin-shortcuts';
import { native, nativeDir, withEditor } from '@/lib/provider-sync';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';

type Kind = 'command' | 'panel' | 'settings' | 'status';
type Registration = { id: string; name: string; kind: Kind; hotkey?: string; title?: string };
type Entry = Registration & { label: string; run: () => void };
type Script = { generation?: number; id: string; name: string; path: string; code: string; enabled: boolean };
type Snapshot = { revision: number; path: string | null; content: string | null; selection: PluginSelection };
type Edit = { content: string; selection: PluginSelection };
type RuntimeInfo = { entries: Entry[]; languages?: string[] };

const PluginContext = createContext<{ entries: Entry[]; renderers: Record<string, Script> }>({ entries: [], renderers: {} });
export const usePluginEntries = () => useContext(PluginContext).entries;
export const usePluginRenderers = () => useContext(PluginContext).renderers;
export const usePluginCommands = () => usePluginEntries().map(entry => ({
  label: entry.hotkey ? `${entry.label} (${entry.hotkey})` : entry.label,
  run: entry.run,
}));

function bridgeJS(value: object) {
  return `window.noteriv(${JSON.stringify(value)});true;`;
}

function validEdit(value: any): value is Edit {
  return typeof value.content === 'string' && value.content.length <= 2_000_000 &&
    Number.isInteger(value.selection?.start) && Number.isInteger(value.selection?.end) &&
    value.selection.start >= 0 && value.selection.end >= value.selection.start &&
    value.selection.end <= value.content.length;
}

function Runtime({ script, vaultPath, update, stopped, block }: {
  script: Script;
  vaultPath: string;
  update?: (id: string, info: Partial<RuntimeInfo>) => void;
  stopped?: (id: string) => void;
  block?: PluginBlock;
}) {
  const { vault, currentFile, content, applyPluginEdit, closeDeletedPluginNote, saveFile, refreshFiles, workspace } = useApp();
  const { colors } = useTheme();
  const [panel, setPanel] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [height, setHeight] = useState(80);
  const web = useRef<WebView<object>>(null);
  const latest = useRef({ vault, currentFile, content, applyPluginEdit, refreshFiles, enabled: script.enabled });
  latest.current = { vault, currentFile, content, applyPluginEdit, refreshFiles, enabled: script.enabled };
  const registrations = useRef(new Map<string, Registration>());
  const revision = useRef(0);
  const eventSnapshot = useRef<Snapshot | null>(null);
  const pending = useRef<{ base: Snapshot; edit?: Edit } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unloading = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  const [ready, setReady] = useState(false);
  const { code, color, language, sourcePath, layout } = block ?? {};
  const fillsViewport = layout === 'viewport';
  const source = useMemo(() => ({
    html: mobilePluginDocument(script.code,
      code !== undefined && color && language ? { code, color, language, sourcePath: sourcePath ?? null, layout } : undefined),
  }), [script.code, code, color, language, sourcePath, layout]);

  const send = (data: object) => web.current?.injectJavaScript(bridgeJS(data));
  const snapshot = () => {
    const state = latest.current;
    const path = state.vault?.path === vaultPath ? state.currentFile : null;
    const text = path ? state.content : null;
    const selection = getPluginSelection(path, text?.length ?? 0);
    const base = { revision: ++revision.current, path, content: text, selection };
    return {
      ...base,
      app: {
        version: Constants.expoConfig?.version ?? '',
        vaultPath,
        currentFile: path ? vaultRelativePath(vaultPath, path) : null,
      },
    };
  };
  const emit = (name: string, args: unknown[]) => {
    const base = snapshot();
    eventSnapshot.current = base;
    send({ type: 'event', snapshot: base, name, args });
  };
  const showNotice = (value: string, duration?: number) => {
    clearTimeout(noticeTimer.current);
    setNotice(value);
    noticeTimer.current = setTimeout(() => setNotice(undefined), Math.max(300, Math.min(duration ?? 4_000, 10_000)));
  };
  const closePanel = () => {
    send({ type: 'close' });
    setPanel(undefined);
  };
  const canAccessVault = () => latest.current.enabled && !unloading.current && latest.current.vault?.path === vaultPath;
  const applyEdit = (base: Snapshot, edit: Edit) => {
    if (!base.path || base.content === null || !canAccessVault()) return;
    if (!latest.current.applyPluginEdit(base.path, base.content, edit.content)) {
      showNotice('The note changed before the plugin finished.');
      return false;
    }
    setPluginSelection(base.path, edit.selection);
    pluginEvents.emit('selection', { path: base.path, range: edit.selection });
    return true;
  };

  useEffect(() => {
    if (!panel) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closePanel();
      return true;
    });
    return () => subscription.remove();
  }, [panel]);

  useEffect(() => {
    if (!ready || block || !script.enabled) return;
    const subscriptions = [
      pluginEvents.addListener('event', ({ sender, name, args, vault }) => {
        if (sender !== script.id && vault === vaultPath) emit(name, args);
      }),
      ...(['saved', 'created', 'deleted'] as const).map((type) => pluginEvents.addListener(type, path => {
        if (!path.startsWith(vaultPath.replace(/\/$/, '') + '/')) return;
        const relative = vaultRelativePath(vaultPath, path);
        if (relative.split('/').some(part => part.startsWith('.'))) return;
        emit(type === 'saved' ? 'file-save' : type === 'created' ? 'file-create' : 'file-delete', [relative]);
      })),
    ];
    return () => { subscriptions.forEach(subscription => subscription.remove()); };
  }, [ready, script.enabled, !!block, script.id, vaultPath]);

  useEffect(() => {
    if (ready && script.enabled && !block) {
      emit('vault-change', [vaultPath]);
      emit('plugin-loaded', [script.id]);
      pluginEvents.emit('event', { vault: vaultPath, sender: script.id, name: 'plugin-loaded', args: [script.id] });
    }
  }, [ready]);

  useEffect(() => {
    if (ready && script.enabled && !block) emit('layout-change', []);
  }, [ready, workspace.viewMode, workspace.activeTab, workspace.expandedFolders]);

  useEffect(() => {
    if (!ready || !script.enabled || block) return;
    if (currentFile) emit('file-open', [vaultRelativePath(vaultPath, currentFile)]);
    else send({ type: 'snapshot', snapshot: snapshot() });
  }, [ready, currentFile]);

  useEffect(() => {
    if (!ready || !currentFile || !script.enabled || block) return;
    const timer = setTimeout(() => emit('editor-change', [content]), 150);
    return () => clearTimeout(timer);
  }, [ready, currentFile, content]);

  const stop = () => {
    if (unloading.current) return unloading.current.promise;
    let resolve = () => {};
    const promise = new Promise<void>(done => { resolve = done; });
    const timer = setTimeout(resolve, 1_000);
    unloading.current = { promise, resolve: () => { clearTimeout(timer); resolve(); } };
    setPanel(undefined);
    if (web.current) send({ type: 'stop' });
    else unloading.current.resolve();
    return promise;
  };

  useEffect(() => {
    if (!block) return registerPluginUnloader(vaultPath, async () => {
      await stop();
      pluginEvents.emit('event', { vault: vaultPath, sender: script.id, name: 'plugin-unloaded', args: [script.id] });
    });
  }, [vaultPath, script.id, !!block]);

  useEffect(() => {
    if (script.enabled) return;
    let active = true;
    void stop().then(() => { if (active) stopped?.(script.id); });
    return () => { active = false; };
  }, [script.enabled, script.id, stopped]);

  useEffect(() => () => {
    clearTimeout(noticeTimer.current);
    clearTimeout(commandTimer.current);
    send({ type: 'stop' });
    unloading.current?.resolve();
  }, []);

  const publishEntries = () => update?.(script.id, {
    entries: Array.from(registrations.current.values(), item => ({
      ...item,
      label: `${script.name}: ${item.name}`,
      run: () => {
        if (!canAccessVault()) return;
        if (item.kind === 'panel' || item.kind === 'settings') {
          setPanel(item.name);
          const base = snapshot();
          eventSnapshot.current = base;
          send({ type: 'view', id: item.id, snapshot: base });
          return;
        }
        if (pending.current) return;
        const base = snapshot();
        pending.current = { base };
        commandTimer.current = setTimeout(() => {
          pending.current = null;
          showNotice('The plugin command timed out.');
          web.current?.reload();
        }, 30_000);
        send({ type: 'command', id: item.id, invocation: base.revision, snapshot: base });
      },
    })),
  });

  const handleMessage = async (raw: string) => {
    if (raw.length > 2_100_000) return;
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    if (!message || typeof message !== 'object') return;
    if (message.type === 'stopped') {
      unloading.current?.resolve();
      return;
    }
    if (!canAccessVault() && (message.type !== 'vault' || !unloading.current || latest.current.vault?.path !== vaultPath)) return;

    switch (message.type) {
      case 'boot': {
        setReady(false);
        clearTimeout(commandTimer.current);
        pending.current = null;
        registrations.current.clear();
        update?.(script.id, { entries: [], languages: undefined });
        const base = snapshot();
        eventSnapshot.current = base;
        send({ type: 'start', snapshot: base });
        break;
      }
      case 'ready':
        setReady(true);
        break;
      case 'height':
        if (block && !fillsViewport && typeof message.height === 'number') setHeight(Math.max(48, Math.min(message.height, 2_000)));
        break;
      case 'notice':
        if (typeof message.value === 'string' && !block) {
          showNotice(`${script.name}: ${message.value.slice(0, 200)}`, typeof message.duration === 'number' ? message.duration : undefined);
        }
        break;
      case 'event':
        if (!block && typeof message.name === 'string' && Array.isArray(message.args)) {
          pluginEvents.emit('event', { vault: vaultPath, sender: script.id, name: message.name, args: message.args });
        }
        break;
      case 'languages':
        if (Array.isArray(message.languages)) {
          const languages = message.languages.filter((value: unknown) => typeof value === 'string' && value.length < 100);
          update?.(script.id, { languages });
        }
        break;
      case 'add':
        if (typeof message.id === 'string' && message.id.length <= 115 && typeof message.name === 'string' &&
            ['command', 'panel', 'settings', 'status'].includes(message.kind) &&
            (registrations.current.has(message.id) || registrations.current.size < 100)) {
          registrations.current.set(message.id, {
            id: message.id, name: message.name.slice(0, 100), kind: message.kind,
            hotkey: typeof message.hotkey === 'string' ? message.hotkey.slice(0, 60) : undefined,
            title: typeof message.title === 'string' ? message.title.slice(0, 120) : undefined,
          });
          publishEntries();
        }
        break;
      case 'remove':
        if (registrations.current.delete(message.id)) publishEntries();
        break;
      case 'vault': {
        if (typeof message.request !== 'number' || typeof message.path !== 'string' ||
          !['read', 'readBinary', 'write', 'list', 'exists', 'delete', 'readAsset'].includes(message.operation)) break;
        const { operation, path, request } = message;
        if (operation === 'readAsset') {
          try {
            const value = await native<string | null>({
              action: 'pluginAsset', dir: nativeDir(vaultPath), pluginId: script.id, path,
            });
            if (canAccessVault()) send({ type: 'response', request, value });
          } catch (error) {
            if (canAccessVault()) send({ type: 'response', request, error: String(error) });
          }
          break;
        }
        const cleanPath = path.replace(/\/$/, '');
        const state = latest.current;
        const active = state.currentFile && vaultRelativePath(vaultPath, state.currentFile) === cleanPath;
        const run = async () => {
          if (active && operation === 'read') return state.content;

          if (operation === 'write' && (typeof message.content !== 'string' || message.content.length > 2_000_000)) {
            throw new Error('A text file of up to two megabytes is required.');
          }
          const call = <T,>(op: string) => native<T>({
            action: 'pluginVault', dir: nativeDir(vaultPath), operation: op, path, content: message.content,
          });
          if (active && operation === 'write' && state.currentFile) {
            if (!(await call<boolean>('exists'))) return false;
            if (!canAccessVault() || !state.applyPluginEdit(state.currentFile, state.content, message.content)) {
              throw new Error('The active note changed.');
            }
            return saveFile();
          }
          if (operation !== 'write' && operation !== 'delete') return call(operation);
          const result = await withEditor(async () => {
            if (latest.current.vault?.path !== vaultPath) throw new Error('The active vault changed.');
            const existed = operation === 'write' && await call<boolean>('exists');
            const value = await call<boolean>(operation);
            if (value) {
              const uri = vaultFileUri(vaultPath, cleanPath);
              if (operation === 'delete') closeDeletedPluginNote(uri);
              pluginEvents.emit(operation === 'delete' ? 'deleted' : existed ? 'saved' : 'created', uri);
            }
            return value;
          });
          latest.current.refreshFiles();
          return result;
        };
        try {
          const value = await run();
          send({ type: 'response', request, value });
        } catch (error) {
          send({ type: 'response', request, error: String(error) });
        }
        break;
      }
      case 'edit':
        if (pending.current && pending.current.base.revision === message.invocation && validEdit(message)) {
          pending.current.edit = message;
        }
        break;
      case 'event-edit': {
        const base = eventSnapshot.current;
        if (base && base.revision === message.revision && validEdit(message)) {
          eventSnapshot.current = null;
          const applied = applyEdit(base, message);
          const refreshed = snapshot();
          eventSnapshot.current = refreshed;
          send({ type: 'snapshot', snapshot: applied ? { ...refreshed, content: message.content, selection: message.selection } : refreshed });
        }
        break;
      }
      case 'done': {
        const command = pending.current;
        if (command && command.base.revision === message.invocation) {
          pending.current = null;
          clearTimeout(commandTimer.current);
          if (command.edit) applyEdit(command.base, command.edit);
        }
        break;
      }
    }
  };

  return <>
    <View pointerEvents={block || panel ? 'auto' : 'none'}
      accessibilityViewIsModal={!!panel}
      importantForAccessibility={block || panel ? 'auto' : 'no-hide-descendants'}
      style={fillsViewport ? { flex: 1 } : block ? { height } : panel ? styles.panel : styles.hidden}>
      {!!panel && <SafeAreaView edges={['top']}>
        <Pressable accessibilityRole="button" style={styles.close} onPress={closePanel}>
          <Text>Close {panel}</Text>
        </Pressable>
      </SafeAreaView>}
      <WebView<object> ref={web} source={source} javaScriptEnabled domStorageEnabled={false}
        scrollEnabled={!fillsViewport}
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
        originWhitelist={['*']} onShouldStartLoadWithRequest={request =>
          request.url === 'about:blank' || (request.url === 'about:srcdoc' && request.isTopFrame !== true)}
        setSupportMultipleWindows={false} mixedContentMode="never"
        onMessage={event => { void handleMessage(event.nativeEvent.data); }} />
    </View>
    {!!notice && <View pointerEvents="none" accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: colors.bgTertiary }]}>
      <Text style={{ color: colors.textPrimary }}>{notice}</Text>
    </View>}
  </>;
}

export function MobilePluginBlock({ renderer, block, vaultPath }: {
  renderer: Script; block: PluginBlock; vaultPath: string;
}) {
  return <Runtime script={renderer} vaultPath={vaultPath} block={block} />;
}

export function PluginStatusBar() {
  const { colors } = useTheme();
  const items = usePluginEntries().filter(item => item.kind === 'status');
  if (!items.length) return null;
  return <ScrollView horizontal style={{ flexGrow: 0, backgroundColor: colors.bgSecondary }}
    showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
    {items.map(item => <Pressable key={item.label + item.id} accessibilityRole="button"
      onPress={item.run} accessibilityLabel={item.title || item.name} style={styles.status}>
      <Text numberOfLines={1} style={{ color: colors.textSecondary }}>{item.name}</Text>
    </Pressable>)}
  </ScrollView>;
}

export function MobilePluginHost({ children }: { children: ReactNode }) {
  const { vault } = useApp();
  const path = vault?.path;
  const [scripts, setScripts] = useState<Script[]>([]);
  const [info, setInfo] = useState<Record<string, RuntimeInfo>>({});
  const [loadedPath, setLoadedPath] = useState<string>();
  const [manifestRenderers, setManifestRenderers] = useState<Record<string, Script>>({});
  const update = useRef((id: string, patch: Partial<RuntimeInfo>) =>
    setInfo(previous => ({ ...previous, [id]: { ...previous[id], ...patch, entries: patch.entries ?? previous[id]?.entries ?? [] } }))).current;
  const stopped = useRef((id: string) => {
    setScripts(previous => previous.filter(script => script.id !== id || script.enabled));
    setInfo(previous => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }).current;

  useEffect(() => {
    if (!path || !['android', 'ios'].includes(Platform.OS)) return;
    let generation = 0;
    const load = async () => {
      const request = ++generation;
      const [installed, enabled] = await Promise.all([getInstalledPlugins(path), getEnabledPluginIds(path)]);
      const next = await Promise.all(installed.filter(p => enabled.includes(p.id)).map(async p => {
        const main = pluginMainPath(path, p);
        const code = main && await readFile(main);
        if (!main || !code || code.length > 500_000) return null;
        return { script: { id: p.id, name: p.name, path: main, code, enabled: true }, languages: p.codeBlockLanguages ?? [] };
      }));
      if (request !== generation) return;
      const active: Script[] = [];
      const declared: Record<string, Script> = Object.create(null);
      for (const item of next) {
        if (!item) continue;
        for (const language of item.languages) if (typeof language === 'string') declared[language.toLowerCase()] = item.script;
        active.push(item.script);
      }
      setLoadedPath(path);
      setManifestRenderers(declared);
      setScripts(previous => [
        ...active.map(script => {
          const old = previous.find(item => item.id === script.id);
          return { ...script, generation: (old?.generation ?? 0) + (old && (!old.enabled || old.code !== script.code) ? 1 : 0) };
        }),
        ...previous.filter(script => !active.some(item => item.id === script.id))
          .map(script => ({ ...script, enabled: false })),
      ]);
    };
    const listener = pluginEvents.addListener('config', changed => {
      if (changed === path) void load().catch(() => {});
    });
    void load().catch(() => {});
    return () => {
      generation++;
      listener.remove();
      setScripts([]);
      setInfo({});
      setLoadedPath(undefined);
      setManifestRenderers({});
    };
  }, [path]);

  const value = useMemo(() => {
    const renderers: Record<string, Script> = Object.create(null);
    const entries: Entry[] = [];
    if (path !== loadedPath) return { entries, renderers };
    Object.assign(renderers, manifestRenderers);
    for (const script of scripts) {
      if (!script.enabled) continue;
      const registered = info[script.id];
      if (registered) entries.push(...registered.entries);
      if (registered?.languages) {
        for (const [language, owner] of Object.entries(renderers)) if (owner.id === script.id) delete renderers[language];
        for (const language of registered.languages) renderers[language] = script;
      }
    }
    return { entries, renderers };
  }, [path, loadedPath, manifestRenderers, scripts, info]);

  useEffect(() => {
    const bindings = new Map<string, () => void>();
    for (const item of value.entries) {
      const key = item.hotkey && pluginShortcut(item.hotkey, Platform.OS);
      if (key && !bindings.has(key)) bindings.set(key, item.run);
    }
    if (!bindings.size) return;
    let unmounted = false;
    let cleanup: (() => void) | undefined;
    void import('../modules/noteriv-git').then(({ default: module }) => {
      if (unmounted || typeof module.setPluginShortcuts !== 'function') return;
      const subscription = module.addListener('onPluginShortcut', ({ binding }) => bindings.get(binding)?.());
      cleanup = () => { subscription.remove(); void module.setPluginShortcuts([]); };
      return module.setPluginShortcuts([...bindings.keys()]);
    }).catch(() => {});
    return () => { unmounted = true; cleanup?.(); };
  }, [value.entries]);

  const finish = useMemo(() => (id: string) => {
    stopped(id);
    if (path) pluginEvents.emit('event', { vault: path, sender: id, name: 'plugin-unloaded', args: [id] });
  }, [path, stopped]);

  const runtimes = path && loadedPath === path ? scripts.map(script =>
    <Runtime key={`${path}:${script.id}:${script.generation ?? 0}`} script={script} vaultPath={path} update={update} stopped={finish} />) : null;
  return <PluginContext.Provider value={value}>
    {children}
    {Platform.OS === 'ios' && runtimes?.length
      ? <FullWindowOverlay><View style={StyleSheet.absoluteFill} pointerEvents="box-none">{runtimes}</View></FullWindowOverlay>
      : runtimes}
  </PluginContext.Provider>;
}

const styles = StyleSheet.create({
  panel: { ...StyleSheet.absoluteFill, backgroundColor: '#fff', zIndex: 50, elevation: 12 },
  close: { padding: 16 },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
  status: { paddingHorizontal: 10, paddingVertical: 5 },
  notice: { position: 'absolute', zIndex: 60, elevation: 16, bottom: 24, left: 16, right: 16, borderRadius: 8, padding: 12 },
});
