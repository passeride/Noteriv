import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { mobilePluginDocument } from '@/lib/mobile-plugin-document';
import { pluginShortcut } from '@/lib/plugin-shortcuts';

const snapshot = {
  revision: 1,
  content: 'first\nsecond',
  selection: { start: 6, end: 9 },
  app: { currentFile: 'Note.md', vaultPath: 'vault', version: '1.1.0' },
};

function open(code, block) {
  const messages = [];
  const children = [];
  const main = {
    textContent: '',
    append(item) { children.push(item); },
    replaceChildren() { children.length = 0; },
  };
  const window = { ReactNativeWebView: { postMessage: value => messages.push(JSON.parse(value)) } };
  const document = { querySelector: () => main, createElement: () => ({ textContent: '' }), body: { style: {}, scrollHeight: 60 } };
  const html = mobilePluginDocument(code, block);
  assert.equal(html.split('</script>').length, 2);
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  runInNewContext(js, { window, document, atob, ResizeObserver: class { observe() {} } });
  return { messages, main, send: window.noteriv };
}

test('runs the same CommonJS plugin with command, panel, settings, status, events and cleanup', async () => {
  const { messages, send, main } = open(`
    module.exports.onLoad = api => {
      api.ui.addCommand({ id: 'replace', name: 'Replace', hotkey: 'Ctrl+Shift+X', callback: () => {
        api.ui.showNotice(api.editor.getSelection());
        api.editor.replaceSelection('</script>');
      } });
      api.ui.addSidebarPanel({ id: 'preview', title: 'Preview', render: element => {
        element.textContent = api.app.currentFile;
        return () => api.ui.showNotice('panel disposed');
      } });
      api.ui.addStatusBarItem({ id: 'status', text: 'Ready' });
      api.ui.addSettingsTab({ id: 'prefs', name: 'Preferences', render: () => {} });
      api.events.on('file-save', path => api.events.emit('custom', path));
    };
    module.exports.onUnload = () => {};
  `);
  await send({ type: 'start', snapshot });
  assert.deepEqual(messages.filter(item => item.type === 'add').map(item => item.kind),
    ['command', 'panel', 'status', 'settings']);
  await send({ type: 'command', id: 'command:replace', snapshot, invocation: 1 });
  assert.deepEqual(messages.find(item => item.type === 'edit'), {
    type: 'edit', invocation: 1, content: 'first\n</script>ond', selection: { start: 15, end: 15 },
  });
  await send({ type: 'view', id: 'panel:preview', snapshot });
  assert.equal(main.textContent, 'Note.md');
  await send({ type: 'event', name: 'file-save', args: ['Note.md'], snapshot });
  assert.deepEqual(messages.find(item => item.type === 'event'), { type: 'event', name: 'custom', args: ['Note.md'] });
  await send({ type: 'stop' });
  assert.ok(messages.some(item => item.type === 'notice' && item.value === 'panel disposed'));
  assert.equal(messages.at(-1).type, 'stopped');
});

test('awaits the bridge for vault reads and discovers renderers without a manifest language', async () => {
  const source = `exports.onLoad = async api => {
    const prefix = await api.vault.read('prefix.txt');
    api.markdown.registerCodeBlockProcessor('sample', (text, target, context) => {
      target.textContent = prefix + ':' + text + ':' + context.sourcePath;
    });
  }`;
  for (const block of [undefined, { code: '</script>', language: 'sample', sourcePath: 'Note.md', color: '#222' }]) {
    const { messages, send, main } = open(source, block);
    const loading = send({ type: 'start', snapshot });
    const request = messages.find(item => item.type === 'vault');
    assert.equal(request.path, 'prefix.txt');
    await send({ type: 'response', request: request.request, value: 'Read' });
    await loading;
    if (block) assert.equal(main.textContent, 'Read:</script>:Note.md');
    else assert.deepEqual(messages.find(item => item.type === 'languages').languages, ['sample']);
  }
});

test('normalizes keyboard shortcut syntax for native dispatch', () => {
  assert.equal(pluginShortcut('Shift+Ctrl+X', 'android'), 'ctrl+shift+x');
  assert.equal(pluginShortcut('Mod+Option+Left', 'ios'), 'alt+meta+arrowleft');
  assert.equal(pluginShortcut('Unsupported+Q', 'android'), undefined);
});

test('requests bundled text assets through the mobile bridge', async () => {
  const { messages, send } = open(`
    module.exports.onLoad = async api => {
      api.ui.showNotice(await api.assets.readText('engine-0.txt'));
    };
  `);
  const loading = send({ type: 'start', snapshot });
  const request = messages.find(item => item.type === 'vault');
  assert.equal(request.operation, 'readAsset');
  assert.equal(request.path, 'engine-0.txt');
  await send({ type: 'response', request: request.request, value: 'engine text' });
  await loading;
  assert.ok(messages.some(item => item.type === 'notice' && item.value === 'engine text'));
});

test('reads binary model bytes through the mobile plugin bridge', async () => {
  const { messages, send, main } = open(`
    module.exports.onLoad = api => {
      api.markdown.registerCodeBlockProcessor('cad', async (path, target) => {
        const bytes = await api.vault.readBinary(path);
        target.textContent = bytes.join(',');
      });
    };
  `, { code: 'Vedlegg/model.stl', language: 'cad', sourcePath: null, color: '#222' });
  const loading = send({ type: 'start', snapshot });
  await Promise.resolve();
  const request = messages.find(item => item.type === 'vault');
  assert.equal(request.operation, 'readBinary');
  assert.equal(request.path, 'Vedlegg/model.stl');
  await send({ type: 'response', request: request.request, value: 'AID/' });
  await loading;
  assert.equal(main.textContent, '0,128,255');
});
