import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filePreviewKind } from '@/lib/file-preview';
import { fileDrawerScroll } from '@/lib/file-drawer-scroll';

test('opens common vault attachments in a read-only viewer regardless of extension case', () => {
  for (const [kind, files] of [
    ['image', ['photo.PNG', 'moving.GIF', 'photo.JPG', 'photo.HEIC', 'photo.WebP']],
    ['pdf', ['manual.PDF']],
    ['audio', ['voice.WAV', 'song.MP3', 'music.M4A', 'sample.FLAC', 'voice.opus']],
    ['video', ['Camera.MP4', 'clip.mov', 'film.MKV', 'capture.webm']],
    ['cad', ['Plater.FCStd', 'holder.STEP', 'key.stl']],
    ['external', ['Manual.docx', 'Budsjett.xlsx', 'backup.zip']],
  ]) {
    for (const name of files) assert.equal(filePreviewKind('file:///vault/Prosjekt/' + name), kind, name);
  }
  for (const name of ['README.md', 'plan.markdown', 'data.csv', 'code.ts']) assert.equal(filePreviewKind(name), null);
});

test('starts at the top, retains an offset, or reveals a selected file in a large list', () => {
  const vault = 'file:///vault';
  const files = Array.from({ length: 500 }, (_, index) => ({ path: vault + '/Mappe/Notat%20' + index + '.md', isDirectory: false }));
  assert.deepEqual(fileDrawerScroll(files, vault, undefined, 0, 48), { offset: 0, index: 0 });
  assert.deepEqual(fileDrawerScroll(files, vault, undefined, 820, 48), { offset: 820, index: 17 });
  assert.deepEqual(fileDrawerScroll(files, vault, 'Mappe/Notat 400.md', 820, 48), { offset: 0, index: 399 });
  assert.deepEqual(fileDrawerScroll(files, vault, 'missing.md', 0, 48), { offset: 0, index: 0 });
  assert.deepEqual(fileDrawerScroll(files.slice(0, 2), vault, undefined, 820, 48), { offset: 48, index: 1 });
});
