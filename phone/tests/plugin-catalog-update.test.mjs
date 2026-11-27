import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installCatalogPlugin, isCatalogUpdate } from '../../packages/plugin-catalog/catalog.ts';

const source = { repository: 'passeride/SyvendeSans', branch: 'noteriv-plugins' };
const entry = { id: 'cad-viewer', name: 'CAD Viewer', author: 'SyvendeSans', source, version: '0.3.0',
  revision: 'a'.repeat(40), dir: 'plugins/cad-viewer', files: ['engine.txt'] };
const older = { id: entry.id, name: entry.name, author: entry.author, version: '0.2.0' };

test('offers a newer version for legacy catalog installs and respects saved source', () => {
  assert.equal(isCatalogUpdate(older, entry), true);
  assert.equal(isCatalogUpdate({ ...older, name: 'Local CAD' }, entry), false);
  assert.equal(isCatalogUpdate({ ...older, catalogSource: { ...source, branch: 'main' } }, entry), false);
  assert.equal(isCatalogUpdate({ ...older, version: entry.version }, entry), false);
  assert.equal(isCatalogUpdate({ ...older, version: '0.3.0-rc.1', catalogSource: source }, entry), true);
});

test('stages the full update and keeps the old package if downloading or publishing fails', async t => {
  let missing = true;
  let manifestVersion = entry.version;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.endsWith('/manifest.json')) return Response.json({ ...older, version: manifestVersion });
    if (url.endsWith('/main.js')) return new Response('module.exports = {}');
    return new Response('new engine', { status: missing ? 404 : 200 });
  });
  let staged, installed = new Map([['engine.txt', 'old engine']]);
  let allowPublish = false;
  const io = {
    hasPlugin: () => true,
    createStage: () => { staged = new Map(); return true; },
    write: (name, text) => { staged.set(name, text); return true; },
    publish: () => {
      if (!allowPublish) return false;
      installed = staged;
      return true;
    },
    discardStage: () => { staged = undefined; },
  };
  await assert.rejects(installCatalogPlugin(entry, io, true), /HTTP 404/);
  assert.equal(staged, undefined);
  missing = false;
  manifestVersion = '0.2.0';
  await assert.rejects(installCatalogPlugin(entry, io, true), /version does not match/);
  manifestVersion = entry.version;
  await assert.rejects(installCatalogPlugin(entry, io, true), /Unable to update/);
  assert.equal(staged, undefined);
  assert.equal(installed.get('engine.txt'), 'old engine');
  allowPublish = true;
  await installCatalogPlugin(entry, io, true);
  assert.equal(installed.get('engine.txt'), 'new engine');
  assert.deepEqual(JSON.parse(installed.get('manifest.json')).catalogSource, source);
});
