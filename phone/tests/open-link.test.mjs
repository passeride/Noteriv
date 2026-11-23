import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { redirectSystemPath } from '@/app/+native-intent';
import { resolveOpenLink } from '@/lib/open-link';
import { vaultFileUri } from '@/lib/sync-state';
import { reset, writeFile } from './fakes/file-system.mjs';

const main = { id: 'notes', name: 'Main', path: 'file:///vaults/main/', gitRemote: 'git@github.com:Passeride/Obsidian.git' };
const other = { id: 'other', name: 'Work', path: 'file:///vaults/work/', gitRemote: 'https://github.com/passeride/work' };
const vaults = [main, other];
const home = vaultFileUri(main.path, 'Home.md');
const rutiner = '📥 Rutiner og fangst';

function paramsFromLink(link) {
  const route = redirectSystemPath({ path: link });
  const url = new URL(route, 'file:///');
  assert.equal(url.pathname, '/open');
  return { ...Object.fromEntries(url.searchParams), '#': url.hash.slice(1) };
}

beforeEach(() => {
  reset();
  writeFile(home, `## ${rutiner}\nNotes\n`);
});

test('both native URL forms open the note and preserve the emoji heading', async () => {
  for (const slashes of ['//', '///']) {
    const params = paramsFromLink(`noteriv:${slashes}open?vault=main&file=Home.md&heading=${encodeURIComponent(rutiner)}`);
    const target = await resolveOpenLink(params, vaults, other);
    assert.equal(target.vault, main);
    assert.equal(target.path, home);
    assert.equal(target.heading, rutiner);
  }
});

test('a GitHub HTTPS link resolves a vault with an SSH remote and a different local name', async () => {
  const renamed = { ...main, name: 'My notes on this phone' };
  const params = paramsFromLink('noteriv://open?repo=https%3A%2F%2Fgithub.com%2Fpasseride%2Fobsidian&file=Home.md');
  const target = await resolveOpenLink(params, [renamed, other], other);
  assert.equal(target.vault, renamed);
  assert.equal(target.path, home);
  assert.equal(target.heading, undefined);
});

test('encoding preserves a note or heading containing reserved characters and literal percent escapes', async () => {
  const note = 'Folder & work/C++ 50%20.md';
  const path = vaultFileUri(main.path, note);
  const heading = 'A & B + C';
  writeFile(path, `## ${heading}`);
  const params = paramsFromLink(`noteriv://open?file=${encodeURIComponent(note)}#${encodeURIComponent(heading)}`);
  const target = await resolveOpenLink(params, vaults, main);
  assert.equal(target.path, path);
  assert.equal(target.heading, heading);
});

test('an unmatched or ambiguous repository cannot fall back to the wrong vault', async () => {
  await assert.rejects(resolveOpenLink({ repo: 'https://example.com/other/notes' }, vaults, main), /No vault/);
  await assert.rejects(resolveOpenLink({ repo: 'https://github.com/passeride/obsidian' }, [
    ...vaults, { ...main, id: 'another-clone' },
  ], main), /Several vaults/);
});

test('an external link cannot open a file outside the selected vault or in its private metadata', async () => {
  for (const file of ['/outside.md', '../other/Note.md', 'notes/../Home.md', '.noteriv/Note.md', 'file:///outside.md']) {
    await assert.rejects(resolveOpenLink({ file }, vaults, main), /inside the vault/);
  }
  await assert.rejects(resolveOpenLink({ file: 'Missing.md' }, vaults, main), /not found/);
});
