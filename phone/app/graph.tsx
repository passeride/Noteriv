import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useApp } from '@/context/AppContext';
import { WebView } from 'react-native-webview';
import { listAllMarkdownFiles, readFile } from '@/lib/file-system';
import { findWikiLinks } from '@/lib/wiki-links';
import { vaultRelativePath } from '@/lib/sync-state';

interface GraphNode {
  id: string;
  label: string;
  path: string;
}

interface GraphEdge {
  source: string;
  target: string;
  reciprocal: boolean;
}

type VaultGraph = { path: string; nodes: GraphNode[]; edges: GraphEdge[] };
let lastGraph: VaultGraph | null = null;

export default function GraphScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { vault } = useApp();

  const vaultPath = vault?.path;
  const [graph, setGraph] = useState<VaultGraph | null>(() => lastGraph?.path === vaultPath ? lastGraph : null);
  const [progress, setProgress] = useState<{ path: string; read: number; total: number }>();
  const [failedPath, setFailedPath] = useState<string>();

  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    const yieldToUI = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    void (async () => {
      await yieldToUI();
      if (cancelled) return;
      const files = await listAllMarkdownFiles(vaultPath);
      if (cancelled) return;
      setProgress({ path: vaultPath, read: 0, total: files.length });
      const nodes = files.map(f => ({ id: f.filePath, path: f.filePath, label: f.fileName }));
      const key = (name: string) => name.replace(/\.(md|markdown)$/i, '').normalize('NFC').toLowerCase();
      const paths = new Map<string, string>();
      const names = new Map<string, string>();
      for (const file of files) {
        paths.set(key(vaultRelativePath(vaultPath, file.filePath)), file.filePath);
        if (!names.has(key(file.fileName))) names.set(key(file.fileName), file.filePath);
      }
      const targets = new Map<string, Set<string>>();
      for (let i = 0; i < files.length; i += 12) {
        if (cancelled) return;
        const batch = files.slice(i, i + 12);
        const contents = await Promise.all(batch.map(f => readFile(f.filePath)));
        if (cancelled) return;
        batch.forEach((file, index) => {
          const links = new Set<string>();
          for (const { target } of findWikiLinks(contents[index] ?? '')) {
            const name = key(target.trim().replace(/^\//, ''));
            const destination = paths.get(name) ?? names.get(name);
            if (destination && destination !== file.filePath) links.add(destination);
          }
          if (links.size) targets.set(file.filePath, links);
        });
        setProgress({ path: vaultPath, read: i + batch.length, total: files.length });
        await yieldToUI();
      }

      const connected = new Set<string>();
      const edges: GraphEdge[] = [];
      for (const [source, destinations] of targets) {
        for (const target of destinations) {
          const reciprocal = targets.get(target)?.has(source) ?? false;
          if (reciprocal && source > target) continue;
          connected.add(source);
          connected.add(target);
          edges.push({ source, target, reciprocal });
        }
      }
      if (!cancelled) {
        const next = { path: vaultPath, nodes: nodes.filter(n => connected.has(n.id)), edges };
        if (lastGraph?.path !== vaultPath ||
          JSON.stringify([lastGraph.nodes, lastGraph.edges]) !== JSON.stringify([next.nodes, next.edges])) {
          lastGraph = next;
        }
        setGraph(lastGraph);
        setProgress(undefined);
      }
    })().catch(() => {
      if (!cancelled) setFailedPath(vaultPath);
    });
    return () => { cancelled = true; };
  }, [vaultPath]);

  const current = graph?.path === vaultPath ? graph : null;
  const source = useMemo(() => current?.nodes.length
    ? { html: buildGraphHTML(current.nodes, current.edges, colors) }
    : null, [current, colors]);

  const handleMessage = useCallback((event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'nodeClick' && data.path) {
        router.push({ pathname: '/editor', params: { path: data.path } });
      }
    } catch {}
  }, [router]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]}>
      <View style={[styles.header, { backgroundColor: colors.bgSecondary, borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Graph View</Text>
        <View style={{ width: 40 }} />
      </View>

      {source ? (
        <WebView
          source={source}
          style={{ backgroundColor: colors.bgPrimary }}
          originWhitelist={['*']}
          onMessage={handleMessage}
          scrollEnabled={false}
          startInLoadingState
          renderLoading={() => (
            <View style={[styles.loadingOverlay, { backgroundColor: colors.bgPrimary }]}>
              <ActivityIndicator size="large" color={colors.accent} />
              <Text style={{ color: colors.textMuted, marginTop: 12 }}>Drawing graph…</Text>
            </View>
          )}
        />
      ) : (
        <View style={styles.center}>
          {vaultPath && !current && failedPath !== vaultPath && (
            <ActivityIndicator size="large" color={colors.accent} />
          )}
          <Text style={{ color: colors.textMuted, marginTop: 12 }}>
            {!vaultPath ? 'No vault selected' : current ? 'No linked notes' :
              failedPath === vaultPath ? 'Could not build the graph' : progress && progress.path === vaultPath
                ? `Reading notes… ${progress.read} / ${progress.total}` : 'Finding notes…'}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function buildGraphHTML(
  nodes: GraphNode[],
  edges: GraphEdge[],
  colors: ReturnType<typeof useTheme>['colors']
): string {
  const serialize = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<style>
  * { margin: 0; padding: 0; }
  body { background: ${colors.bgPrimary}; overflow: hidden; touch-action: none; }
  canvas { display: block; width: 100vw; height: 100vh; }
  .legend { position: fixed; left: 12px; bottom: 12px; display: flex; gap: 12px; padding: 5px 9px; border: 1px solid ${colors.border}; border-radius: 6px; background: ${colors.bgSecondary}; color: ${colors.textMuted}; font: 11px -apple-system, sans-serif; }
  .legend b { color: ${colors.accent}; font-size: 14px; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<div class="legend"><span><b>→</b> one-way</span><span><b>↔</b> reciprocal</span></div>
<script>
let W = 0, H = 0;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const nodes = ${serialize(nodes)};
const edges = ${serialize(edges)};
const nodeMap = Object.create(null);
nodes.forEach((n) => { nodeMap[n.id] = n; });

function resize() {
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const scale = Math.min(window.devicePixelRatio || 1, Math.sqrt(5000000 / (width * height)));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  nodes.forEach(n => {
    if (!W || !H) {
      n.x = width * (0.2 + Math.random() * 0.6);
      n.y = height * (0.2 + Math.random() * 0.6);
      n.vx = 0; n.vy = 0;
    } else {
      n.x *= width / W;
      n.y *= height / H;
    }
  });
  W = width; H = height;
  draw();
}

// Connection count for sizing
const conns = {};
edges.forEach(e => {
  conns[e.source] = (conns[e.source] || 0) + 1;
  conns[e.target] = (conns[e.target] || 0) + 1;
});

function simulate() {
  const k = 0.01;
  const repulsion = 3000;
  const damping = 0.85;
  const centerPull = 0.002;

  // Sample repulsion for large vaults. Every node is updated, without
  // computing every pair on each animation frame.
  const samples = Math.min(nodes.length - 1, 24);
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = 0; j < samples; j++) {
      const offset = 1 + Math.floor((j + (frames % 5) / 5) * (nodes.length - 1) / samples);
      const b = nodes[(i + offset) % nodes.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.sqrt(Math.max(25, dx * dx + dy * dy));
      const f = repulsion / (distance * distance * distance);
      a.vx -= dx * f; a.vy -= dy * f;
    }
  }

  // Attraction along edges
  for (const e of edges) {
    const a = nodeMap[e.source], b = nodeMap[e.target];
    if (!a || !b) continue;
    let dx = b.x - a.x, dy = b.y - a.y;
    let dist = Math.sqrt(dx * dx + dy * dy) || 1;
    let f = (dist - 100) * k;
    let fx = (dx / dist) * f, fy = (dy / dist) * f;
    a.vx += fx; a.vy += fy;
    b.vx -= fx; b.vy -= fy;
  }

  // Center pull + apply velocity
  for (const n of nodes) {
    n.vx += (W / 2 - n.x) * centerPull;
    n.vy += (H / 2 - n.y) * centerPull;
    n.vx *= damping; n.vy *= damping;
    n.x += n.vx; n.y += n.vy;
    n.x = Math.max(20, Math.min(W - 20, n.x));
    n.y = Math.max(20, Math.min(H - 20, n.y));
  }
}

function drawArrow(x, y, angle) {
  const size = 6;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - Math.cos(angle - Math.PI / 6) * size, y - Math.sin(angle - Math.PI / 6) * size);
  ctx.lineTo(x - Math.cos(angle + Math.PI / 6) * size, y - Math.sin(angle + Math.PI / 6) * size);
  ctx.closePath();
  ctx.fillStyle = '${colors.textMuted}';
  ctx.fill();
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  // Edges
  for (const e of edges) {
    const a = nodeMap[e.source], b = nodeMap[e.target];
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / distance, uy = dy / distance;
    const sourceRadius = Math.min(3 + (conns[a.id] || 1) * 1.5, 12);
    const targetRadius = Math.min(3 + (conns[b.id] || 1) * 1.5, 12);
    const startX = a.x + ux * (sourceRadius + 2), startY = a.y + uy * (sourceRadius + 2);
    const endX = b.x - ux * (targetRadius + 3), endY = b.y - uy * (targetRadius + 3);
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.strokeStyle = e.reciprocal ? '${colors.textMuted}88' : '${colors.textMuted}66';
    ctx.lineWidth = e.reciprocal ? 1.25 : 1;
    ctx.stroke();

    const angle = Math.atan2(dy, dx);
    drawArrow(endX, endY, angle);
    if (e.reciprocal) drawArrow(startX, startY, angle + Math.PI);
  }

  // Batch circles and configure text once per frame.
  ctx.beginPath();
  for (const n of nodes) {
    const radius = Math.min(3 + (conns[n.id] || 1) * 1.5, 12);
    ctx.moveTo(n.x + radius, n.y);
    ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
  }
  ctx.fillStyle = '${colors.accent}';
  ctx.fill();

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '${colors.textSecondary}';
  ctx.textAlign = 'center';
  for (const n of nodes) {
    if (nodes.length > 70 && !labelNodes.has(n.id)) continue;
    const radius = Math.min(3 + (conns[n.id] || 1) * 1.5, 12);
    ctx.fillText(n.label, n.x, n.y + radius + 12);
  }
}

const labelNodes = new Set([...nodes].sort((a, b) => conns[b.id] - conns[a.id]).slice(0, 24).map(n => n.id));
let frames = 0;
function loop() {
  if (W && H) {
    simulate();
    draw();
  }
  frames++;
  if (frames < 80) requestAnimationFrame(loop);
}
resize();
new ResizeObserver(resize).observe(canvas);
requestAnimationFrame(loop);

// Tap to navigate
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  for (const n of nodes) {
    const c = conns[n.id] || 1;
    const r = Math.min(3 + c * 1.5, 12) + 10;
    if ((n.x - x) ** 2 + (n.y - y) ** 2 < r * r) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'nodeClick', path: n.path }));
      break;
    }
  }
});
</script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  headerBtn: { padding: 8, borderRadius: 8 },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  loadingOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
