import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { VaultApi } from "@noteriv/plugin-api";
import { buildLinkGraph, neighborhood } from "@noteriv/core/graph-utils";
import { scanVault } from "../shared/vault";

// ── Types ──

export interface GraphLabels {
  filter: string;
  close: string;
  zoomIn: string;
  zoomOut: string;
  building: string;
  notes: string;
  connections: string;
  connectionCount: (n: number) => string;
  oneWay: string;
  reciprocal: string;
  legend: string;
  allNotes: string;
  thisNote: string;
  /** Shown on "This note" when no note is open. */
  noNote: string;
  depth: string;
  colorByFolder: string;
  /** Name of the vault's top level in the folder legend. */
  rootFolder: string;
}

export interface GraphViewProps {
  vault: VaultApi;
  /** Vault-relative path of the open note (highlighted), if any. */
  currentPath: string | null;
  onNoteSelect: (path: string) => void;
  onClose: () => void;
  labels: GraphLabels;
  /** Open on the local graph of the current note (its links, and theirs up to the depth) rather than the whole vault. */
  local?: boolean;
}

/** Notes and link edges of a vault; node ids are vault-relative paths. */
export async function loadLinkGraph(vault: VaultApi) {
  const scanned = await scanVault(vault);
  const notes = scanned.map((n) => ({ id: n.path, path: n.path, name: n.path.split("/").pop() ?? n.path }));
  const contents = new Map(scanned.map((n) => [n.path, n.content]));
  return { notes, ...buildLinkGraph(notes, contents) };
}

interface GraphNode {
  id: string;           // note id
  label: string;        // note name without .md
  x: number;
  y: number;
  vx: number;
  vy: number;
  connections: number;  // total edge count
}

interface GraphEdge {
  source: string;       // node id
  target: string;       // node id
  reciprocal: boolean;
}

/** The top-level folder of a note ("" at the vault root): what "Color by folder" groups by. */
function folderOf(path: string): string {
  const slash = path.indexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** A colour per folder, spread around the hue circle; readable on light and dark themes alike. */
function folderColor(index: number): string {
  return `hsl(${Math.round((index * 137.5) % 360)}, 55%, 55%)`;
}

/** Folder legend entries shown at most; the rest are summed up as "…". */
const MAX_LEGEND = 8;

interface TooltipInfo {
  x: number;
  y: number;
  label: string;
  connections: number;
}

// ── Constants ──

const REPULSION_STRENGTH = 1200;
const ATTRACTION_STRENGTH = 0.004;
const CENTER_GRAVITY = 0.0025;
const ORPHAN_GRAVITY = 0.012;
const DAMPING = 0.85;
const MIN_NODE_RADIUS = 6;
const MAX_NODE_RADIUS = 22;
const LABEL_FONT_SIZE = 11;
const HIT_PADDING = 4;

// ── Helpers ──

function labelFromName(name: string): string {
  return name.replace(/\.(md|markdown)$/i, "");
}

function nodeRadius(connections: number, maxConnections: number): number {
  if (maxConnections <= 0) return MIN_NODE_RADIUS;
  const t = Math.min(connections / Math.max(maxConnections, 1), 1);
  return MIN_NODE_RADIUS + t * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number
) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - Math.cos(angle - Math.PI / 6) * size,
    y - Math.sin(angle - Math.PI / 6) * size
  );
  ctx.lineTo(
    x - Math.cos(angle + Math.PI / 6) * size,
    y - Math.sin(angle + Math.PI / 6) * size
  );
  ctx.closePath();
  ctx.fill();
}

// ── Component ──

export function GraphView({ vault, currentPath: currentNoteId, onNoteSelect, onClose, labels, local: startLocal = false }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);

  // Graph data
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);

  // Interaction state
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [local, setLocal] = useState(startLocal && !!currentNoteId);
  const [depth, setDepth] = useState(1);
  const [byFolder, setByFolder] = useState(false);

  // Camera: stored in refs for perf (used every frame)
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    camStartX: number;
    camStartY: number;
    draggedNode: string | null;
  }>({ active: false, startX: 0, startY: 0, camStartX: 0, camStartY: 0, draggedNode: null });

  // Keep mutable refs for simulation so the rAF loop can access latest state
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const searchRef = useRef("");
  const currentNoteRef = useRef<string | null>(currentNoteId);

  // Sync refs
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);
  useEffect(() => { hoveredRef.current = hoveredNode; }, [hoveredNode]);
  useEffect(() => { searchRef.current = searchQuery; }, [searchQuery]);
  useEffect(() => { currentNoteRef.current = currentNoteId; }, [currentNoteId]);

  // ── Build graph data ──
  // Every note is read to find its links (one request per note on web). A server-side links endpoint would be the
  // optimisation once vaults grow large.
  useEffect(() => {
    let cancelled = false;

    async function buildGraph() {
      try {
        const { notes, edges: edgeList, connections: connectionCount } = await loadLinkGraph(vault);
        if (cancelled) return;

        // Create nodes with random initial positions
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const spread = Math.min(cx, cy) * 0.8;

        const nodeList: GraphNode[] = notes.map((n) => ({
          id: n.id,
          label: labelFromName(n.name),
          x: cx + (Math.random() - 0.5) * spread * 2,
          y: cy + (Math.random() - 0.5) * spread * 2,
          vx: 0,
          vy: 0,
          connections: connectionCount.get(n.id) ?? 0,
        }));

        if (cancelled) return;
        setNodes(nodeList);
        setEdges(edgeList);
        nodesRef.current = nodeList;
        edgesRef.current = edgeList;
        setLoading(false);
      } catch (err) {
        console.error("GraphView: failed to build graph", err);
        if (!cancelled) setLoading(false);
      }
    }

    buildGraph();
    return () => { cancelled = true; };
  }, [vault]);

  // ── Computed values ──
  /** Whether the open file is a note of the graph (not a canvas, a PDF, or a note made since the graph was built). */
  const canLocal = useMemo(() => !!currentNoteId && nodes.some((n) => n.id === currentNoteId), [nodes, currentNoteId]);
  const isLocal = local && canLocal;
  /** The notes shown: all of them, or the local graph of the open note. */
  const visible = useMemo(
    () => (isLocal && currentNoteId ? neighborhood(edges, currentNoteId, depth) : null),
    [isLocal, currentNoteId, edges, depth]
  );
  const visibleRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    visibleRef.current = visible;
    // The notes just shown gather near the middle instead of staying where the whole vault had spread them.
    if (!visible) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.height / 2 : window.innerHeight / 2;
    for (const n of nodesRef.current) {
      if (!visible.has(n.id)) continue;
      const centre = n.id === currentNoteId;
      n.x = centre ? cx : cx + (Math.random() - 0.5) * 200;
      n.y = centre ? cy : cy + (Math.random() - 0.5) * 200;
      n.vx = 0;
      n.vy = 0;
    }
    cameraRef.current = { x: 0, y: 0, zoom: 1 };
  }, [visible, currentNoteId, nodes]);

  /** Folder → colour, over every note so a folder keeps its colour whatever is shown. */
  const folders = useMemo(() => {
    const names = [...new Set(nodes.map((n) => folderOf(n.id)))].sort();
    return new Map(names.map((name, i) => [name, folderColor(i)]));
  }, [nodes]);
  /** The legend: folders of the notes shown. */
  const shownFolders = useMemo(
    () => [...folders].filter(([name]) => !visible || nodes.some((n) => visible.has(n.id) && folderOf(n.id) === name)),
    [folders, visible, nodes]
  );
  const foldersRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    foldersRef.current = byFolder ? folders : null;
  }, [byFolder, folders]);

  const stats = useMemo(() => {
    if (!visible) return { noteCount: nodes.length, edgeCount: edges.length };
    return { noteCount: visible.size, edgeCount: edges.filter((e) => visible.has(e.source) && visible.has(e.target)).length };
  }, [nodes, edges, visible]);

  // ── CSS variable resolution (cached) ──
  const colorsRef = useRef({
    bgSurface: "#313244",
    accent: "#89b4fa",
    border: "#313244",
    textPrimary: "#cdd6f4",
    textMuted: "#6c7086",
    bgPrimary: "#1e1e2e",
  });

  useEffect(() => {
    const readColors = () => {
      const style = getComputedStyle(document.documentElement);
      colorsRef.current = {
        bgSurface: style.getPropertyValue("--bg-surface").trim() || "#313244",
        accent: style.getPropertyValue("--accent").trim() || "#89b4fa",
        border: style.getPropertyValue("--border").trim() || "#313244",
        textPrimary: style.getPropertyValue("--text-primary").trim() || "#cdd6f4",
        textMuted: style.getPropertyValue("--text-muted").trim() || "#6c7086",
        bgPrimary: style.getPropertyValue("--bg-primary").trim() || "#1e1e2e",
      };
    };
    readColors();

    const observer = new MutationObserver(readColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // ── Force simulation + render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    window.addEventListener("resize", resize);

    function tick() {
      if (!running || !ctx || !canvas) return;

      const shown = visibleRef.current;
      const ns = shown ? nodesRef.current.filter((n) => shown.has(n.id)) : nodesRef.current;
      const es = shown ? edgesRef.current.filter((e) => shown.has(e.source) && shown.has(e.target)) : edgesRef.current;
      const folderColors = foldersRef.current;
      const cam = cameraRef.current;
      const hovered = hoveredRef.current;
      const search = searchRef.current.toLowerCase();
      const curNote = currentNoteRef.current;
      const colors = colorsRef.current;
      const dragging = dragRef.current;

      const W = canvas.getBoundingClientRect().width;
      const H = canvas.getBoundingClientRect().height;
      const centerX = W / 2;
      const centerY = H / 2;

      const nodeMap = new Map<string, GraphNode>();
      for (const n of ns) nodeMap.set(n.id, n);

      for (let i = 0; i < ns.length; i++) {
        const a = ns[i];
        if (dragging.active && dragging.draggedNode === a.id) continue;

        for (let j = i + 1; j < ns.length; j++) {
          const b = ns[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; dist = 1; }
          const force = REPULSION_STRENGTH / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (!(dragging.active && dragging.draggedNode === b.id)) {
            b.vx -= fx;
            b.vy -= fy;
          }
          a.vx += fx;
          a.vy += fy;
        }

        const gravity = a.connections === 0 ? ORPHAN_GRAVITY : CENTER_GRAVITY;
        a.vx += (centerX - a.x) * gravity;
        a.vy += (centerY - a.y) * gravity;
      }

      for (const e of es) {
        const a = nodeMap.get(e.source);
        const b = nodeMap.get(e.target);
        if (!a || !b) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) continue;

        const fx = dx * ATTRACTION_STRENGTH;
        const fy = dy * ATTRACTION_STRENGTH;

        if (!(dragging.active && dragging.draggedNode === a.id)) {
          a.vx += fx;
          a.vy += fy;
        }
        if (!(dragging.active && dragging.draggedNode === b.id)) {
          b.vx -= fx;
          b.vy -= fy;
        }
      }

      for (const n of ns) {
        if (dragging.active && dragging.draggedNode === n.id) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
      }

      ctx.clearRect(0, 0, W, H);
      ctx.save();

      ctx.translate(W / 2, H / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(-W / 2 + cam.x, -H / 2 + cam.y);

      const highlightSet = new Set<string>();
      if (hovered) {
        highlightSet.add(hovered);
        for (const e of es) {
          if (e.source === hovered) highlightSet.add(e.target);
          if (e.target === hovered) highlightSet.add(e.source);
        }
      }

      const searchMatched = new Set<string>();
      if (search) {
        for (const n of ns) {
          if (n.label.toLowerCase().includes(search)) {
            searchMatched.add(n.id);
          }
        }
      }

      const mc = Math.max(...ns.map((n) => n.connections), 1);

      for (const e of es) {
        const a = nodeMap.get(e.source);
        const b = nodeMap.get(e.target);
        if (!a || !b) continue;

        const isHighlighted = hovered && highlightSet.has(a.id) && highlightSet.has(b.id);
        const isDimmedBySearch = search && (!searchMatched.has(a.id) && !searchMatched.has(b.id));

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 1) continue;
        const ux = dx / distance;
        const uy = dy / distance;
        const startX = a.x + ux * (nodeRadius(a.connections, mc) + 2);
        const startY = a.y + uy * (nodeRadius(a.connections, mc) + 2);
        const endX = b.x - ux * (nodeRadius(b.connections, mc) + 3);
        const endY = b.y - uy * (nodeRadius(b.connections, mc) + 3);
        const edgeColor = isHighlighted ? colors.accent : colors.border;
        const edgeAlpha = isDimmedBySearch ? 0.08 : isHighlighted ? 0.85 : e.reciprocal ? 0.42 : 0.3;

        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = isHighlighted ? colors.accent : colors.border;
        ctx.globalAlpha = edgeAlpha;
        ctx.lineWidth = isHighlighted ? 1.5 : e.reciprocal ? 1.25 : 1;
        ctx.stroke();

        const angle = Math.atan2(dy, dx);
        ctx.fillStyle = edgeColor;
        drawArrowHead(ctx, endX, endY, angle, isHighlighted ? 7 : 6);
        if (e.reciprocal) {
          drawArrowHead(ctx, startX, startY, angle + Math.PI, isHighlighted ? 7 : 6);
        }
        ctx.globalAlpha = 1;
      }

      for (const n of ns) {
        const r = nodeRadius(n.connections, mc);
        const isActive = curNote === n.id;
        const isHovered = hovered === n.id;
        const isConnected = highlightSet.has(n.id);
        const isSearchMatch = search ? searchMatched.has(n.id) : true;
        const isDimmed = (hovered && !isConnected) || (search && !isSearchMatch);

        ctx.globalAlpha = isDimmed ? 0.15 : 1;

        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);

        if (isActive) {
          ctx.fillStyle = colors.accent;
          ctx.fill();
          ctx.strokeStyle = colors.textPrimary;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (isHovered) {
          ctx.fillStyle = colors.accent;
          ctx.fill();
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.fillStyle = folderColors?.get(folderOf(n.id)) ?? colors.bgSurface;
          ctx.fill();
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth = isConnected && hovered ? 1.5 : 1;
          ctx.stroke();
        }

        const showLabel = cam.zoom > 0.4 || isHovered || isActive || (search && isSearchMatch);
        if (showLabel) {
          const fontSize = Math.max(LABEL_FONT_SIZE / Math.max(cam.zoom, 0.5), 10);
          ctx.font = `${isActive || isHovered ? "600" : "400"} ${fontSize}px Inter, -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = isActive || isHovered ? colors.textPrimary : colors.textMuted;
          ctx.fillText(n.label, n.x, n.y + r + 4);
        }

        ctx.globalAlpha = 1;
      }

      ctx.restore();

      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [loading]);

  // ── Hit testing ──
  const hitTest = useCallback(
    (clientX: number, clientY: number): GraphNode | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const cam = cameraRef.current;
      const W = rect.width;
      const H = rect.height;

      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const worldX = (sx - W / 2) / cam.zoom + W / 2 - cam.x;
      const worldY = (sy - H / 2) / cam.zoom + H / 2 - cam.y;

      const shown = visibleRef.current;
      const ns = shown ? nodesRef.current.filter((n) => shown.has(n.id)) : nodesRef.current;
      const mc = Math.max(...ns.map((n) => n.connections), 1);

      for (let i = ns.length - 1; i >= 0; i--) {
        const n = ns[i];
        const r = nodeRadius(n.connections, mc) + HIT_PADDING;
        const dx = worldX - n.x;
        const dy = worldY - n.y;
        if (dx * dx + dy * dy <= r * r) {
          return n;
        }
      }
      return null;
    },
    []
  );

  // ── Mouse handlers ──
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;

      const node = hitTest(e.clientX, e.clientY);
      const cam = cameraRef.current;

      dragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        camStartX: cam.x,
        camStartY: cam.y,
        draggedNode: node ? node.id : null,
      };

      canvasRef.current?.classList.add("grabbing");
    },
    [hitTest]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;

      if (drag.active) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;

        if (drag.draggedNode) {
          const cam = cameraRef.current;
          const node = nodesRef.current.find((n) => n.id === drag.draggedNode);
          if (node) {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            const W = rect.width;
            const H = rect.height;
            const worldX = (e.clientX - rect.left - W / 2) / cam.zoom + W / 2 - cam.x;
            const worldY = (e.clientY - rect.top - H / 2) / cam.zoom + H / 2 - cam.y;
            node.x = worldX;
            node.y = worldY;
            node.vx = 0;
            node.vy = 0;
          }
        } else {
          const cam = cameraRef.current;
          cam.x = drag.camStartX + dx / cam.zoom;
          cam.y = drag.camStartY + dy / cam.zoom;
        }
      } else {
        const node = hitTest(e.clientX, e.clientY);
        const nodeId = node?.id ?? null;

        if (nodeId !== hoveredRef.current) {
          setHoveredNode(nodeId);
          if (node) {
            setTooltip({ x: e.clientX, y: e.clientY, label: node.label, connections: node.connections });
          } else {
            setTooltip(null);
          }
        } else if (node && tooltip) {
          setTooltip({ x: e.clientX, y: e.clientY, label: node.label, connections: node.connections });
        }

        if (canvasRef.current) {
          canvasRef.current.style.cursor = node ? "pointer" : "grab";
        }
      }
    },
    [hitTest, tooltip]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;

      if (drag.active) {
        const dx = Math.abs(e.clientX - drag.startX);
        const dy = Math.abs(e.clientY - drag.startY);

        if (dx < 3 && dy < 3) {
          const node = hitTest(e.clientX, e.clientY);
          if (node) {
            onNoteSelect(node.id);
          }
        }
      }

      dragRef.current = { active: false, startX: 0, startY: 0, camStartX: 0, camStartY: 0, draggedNode: null };
      canvasRef.current?.classList.remove("grabbing");
    },
    [hitTest, onNoteSelect]
  );

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const cam = cameraRef.current;
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    cam.zoom = Math.max(0.1, Math.min(5, cam.zoom * zoomFactor));
  }, []);

  const handleZoomIn = useCallback(() => {
    const cam = cameraRef.current;
    cam.zoom = Math.min(5, cam.zoom * 1.25);
  }, []);

  const handleZoomOut = useCallback(() => {
    const cam = cameraRef.current;
    cam.zoom = Math.max(0.1, cam.zoom * 0.8);
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose]
  );

  return (
    <div ref={overlayRef} className="graph-overlay" onClick={handleBackdropClick}>
      <div ref={containerRef} className="graph-container">
        <div className="graph-search">
          <svg className="graph-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder={labels.filter}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="graph-side">
        <div className="graph-controls">
          <div className="graph-scope" role="group" aria-label={`${labels.allNotes} / ${labels.thisNote}`}>
            <button type="button" className={`graph-scope-btn ${isLocal ? "" : "active"}`} aria-pressed={!isLocal} onClick={() => setLocal(false)}>
              {labels.allNotes}
            </button>
            <button
              type="button"
              className={`graph-scope-btn ${isLocal ? "active" : ""}`}
              aria-pressed={isLocal}
              aria-disabled={!canLocal}
              title={canLocal ? undefined : labels.noNote}
              onClick={() => canLocal && setLocal(true)}
            >
              {labels.thisNote}
            </button>
          </div>
          {!canLocal && !loading && <span className="graph-hint">{labels.noNote}</span>}
          {isLocal && (
            <label className="graph-depth">
              {labels.depth}
              <select value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
                {[1, 2, 3].map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="graph-color-toggle">
            <input type="checkbox" checked={byFolder} onChange={(e) => setByFolder(e.target.checked)} />
            {labels.colorByFolder}
          </label>
        </div>

        {byFolder && (
          <ul className="graph-folder-legend">
            {shownFolders.slice(0, MAX_LEGEND).map(([name, color]) => (
              <li key={name}>
                <span className="graph-folder-swatch" style={{ background: color }} />
                {name || labels.rootFolder}
              </li>
            ))}
            {shownFolders.length > MAX_LEGEND && <li>…</li>}
          </ul>
        )}
        </div>

        <button className="graph-close-btn" onClick={onClose} title={labels.close} aria-label={labels.close}>
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>

        <canvas
          ref={canvasRef}
          className="graph-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (dragRef.current.active) {
              dragRef.current = { active: false, startX: 0, startY: 0, camStartX: 0, camStartY: 0, draggedNode: null };
              canvasRef.current?.classList.remove("grabbing");
            }
            setHoveredNode(null);
            setTooltip(null);
          }}
          onWheel={handleWheel}
        />

        {tooltip && (
          <div className="graph-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            <div>{tooltip.label}</div>
            <div className="graph-tooltip-connections">{labels.connectionCount(tooltip.connections)}</div>
          </div>
        )}

        <div className="graph-stats">
          <div className="graph-stat-item">
            <span className="graph-stat-value">{stats.noteCount}</span>
            <span>{labels.notes}</span>
          </div>
          <div className="graph-stat-item">
            <span className="graph-stat-value">{stats.edgeCount}</span>
            <span>{labels.connections}</span>
          </div>
        </div>

        <div className="graph-edge-legend" aria-label={labels.legend}>
          <span><span className="graph-legend-arrow">→</span> {labels.oneWay}</span>
          <span><span className="graph-legend-arrow">↔</span> {labels.reciprocal}</span>
        </div>

        <div className="graph-zoom-controls">
          <button className="graph-zoom-btn" onClick={handleZoomIn} title={labels.zoomIn}>+</button>
          <button className="graph-zoom-btn" onClick={handleZoomOut} title={labels.zoomOut}>&minus;</button>
        </div>

        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 14 }}>
            {labels.building}
          </div>
        )}
      </div>
    </div>
  );
}
