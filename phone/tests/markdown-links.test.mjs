import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInline } from '@/lib/markdown-inline';
import { markdownLinkTarget } from '@/lib/markdown-links';

test('recognizes external Markdown and autolinks without including surrounding punctuation', () => {
  const nodes = parseInline(
    '[Link](https://example.test/topic_(one)#anchor "Title"), <https://example.test/a_b>, ' +
    'and (HTTPS://example.test/a_(b)?x=1&y=2#heading).'
  );
  const links = nodes.filter(node => node.type === 'link').map(node => markdownLinkTarget(node.url));
  assert.deepEqual(links, [
    { kind: 'external', url: 'https://example.test/topic_(one)#anchor' },
    { kind: 'external', url: 'https://example.test/a_b' },
    { kind: 'external', url: 'https://example.test/a_(b)?x=1&y=2#heading' },
  ]);
  assert.equal(nodes.at(-1).text, ').');
});

test('retains internal Markdown and wiki links and leaves code alone', () => {
  const nodes = parseInline('[Note](./Topic.md#Heading) [[Home]] `https://example.test`');
  assert.deepEqual(markdownLinkTarget(nodes[0].url), { kind: 'note', url: './Topic.md#Heading' });
  assert.deepEqual(markdownLinkTarget('#Heading'), { kind: 'note', url: '#Heading' });
  assert.ok(nodes.some(node => node.type === 'wikilink' && node.name === 'Home'));
  assert.equal(nodes.filter(node => node.type === 'link').length, 1);
});

test('uses the system handler for web, mail, and phone destinations only', () => {
  for (const url of ['mailto:me@example.test', 'tel:+4712345678']) {
    assert.deepEqual(markdownLinkTarget(url), { kind: 'external', url });
  }
  assert.deepEqual(markdownLinkTarget('//example.test/path'), { kind: 'external', url: 'https://example.test/path' });
  for (const url of ['https://', 'file:///local', 'javascript:example', 'data:text/plain,example', 'https://example.test/\ninvalid']) {
    assert.equal(markdownLinkTarget(url), null);
  }
});
