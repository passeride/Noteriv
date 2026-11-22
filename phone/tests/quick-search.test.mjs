import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QuickSearchCache, matchSearchFiles } from '@/lib/quick-search';

const vault = 'file:///vault';
const other = 'file:///other';
const file = (parent, name, folder = '') => ({
  filePath: parent + '/' + folder + name + '.md', fileName: name, relativePath: folder + name + '.md',
});
const alpha = file(vault, 'Alpha', 'Project Ø/');
const beta = file(vault, 'Beta');
const outside = file(other, 'Outside');

function fixture(budget) {
  const texts = new Map([[alpha.filePath, 'heading\nfirst test'], [beta.filePath, 'plain'], [outside.filePath, 'outside test']]);
  const reads = [];
  const cache = new QuickSearchCache({
    list: async path => path === vault ? [alpha, beta] : [outside],
    read: async path => { reads.push(path); return texts.get(path) ?? null; },
  }, budget);
  cache.reset(vault);
  const search = (term, draft) => cache.search(vault, term, new AbortController().signal, draft);
  return { cache, reads, texts, search };
}

test('finds names by prefix, fuzzy match or decoded path', () => {
  assert.deepEqual(matchSearchFiles([beta, alpha], 'alp'), [alpha]);
  assert.deepEqual(matchSearchFiles([alpha, beta], 'bta'), [beta]);
  assert.deepEqual(matchSearchFiles([alpha, beta], 'project ø'), [alpha]);
});

test('reuses note text and reloads only a changed note', async () => {
  const { cache, reads, texts, search } = fixture();
  assert.equal((await search('first'))[0].line, 2);
  assert.equal((await search('test')).length, 1);
  assert.equal(reads.length, 2);
  texts.set(alpha.filePath, 'updated test');
  cache.invalidate(alpha.filePath, false);
  assert.equal((await search('updated'))[0].line, 1);
  assert.equal((await search('first')).length, 0);
  assert.deepEqual(reads, [alpha.filePath, beta.filePath, alpha.filePath]);
});

test('uses unsaved editor text and keeps searching when the cache budget is full', async () => {
  const { search } = fixture(0);
  assert.equal((await search('first')).length, 1);
  assert.equal((await search('first', { path: alpha.filePath, text: 'new draft' })).length, 0);
  assert.equal((await search('draft', { path: alpha.filePath, text: 'new draft' }))[0].filePath, alpha.filePath);
});

test('switching vault drops cached files and pending reads', async () => {
  const { cache, search } = fixture();
  await search('test');
  cache.reset(other);
  assert.deepEqual(await cache.list(other), [outside]);
  const hits = await cache.search(other, 'test', new AbortController().signal);
  assert.deepEqual(hits.map(hit => hit.filePath), [outside.filePath]);
});

test('an invalidated read cannot replace a later result', async () => {
  let finish;
  let startRead;
  const started = new Promise(resolve => { startRead = resolve; });
  let count = 0;
  const cache = new QuickSearchCache({
    list: async () => [alpha],
    read: async () => ++count === 1
      ? new Promise(resolve => { finish = resolve; startRead(); })
      : 'new',
  });
  cache.reset(vault);
  const abort = new AbortController();
  const old = cache.search(vault, 'old', abort.signal);
  await started;
  cache.invalidate(alpha.filePath, false);
  abort.abort();
  assert.equal((await cache.search(vault, 'new', new AbortController().signal)).length, 1);
  finish('old');
  assert.deepEqual(await old, []);
  assert.equal((await cache.search(vault, 'new', new AbortController().signal)).length, 1);
  assert.equal(count, 2);
});
