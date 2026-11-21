export type PluginBlock = { code: string; language: string; sourcePath: string | null; color: string };

export function mobilePluginDocument(code: string, block?: PluginBlock): string {
  const input = JSON.stringify({ code, block }).replace(/</g, '\\u003c');
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'">
    <body style="margin:0;padding:12px"><main></main><script>
    (() => {
      const input = ${input};
      const send = data => window.ReactNativeWebView.postMessage(JSON.stringify(data));
      const commands = new Map(), views = new Map(), processors = new Map();
      const events = new Map(), requests = new Map();
      const app = { platform: 'mobile', version: '', currentFile: null, vaultPath: null };
      const main = document.querySelector('main');
      let nextRequest = 0, snapshot = null, invocation = null, cleanup, started = false;
      let editScheduled = false, stopped = false;

      function request(operation, path = '', content) {
        return new Promise((resolve, reject) => {
          const id = ++nextRequest;
          requests.set(id, { resolve, reject });
          send({ type: 'vault', operation, path, content, request: id });
        });
      }
      function register(kind, item, name, callback) {
        if (input.block || !item || typeof item.id !== 'string' || typeof name !== 'string' ||
            typeof callback !== 'function' || !item.id || item.id.length > 100) return;
        const id = kind + ':' + item.id;
        const target = kind === 'settings' || kind === 'panel' ? views : commands;
        target.set(id, callback);
        send({ type: 'add', id, name, kind, hotkey: item.hotkey, title: item.title });
      }
      function remove(kind, id) {
        const key = kind + ':' + id;
        (kind === 'settings' || kind === 'panel' ? views : commands).delete(key);
        if (!input.block) send({ type: 'remove', id: key });
      }
      function applyText(content, selection) {
        if (typeof content !== 'string' || !snapshot?.app.currentFile) return;
        snapshot = { ...snapshot, content, selection };
        if (invocation !== null) {
          send({ type: 'edit', invocation, content, selection });
        } else if (!editScheduled) {
          editScheduled = true;
          const revision = snapshot.revision;
          Promise.resolve().then(() => {
            editScheduled = false;
            if (revision === snapshot?.revision) {
              send({ type: 'event-edit', revision, content: snapshot.content, selection: snapshot.selection });
            }
          });
        }
      }
      function splice(text, replace) {
        if (typeof text !== 'string' || typeof snapshot?.content !== 'string') return;
        const { start, end } = snapshot.selection;
        const from = replace ? start : end;
        const caret = from + text.length;
        applyText(snapshot.content.slice(0, from) + text + snapshot.content.slice(end), { start: caret, end: caret });
      }
      function notify(message, duration) { send({ type: 'notice', value: String(message), duration }); }
      function report(error) { notify(String(error)); }
      function emit(name, ...args) {
        for (const callback of events.get(name) ?? []) {
          try { Promise.resolve(callback(...args)).catch(report); } catch (error) { report(error); }
        }
      }
      function update(data) {
        if (!data) return;
        Object.assign(app, data.app);
        if (invocation === null) snapshot = data;
      }
      async function close() {
        const dispose = cleanup;
        cleanup = undefined;
        try { if (typeof dispose === 'function') await dispose(); }
        finally { main.replaceChildren(); }
      }
      const api = {
        vault: {
          read: path => request('read', path), write: (path, text) => request('write', path, text),
          list: path => request('list', path), exists: path => request('exists', path),
          delete: path => request('delete', path),
        },
        ui: {
          addCommand: item => register('command', item, item?.name, item?.callback),
          removeCommand: id => remove('command', id),
          addSidebarPanel: item => register('panel', item, item?.title, item?.render),
          removeSidebarPanel: id => remove('panel', id),
          addSettingsTab: item => register('settings', item, item?.name, item?.render),
          removeSettingsTab: id => remove('settings', id),
          addStatusBarItem: item => register('status', item, item?.text, item?.onClick ?? (() => {})),
          removeStatusBarItem: id => remove('status', id),
          showNotice: notify,
        },
        editor: {
          getContent: () => snapshot?.content ?? null,
          getSelection: () => snapshot?.content?.slice(snapshot.selection.start, snapshot.selection.end) ?? '',
          getCursorPosition() {
            const lines = (snapshot?.content ?? '').slice(0, snapshot?.selection.end ?? 0).split('\\n');
            return { line: lines.length, ch: lines.at(-1).length };
          },
          replaceSelection: text => splice(text, true),
          insertAtCursor: text => splice(text, false),
          setContent: text => applyText(text, { start: 0, end: 0 }),
        },
        events: {
          on(name, callback) {
            if (typeof callback !== 'function') return;
            if (!events.has(name)) events.set(name, new Set());
            events.get(name).add(callback);
          },
          off(name, callback) { events.get(name)?.delete(callback); },
          emit(name, ...args) {
            emit(name, ...args);
            if (!input.block) send({ type: 'event', name, args });
          },
        },
        app,
        markdown: {
          registerCodeBlockProcessor(language, processor) {
            if (typeof language !== 'string' || typeof processor !== 'function') return;
            const name = language.trim().toLowerCase();
            if (!name || name === 'dataview' || name === 'mermaid') return;
            processors.set(name, processor);
            if (!input.block) send({ type: 'languages', languages: [...processors.keys()] });
          },
          unregisterCodeBlockProcessor(language) {
            if (typeof language !== 'string') return;
            processors.delete(language.trim().toLowerCase());
            if (!input.block) send({ type: 'languages', languages: [...processors.keys()] });
          },
        },
      };
      const module = { exports: {} };
      window.noteriv = async data => {
        if (data.type === 'response') {
          const callback = requests.get(data.request);
          requests.delete(data.request);
          if (data.error) callback?.reject(new Error(data.error));
          else callback?.resolve(data.value);
          return;
        }
        if (stopped) return;
        update(data.snapshot);
        try {
          if (data.type === 'start' && !started) {
            started = true;
            new Function('module', 'exports', '"use strict";' + input.code)(module, module.exports);
            await module.exports.onLoad?.(api);
            if (stopped) return;
            if (input.block) {
              const { code, language, sourcePath, color } = input.block;
              document.body.style.backgroundColor = color;
              const processor = processors.get(language);
              if (!processor) main.textContent = code;
              else cleanup = await processor(code, main, { source: code, language, sourcePath });
              new ResizeObserver(() => send({ type: 'height', height: document.body.scrollHeight + 24 })).observe(main);
            }
            send({ type: 'ready' });
          } else if (data.type === 'stop') {
            stopped = true;
            try { await close(); } finally { await module.exports.onUnload?.(); }
          } else if (data.type === 'close') {
            await close();
          } else if (data.type === 'view') {
            await close();
            cleanup = await views.get(data.id)?.(main);
          } else if (data.type === 'event') {
            emit(data.name, ...data.args);
          } else if (data.type === 'command' && invocation === null) {
            invocation = data.invocation;
            try { await commands.get(data.id)?.(); }
            finally { send({ type: 'done', invocation }); invocation = null; }
          }
        } catch (error) {
          if (input.block) main.textContent = String(error);
          report(error);
        } finally {
          if (data.type === 'stop') send({ type: 'stopped' });
        }
      };
      send({ type: 'boot' });
    })();
    </script></body>`;
}
