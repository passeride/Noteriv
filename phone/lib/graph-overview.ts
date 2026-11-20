export function graphOverview<Node extends { id: string }, Edge extends { source: string; target: string }>(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const maxNodes = 220;
  const maxEdges = 750;
  if (nodes.length <= maxNodes && edges.length <= maxEdges) return { nodes, edges };
  const degree = new Map<string, number>();
  for (const { source, target } of edges) {
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }
  const count = (id: string) => degree.get(id) ?? 0;
  const selected = [...nodes].sort((a, b) => count(b.id) - count(a.id)).slice(0, maxNodes);
  const visible = new Set(selected.map(node => node.id));
  const connections = edges.filter(edge => visible.has(edge.source) && visible.has(edge.target));
  if (connections.length > maxEdges) {
    connections.sort((a, b) => count(b.source) + count(b.target) - count(a.source) - count(a.target));
  }
  return { nodes: selected, edges: connections.slice(0, maxEdges) };
}
