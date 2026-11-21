import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, StyleSheet, ToastAndroid, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useApp } from '@/context/AppContext';
import { readFile } from '@/lib/file-system';
import { getEnabledPluginIds, getInstalledPlugins } from '@/lib/plugins';
import { pluginEvents } from '@/lib/plugin-events';
import { vaultFileUri } from '@/lib/sync-state';

type Command = { label: string; run: () => void };
const Commands = createContext<Command[]>([]);
export const usePluginCommands = () => useContext(Commands);

type Registration = { id: string; name: string };
type Script = { id: string; name: string; code: string };

function html(code: string): string {
  const escapedCode = JSON.stringify(code).replace(/</g, '\\u003c');
  return `<!doctype html><meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; base-uri 'none'; form-action 'none'">
    <script>
      const post = message => window.ReactNativeWebView.postMessage(JSON.stringify(message));
      const commands = new Map();
      const events = new Map();
      let content = null;
      let invocation = null;
      const api = {
        ui: {
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
        app: { platform: 'mobile' },
        markdown: { registerCodeBlockProcessor() {} },
      };
      function report(error) { api.ui.showNotice(String(error)); }
      window.noteriv = async data => {
        if (data.type === 'event') {
          if (invocation === null) content = data.content;
          api.events.emit(data.name, ...data.args);
        } else if (data.type === 'command' && invocation === null) {
          content = data.content;
          invocation = data.invocation;
          try { await commands.get(data.id)?.(); } catch (error) { report(error); }
          finally { post({ type: 'done', invocation }); invocation = null; }
        }
      };
      const module = { exports: {} };
      try {
        new Function('module', 'exports', ${escapedCode})(module, module.exports);
        Promise.resolve(module.exports.onLoad?.(api)).then(() => post({ type: 'ready' }), report);
      } catch (error) { report(error); }
    </script>`;
}

function Runtime({ script, addCommands }: { script: Script; addCommands: (id: string, commands: Command[]) => void }) {
  const { currentFile, content, setContent } = useApp();
  const web = useRef<WebView<object>>(null);
  const latest = useRef({ currentFile, content, setContent });
  latest.current = { currentFile, content, setContent };
  const registrations = useRef(new Map<string, Registration>());
  const sequence = useRef(0);
  const pending = useRef<{ id: number; path: string | null; expected: string; updated?: string } | undefined>(undefined);
  const [source] = useState(() => ({ html: html(script.code) }));
  const [ready, setReady] = useState(false);
  const send = (data: object) => web.current?.injectJavaScript(`window.noteriv(${JSON.stringify(data)});true;`);

  useEffect(() => {
    if (!ready) return;
    if (currentFile) send({ type: 'event', name: 'file-open', args: [currentFile], content: latest.current.content });
  }, [ready, currentFile]);
  useEffect(() => {
    if (!ready) return;
    const listener = pluginEvents.addListener('saved', path => {
      const state = latest.current;
      if (path === state.currentFile) send({ type: 'event', name: 'file-save', args: [path], content: state.content });
    });
    return () => listener.remove();
  }, [ready]);
  useEffect(() => () => addCommands(script.id, []), [addCommands, script.id]);

  return <WebView<object> ref={web} source={source} javaScriptEnabled domStorageEnabled={false}
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
    originWhitelist={['*']} onShouldStartLoadWithRequest={r => r.url === 'about:blank' || r.url.startsWith('data:')}
    setSupportMultipleWindows={false} mixedContentMode="never"
    onMessage={event => {
      let message;
      try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') setReady(true);
      if (message.type === 'notice' && typeof message.value === 'string') {
        const notice = message.value.slice(0, 200);
        if (Platform.OS === 'android') ToastAndroid.show(`${script.name}: ${notice}`, ToastAndroid.SHORT);
        else Alert.alert(script.name, notice);
      }
      if (typeof message.id === 'string' && message.id.length <= 100) {
        if (message.type === 'add' && typeof message.name === 'string' && registrations.current.size < 100) {
          registrations.current.set(message.id, { id: message.id, name: message.name.slice(0, 100) });
        } else if (message.type === 'remove') registrations.current.delete(message.id);
        addCommands(script.id, Array.from(registrations.current.values(), item => ({
          label: `${script.name}: ${item.name}`,
          run: () => {
            if (pending.current) return;
            const state = latest.current;
            const id = ++sequence.current;
            pending.current = { id, path: state.currentFile, expected: state.content };
            send({ type: 'command', id: item.id, invocation: id, content: state.currentFile ? state.content : null });
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
    }} />;
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
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.hidden}>
      {scripts.map(script => <Runtime key={script.id} script={script} addCommands={addCommands} />)}
    </View>
  </Commands.Provider>;
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' },
});
