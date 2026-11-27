import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileForwardHistory, fileSwipeAction } from '@/lib/file-navigation';

test('separates the forward swipe from the command and file gestures', () => {
  assert.equal(fileSwipeAction(22, 400, 59, 8, false), 'files');
  assert.equal(fileSwipeAction(210, 400, 59, 8, false), 'files');
  assert.equal(fileSwipeAction(375, 400, -52, 8, false), 'forward');
  assert.equal(fileSwipeAction(215, 400, -54, 8, false), 'commands');
  assert.equal(fileSwipeAction(215, 400, -54, 8, true), null);
  assert.equal(fileSwipeAction(375, 400, -59, 48, true), null);
});

test('a series of back actions can be replayed in order even with new route keys', () => {
  const history = new FileForwardHistory();
  const a = { key: 'root' }, b = { key: 'b' }, c = { key: 'c' };
  history.back(c, b, { path: 'C.md', heading: 'About' });
  history.back(b, a, { path: 'B.md', line: '12' });
  assert.equal(history.forward(c), undefined);
  const restoredB = history.forward(a);
  assert.equal(restoredB.path, 'B.md');
  assert.equal(restoredB.line, '12');
  const restoredFrame = { key: 'b2', fileForward: restoredB.fileForward };
  const restoredC = history.forward(restoredFrame);
  assert.equal(restoredC.path, 'C.md');
  assert.equal(restoredC.heading, 'About');
  assert.equal(history.forward({ key: 'c2', fileForward: restoredC.fileForward }), undefined);
});

test('a newly opened file discards the old forward branch', () => {
  const history = new FileForwardHistory();
  const a = { key: 'a' };
  history.back({ key: 'b' }, a, { path: 'B.md' });
  history.clear();
  assert.equal(history.forward(a), undefined);
});
