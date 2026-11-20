import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveWikiLink } from '@/lib/wiki-links';
import { reset, writeFile } from './fakes/file-system.mjs';

test('opens Obsidian links from a note with encoded folder and file names', async () => {
  reset();
  const vault = 'file:///vault/';
  const home = vault + 'Prosjekt%20A/Hjem.md';
  const nearby = vault + 'Prosjekt%20A/Oversikt.md';
  const nested = vault + 'Arkiv/Norske%20navn/Bl%C3%A5%20b%C3%A5t.md';
  writeFile(home, '');
  writeFile(vault + 'Arkiv/Oversikt.md', '');
  writeFile(nearby, '');
  writeFile(nested, '');
  assert.equal(await resolveWikiLink('[[Oversikt.md#Plan|Vis planen]]', vault, home), nearby);
  assert.equal(await resolveWikiLink('[[Norske navn/Blå båt]]', vault, home), nested);
  assert.equal(await resolveWikiLink('../Arkiv/Norske%20navn/Bl%C3%A5%20b%C3%A5t.md', vault, home, true), nested);
  assert.equal(await resolveWikiLink('../../../Arkiv/Oversikt.md', vault, home, true), null);
});
