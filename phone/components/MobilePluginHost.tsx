import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, BackHandler, Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useApp } from '@/context/AppContext';
import { readFile } from '@/lib/file-system';
import { getEnabledPluginIds, getInstalledPlugins } from '@/lib/plugins';
import { pluginEvents } from '@/lib/plugin-events';
import { native, nativeDir } from '@/lib/provider-sync';
import { vaultFileUri, vaultRelativePath } from '@/lib/sync-state';

type Command = { label: string; run: () => void };
export const pluginSelection = { start: 0, end: 0 };
const Commands = createContext<Command[]>([]);
export const usePluginCommands = () => useContext(Commands);

type Registration = { id: string; name: string; kind?: string };
type Script = { id: string; name: string; code: string };

function html(code: string): string {
  const escapedCode = JSON.stringify(code).replace(/</g, '\\u003c');
  return `<!doctype html><meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <script>
      const post = message => window.ReactNativeWebView.postMessage(JSON.stringify(message));
      const commands = new Map();
      const events = new Map();
      const requests = new Map();
      const views = new Map();
      const app = { platform: 'mobile', version: '', currentFile: null, vaultPath: null };
      let nextRequest = 0;
      let selection = { start: 0, end: 0 };
      let cleanup;
      function vault(operation, path = '', content) {
        return new Promise((resolve, reject) => {
          const request = ++nextRequest;
          requests.set(request, { resolve, reject });
          post({ type: 'vault', operation, path, content, request });
        });
      }
      function registerView(kind, item, name, callback) {
        if (!item || typeof item.id !== 'string' || typeof name !== 'string' || typeof callback !== 'function') return;
        const id = kind + ':' + item.id;
        views.set(id, callback);
        post({ type: 'add', id, name, kind });
      }
      function removeView(kind, id) {
        const key = kind + ':' + id;
        views.delete(key);
        post({ type: 'remove', id: key });
      }
      function replaceSelection(text) {
        if (typeof text !== 'string' || content === null) return;
        api.editor.setContent(content.slice(0, selection.start) + text + content.slice(selection.end));
        selection.start += text.length;
        selection.end = selection.start;
      }
      let content = null;
      let invocation = null;
      const api = {
        vault: {
          read: path => vault('read', path),
          write: (path, value) => vault('write', path, value),
          list: path => vault('list', path),
          exists: path => vault('exists', path),
          delete: path => vault('delete', path),
        },
        ui: {
          addSidebarPanel: item => registerView('panel', item, item?.title, item?.render),
          removeSidebarPanel: id => removeView('panel', id),
          addSettingsTab: item => registerView('settings', item, item?.name, item?.render),
          removeSettingsTab: id => removeView('settings', id),
          addStatusBarItem: item => registerView('status', item, item?.text, item?.onClick || (() => {})),
          removeStatusBarItem: id => removeView('status', id),
          addCommand(command) {
            if (!command || typeof command.id !== 'string' || typeof command.name !== 'string'
                || typeof command.callback !== 'function' || commands.size >= 100) return;
            commands.set(command.id, command.callback);
            post({ type: 'add', id: command.id, name: command.name });
          },
          removeCommand(id) { commands.delete(id); post({ type: 'remove', id }); },
          showNotice(message) { post({ type: 'notice', value: String(message) }); },
        },
        editor: {
          getContent: () => content,
          getSelection: () => content?.slice(selection.start, selection.end) ?? '',
          getCursorPosition() {
            const lines = (content ?? '').slice(0, selection.end).split('\\n');
            return { line: lines.length - 1, ch: lines.at(-1).length };
          },
          replaceSelection,
          insertAtCursor: replaceSelection,
          setContent(value) {
            if (invocation !== null && typeof value === 'string') {
              post({ type: 'edit', invocation, value });
              content = value;
            }
          },
        },
        events: {
          on(name, callback) {
            if (typeof callback !== 'function') return;
            if (!events.has(name)) events.set(name, new Set());
            events.get(name).add(callback);
          },
          off(name, callback) { events.get(name)?.delete(callback); },
          emit(name, ...args) {
            for (const callback of events.get(name) || []) {
              try { Promise.resolve(callback(...args)).catch(report); } catch (error) { report(error); }
            }
          },
        },
        app,
        markdown: { registerCodeBlockProcessor() {} },
      };
      function report(error) { api.ui.showNotice(String(error)); }
      window.noteriv = async data => {
        if (data.type === 'response') {
          const request = requests.get(data.request);
          requests.delete(data.request);
          if (data.error) request?.reject(new Error(data.error));
          else request?.resolve(data.value);
          return;
        }
        if (data.app) Object.assign(app, data.app);
        if (data.type === 'close') {
          try { if (typeof cleanup === 'function') cleanup(); } finally { document.body.replaceChildren(); }
          cleanup = undefined;
        } else if (data.type === 'view') {
          document.body.replaceChildren();
          const panel = document.createElement('div');
          document.body.append(panel);
          try { cleanup = views.get(data.id)?.(panel); } catch (error) { report(error); }
        } else if (data.type === 'event') {
          if (invocation === null) content = data.content;
          api.events.emit(data.name, ...data.args);
        } else if (data.type === 'command' && invocation === null) {
          content = data.content;
          selection = data.selection;
          invocation = data.invocation;
          try { await (commands.get(data.id) || views.get(data.id))?.(); } catch (error) { report(error); }
          finally { post({ type: 'done', invocation }); invocation = null; }
        }
      };
      const module = { exports: {} };
      try {
        new Function('module', 'exports', ${escapedCode})(module, module.exports);
        window.startPlugin = data => {
          Object.assign(app, data.app);
          content = data.content;
          Promise.resolve(module.exports.onLoad?.(api)).then(() => post({ type: 'ready' }), report);
        };
        post({ type: 'boot' });
      } catch (error) { report(error); }
    </script>`;
}

function Runtime({ script, addCommands }: { script: Script; addCommands: (id: string, commands: Command[]) => void }) {
  const { vault, currentFile, content, setContent, refreshFiles } = useApp();
  const [panel, setPanel] = useState<string>();
  const web = useRef<WebView<object>>(null);
  const latest = useRef({ currentFile, content, setContent });
  latest.current = { currentFile, content, setContent };
  const registrations = useRef(new Map<string, Registration>());
  const sequence = useRef(0);
  const pending = useRef<{ id: number; path: string | null; expected: string; updated?: string } | undefined>(undefined);
  const [source] = useState(() => ({ html: html(script.code) }));
  const [ready, setReady] = useState(false);
  const send = (data: object) => web.current?.injectJavaScript(`window.noteriv(${JSON.stringify(data)});true;`);

  const closePanel = () => {
    send({ type: 'close' });
    setPanel(undefined);
  };
  useEffect(() => {
    if (!panel) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closePanel();
      return true;
    });
    return () => subscription.remove();
  }, [panel]);

  const appState = {
    version: '1.1.0',
    vaultPath: vault?.path ?? null,
    currentFile: currentFile && vault ? vaultRelativePath(vault.path, currentFile) : null,
  };
  useEffect(() => {
    if (!ready) return;
    if (currentFile) send({ type: 'event', name: 'file-open', args: [appState.currentFile], app: appState, content: latest.current.content });
  }, [ready, currentFile]);
  useEffect(() => {
    if (!ready) return;
    const listener = pluginEvents.addListener('saved', path => {
      const state = latest.current;
      if (path === state.currentFile) send({ type: 'event', name: 'file-save', args: [vault ? vaultRelativePath(vault.path, path) : path], content: state.content });
    });
    return () => listener.remove();
  }, [ready]);
  useEffect(() => {
    if (!ready || !currentFile) return;
    const timer = setTimeout(() => {
      send({ type: 'event', name: 'editor-change', args: [content], content });
    }, 150);
    return () => clearTimeout(timer);
  }, [ready, currentFile, content]);

  useEffect(() => () => addCommands(script.id, []), [addCommands, script.id]);

  return <View pointerEvents={panel ? 'auto' : 'none'}
    importantForAccessibility={panel ? 'auto' : 'no-hide-descendants'}
    style={panel ? styles.panel : styles.hidden}>
    {!!panel && <Pressable accessibilityRole="button" style={styles.close} onPress={closePanel}>
      <Text>Close {panel}</Text>
    </Pressable>}
    <WebView<object> ref={web} source={source} javaScriptEnabled domStorageEnabled={false}
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
    originWhitelist={['*']} onShouldStartLoadWithRequest={r => r.url === 'about:blank'}
    setSupportMultipleWindows={false} mixedContentMode="never"
    onMessage={event => {
      let message;
      try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'boot') {
        web.current?.injectJavaScript(`window.startPlugin(${JSON.stringify({ app: appState, content: currentFile ? content : null })});true;`);
      }
      if (message.type === 'vault' && vault && typeof message.request === 'number'
        && typeof message.path === 'string' && ['read', 'write', 'list', 'exists', 'delete'].includes(message.operation)) {
        const state = latest.current;
        const active = state.currentFile && vaultRelativePath(vault.path, state.currentFile) === message.path;
        const run = async () => {
          if (message.operation === 'read' && active) return state.content;
          if (active && ['write', 'delete'].includes(message.operation)) {
            throw new Error('Use the editor API to modify the open note.');
          }
          if (message.operation === 'write' && typeof message.content !== 'string') throw new Error('Text required.');
          const value = await native<unknown>({
            action: 'pluginVault', dir: nativeDir(vault.path), operation: message.operation,
            path: message.path, content: message.content,
          });
          if (message.operation === 'write' || message.operation === 'delete') refreshFiles();
          return value;
        };
        void run().then(
          value => send({ type: 'response', request: message.request, value }),
          error => send({ type: 'response', request: message.request, error: String(error) }),
        );
      }
      if (message.type === 'ready') setReady(true);
      if (message.type === 'notice' && typeof message.value === 'string') {
        const notice = message.value.slice(0, 200);
        if (Platform.OS === 'android') ToastAndroid.show(`${script.name}: ${notice}`, ToastAndroid.SHORT);
        else Alert.alert(script.name, notice);
      }
      if (typeof message.id === 'string' && message.id.length <= 100) {
        if (message.type === 'add' && typeof message.name === 'string' && registrations.current.size < 100) {
          registrations.current.set(message.id, { id: message.id, name: message.name.slice(0, 100), kind: message.kind });
        } else if (message.type === 'remove') registrations.current.delete(message.id);
        addCommands(script.id, Array.from(registrations.current.values(), item => ({
          label: `${script.name}: ${item.name}`,
          run: () => {
            if (item.kind === 'panel' || item.kind === 'settings') {
              setPanel(item.name);
              send({ type: 'view', id: item.id, app: appState });
              return;
            }
            if (pending.current) return;
            const state = latest.current;
            const id = ++sequence.current;
            pending.current = { id, path: state.currentFile, expected: state.content };
            send({ type: 'command', id: item.id, invocation: id, content: state.currentFile ? state.content : null, selection: pluginSelection, app: appState });
          },
        })));
      }
      const command = pending.current;
      if (!command || command.id !== message.invocation) return;
      if (message.type === 'edit' && typeof message.value === 'string' && message.value.length <= 2_000_000) {
        command.updated = message.value;
      } else if (message.type === 'done') {
        pending.current = undefined;
        const state = latest.current;
        if (command.path && command.path === state.currentFile && command.expected === state.content &&
            command.updated !== undefined && command.updated !== state.content) state.setContent(command.updated);
      }
    }} />
  </View>;
}

export function MobilePluginHost({ children }: { children: ReactNode }) {
  const { vault } = useApp();
  const path = vault?.path;
  return path && (Platform.OS === 'android' || Platform.OS === 'ios') ? <VaultHost key={path} path={path}>{children}</VaultHost> : <>{children}</>;
}

function VaultHost({ path, children }: { path: string; children: ReactNode }) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [commands, setCommands] = useState<Record<string, Command[]>>({});
  const addCommands = useRef((id: string, next: Command[]) =>
    setCommands(previous => ({ ...previous, [id]: next }))).current;
  useEffect(() => {
    let generation = 0;
    const load = async () => {
      const request = ++generation;
      const [installed, enabled] = await Promise.all([getInstalledPlugins(path), getEnabledPluginIds(path)]);
      const next = await Promise.all(installed.filter(p => p.mobileHost === true && enabled.includes(p.id) &&
        /^[a-z0-9_-]+$/i.test(p.id) && /^[a-z0-9._-]+\\.js$/i.test(p.main || 'main.js'))
        .map(async p => ({ id: p.id, name: p.name, code: await readFile(vaultFileUri(path, `.noteriv/plugins/${p.id}/${p.main || 'main.js'}`)) })));
      if (request === generation) setScripts(next.filter((p): p is Script => typeof p.code === 'string' && p.code.length <= 500_000));
    };
    const listener = pluginEvents.addListener('config', changed => {
      if (changed === path) void load();
    });
    void load();
    return () => { generation++; listener.remove(); };
  }, [path]);
  return <Commands.Provider value={scripts.flatMap(script => commands[script.id] ?? [])}>
    {children}
    {scripts.map(script => <Runtime key={script.id} script={script} addCommands={addCommands} />)}
  </Commands.Provider>;
}

const styles = StyleSheet.create({
  panel: { ...StyleSheet.absoluteFill, backgroundColor: '#fff', zIndex: 50, elevation: 12 },
  close: { padding: 16 },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
});
