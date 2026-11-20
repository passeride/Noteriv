// Exercise the open editor against the native sync adapter.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

import { setRemoteNote, getRemoteNote, resetRemote } from './fakes/noteriv-git.mjs';
import { container } from './fakes/page.mjs';
import * as FS from './fakes/file-system.mjs';
import * as Storage from './fakes/storage.mjs';

const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { AppProvider, useApp } = await import('@/context/AppContext');
const { vaultFileUri } = await import('@/lib/sync-state');

const VAULT = 'file:///data/vaults/Notes/';
const NOTE = vaultFileUri(VAULT, 'Note.md');
let app;
let root;

function Probe() {
  app = useApp();
  return null;
}

async function type(text) {
  for (const letter of text) await act(async () => { app.setContent(app.content + letter); });
}

/** Let the one-minute sync fire and run to its end. */
async function sync() {
  await act(async () => { mock.timers.tick(60_000); });
  for (let i = 0; i < 50; i++) await act(async () => { await new Promise((done) => setImmediate(done)); });
}

/** The note is changed on another device and pushed. */
function desktopWrites(text) {
  setRemoteNote(text);
}

const notes = () => Object.fromEntries(Object.entries(FS.snapshot(VAULT)).filter(([path]) => !path.startsWith('.noteriv/')));

beforeEach(async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  FS.reset();
  resetRemote();
  const vault = { id: 'v1', name: 'Notes', path: VAULT, gitRemote: 'https://git.example/me/notes', gitBranch: 'main', autoSync: true, lastOpened: 0 };
  await Storage.setItem(Storage.KEYS.SETTINGS, { pullOnOpen: true, gitSyncInterval: 60 });
  await Storage.setItem(Storage.KEYS.VAULTS, [vault]);
  await Storage.setItem(Storage.KEYS.ACTIVE_VAULT, vault.id);
  await Storage.setItem(Storage.KEYS.SETUP_COMPLETE, true);
  await Storage.setItem(Storage.KEYS.GIT_TOKEN(vault.id), 'test-token');

  root = createRoot(container());
  await act(async () => { root.render(React.createElement(AppProvider, null, React.createElement(Probe))); });
  // The pull that runs when the vault opens brings the note down.
  for (let i = 0; i < 50; i++) await act(async () => { await new Promise((done) => setImmediate(done)); });
  assert.equal(await FS.readFile(NOTE), 'first version');
  await act(async () => { await app.setCurrentFile(NOTE); });
  assert.equal(app.content, 'first version');
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  mock.timers.reset();
});

test('a newer version pulled by sync shows in the open note', async () => {
  desktopWrites('changed on the desktop');
  await sync();
  assert.equal(app.content, 'changed on the desktop');
  assert.equal(app.isDirty, false);
});

test('the next edit builds on the pulled version, so the desktop change survives', async () => {
  desktopWrites('changed on the desktop');
  await sync();
  await type(' and on the phone');
  await sync();
  assert.equal(getRemoteNote(), 'changed on the desktop and on the phone');
});

test('sync uploads what is in the editor, not what was last saved', async () => {
  await type(' typed and not saved yet');
  await sync();
  assert.equal(getRemoteNote(), 'first version typed and not saved yet');
  assert.equal(app.isDirty, false);
});

test('unsaved text meets a remote change: both are kept', async () => {
  await type(' typed on the phone');
  desktopWrites('changed on the desktop');
  await sync();
  assert.equal(app.content, 'first version typed on the phone');
  const kept = Object.values(notes());
  assert.ok(kept.includes('first version typed on the phone'), JSON.stringify(notes()));
  assert.ok(kept.includes('changed on the desktop'), JSON.stringify(notes()));
});

test('leaving and reopening a note restores its content after a pending read', async () => {
  const other = vaultFileUri(VAULT, 'Linked.md');
  FS.writeFile(other, 'Linked note');
  await act(async () => {
    const pending = app.setCurrentFile(other);
    await app.setCurrentFile(null);
    await pending;
  });
  assert.equal(app.currentFile, null);

  await act(async () => { await app.setCurrentFile(NOTE); });
  assert.equal(app.currentFile, NOTE);
  assert.equal(app.content, 'first version');
});
