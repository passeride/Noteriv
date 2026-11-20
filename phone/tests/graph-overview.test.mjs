import assert from 'node:assert/strict';
import { test } from 'node:test';
import { graphOverview } from '@/lib/graph-overview';

test('keeps small graphs intact', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  const edges = [{ source: 'a', target: 'b' }];
  assert.deepEqual(graphOverview(nodes, edges), { nodes, edges });
});

test('bounds a dense vault and preserves the full input for search', () => {
  const nodes = Array.from({ length: 1400 }, (_, id) => ({ id: String(id) }));
  const edges = [];
  for (let source = 0; source < nodes.length; source++) {
    for (let jump = 1; jump <= 8; jump++) edges.push({ source: String(source), target: String((source + jump) % nodes.length) });
  }
  const result = graphOverview(nodes, edges);
  const visible = new Set(result.nodes.map(node => node.id));
  assert.equal(visible.size, 220);
  assert.equal(result.edges.length, 750);
  assert.ok(result.edges.every(edge => visible.has(edge.source) && visible.has(edge.target)));
  assert.equal(nodes.length, 1400);
  assert.equal(edges.length, 11200);
});
