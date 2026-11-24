// Canvas board (nodes, edges, freehand strokes), shared by web and desktop since 2.5b. Ported from the web app's
// CanvasView, itself a port of desktop's Canvas.tsx. All I/O goes through `CanvasServices` (see services.ts): note
// previews and the note picker, opening a note, images. The document is the tab's content: JSON, after a frontmatter
// block when the file has one (web notes carry `canvas: true`; desktop `.canvas` files are plain JSON).

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import {
  CanvasData,
  CanvasNode,
  CanvasEdge,
  createTextNode,
  createFileNode,
  createGroupNode,
  createStickyNode,
  createImageNode,
  createDrawingNode,
  createEdge,
  serializeCanvas,
  parseCanvas,
  getAnchorPoint,
  generateId,
  recalcEdgeSides,
  STICKY_COLORS,
} from "@noteriv/core/canvas-utils";
import { splitFrontmatter } from "@noteriv/core/frontmatter-utils";
import type { CanvasLabels, CanvasServices } from "./services";

// ─── Props ───

interface CanvasViewProps {
  content: string;
  onChange: (content: string) => void;
  services: CanvasServices;
  labels: CanvasLabels;
}

/** Display URL of an image node's target (resolved asynchronously: a data: URL on desktop). */
function useImageUrl(services: CanvasServices, target: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    if (target) void services.imageUrl(target).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [services, target]);
  return url;
}

// ─── Constants ───

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const MIN_NODE_W = 100;
const MIN_NODE_H = 60;
const NODE_COLORS = ["", "red", "orange", "yellow", "green", "blue", "purple"];

type CanvasTool = "select" | "text" | "sticky" | "image" | "draw";

const DRAW_STROKE_COLORS = [
  "#cdd6f4", "#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#89dceb", "#cba6f7",
];

// ─── Sub-components ───

function EdgeMarkerDefs() {
  return (
    <defs>
      <marker id="canvas-arrowhead" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L10,4 L0,8 Z" className="canvas-edge-arrowhead" />
      </marker>
    </defs>
  );
}

function EdgeLine({ edge, nodes, selected, onClick }: { edge: CanvasEdge; nodes: CanvasNode[]; selected: boolean; onClick: (id: string, e: React.MouseEvent) => void; }) {
  const fromNode = nodes.find((n) => n.id === edge.fromNode);
  const toNode = nodes.find((n) => n.id === edge.toNode);
  if (!fromNode || !toNode) return null;

  const from = getAnchorPoint(fromNode, edge.fromSide);
  const to = getAnchorPoint(toNode, edge.toSide);

  const sideOffset = 60;
  const cp1 = { ...from };
  const cp2 = { ...to };
  if (edge.fromSide === "right") cp1.x += sideOffset;
  else if (edge.fromSide === "left") cp1.x -= sideOffset;
  else if (edge.fromSide === "bottom") cp1.y += sideOffset;
  else cp1.y -= sideOffset;

  if (edge.toSide === "right") cp2.x += sideOffset;
  else if (edge.toSide === "left") cp2.x -= sideOffset;
  else if (edge.toSide === "bottom") cp2.y += sideOffset;
  else cp2.y -= sideOffset;

  const d = `M${from.x},${from.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${to.x},${to.y}`;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  return (
    <g>
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} style={{ pointerEvents: "stroke", cursor: "pointer" }} onClick={(e) => onClick(edge.id, e)} />
      <path d={d} className={`canvas-edge-line${selected ? " selected" : ""}`} markerEnd="url(#canvas-arrowhead)" style={edge.color ? { stroke: edge.color } : undefined} />
      {edge.label && <text x={midX} y={midY - 8} className="canvas-edge-label">{edge.label}</text>}
    </g>
  );
}

function TextNodeView({ node, selected, editing, onPointerDown, onDoubleClick, onTextChange, onTextBlur, onAnchorPointerDown, onResizePointerDown, onContextMenu }: {
  node: CanvasNode; selected: boolean; editing: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void; onDoubleClick: (id: string) => void;
  onTextChange: (id: string, text: string) => void; onTextBlur: () => void;
  onAnchorPointerDown: (nodeId: string, side: string, e: React.PointerEvent) => void;
  onResizePointerDown: (nodeId: string, corner: string, e: React.PointerEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  return (
    <div className={`canvas-node canvas-node-text${selected ? " selected" : ""}`} data-color={node.color || undefined}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={(e) => onPointerDown(node.id, e)} onDoubleClick={() => onDoubleClick(node.id)} onContextMenu={(e) => onContextMenu(node.id, e)}>
      <div className="canvas-node-body">
        {editing ? (
          <textarea ref={textareaRef} value={node.text || ""} onChange={(e) => onTextChange(node.id, e.target.value)} onBlur={onTextBlur} onPointerDown={(e) => e.stopPropagation()} />
        ) : (
          <div className="node-text-display">{node.text || "Double-click to edit"}</div>
        )}
      </div>
      {selected && (
        <>
          <div className="canvas-resize-handle nw" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "nw", e); }} />
          <div className="canvas-resize-handle ne" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "ne", e); }} />
          <div className="canvas-resize-handle sw" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "sw", e); }} />
          <div className="canvas-resize-handle se" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "se", e); }} />
        </>
      )}
      <div className="canvas-edge-anchor top" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "top", e); }} />
      <div className="canvas-edge-anchor bottom" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "bottom", e); }} />
      <div className="canvas-edge-anchor left" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "left", e); }} />
      <div className="canvas-edge-anchor right" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "right", e); }} />
    </div>
  );
}

function FileNodeView({ node, selected, preview, noteName, onPointerDown, onDoubleClick, onAnchorPointerDown, onResizePointerDown, onContextMenu }: {
  node: CanvasNode; selected: boolean; preview: string; noteName: string;
  onPointerDown: (id: string, e: React.PointerEvent) => void; onDoubleClick: (id: string) => void;
  onAnchorPointerDown: (nodeId: string, side: string, e: React.PointerEvent) => void;
  onResizePointerDown: (nodeId: string, corner: string, e: React.PointerEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}) {
  return (
    <div className={`canvas-node canvas-node-file${selected ? " selected" : ""}`} data-color={node.color || undefined}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={(e) => onPointerDown(node.id, e)} onDoubleClick={() => onDoubleClick(node.id)} onContextMenu={(e) => onContextMenu(node.id, e)}>
      <div className="canvas-node-header">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M4 1h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" />
          <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        <span className="file-name">{noteName || "Unknown"}</span>
      </div>
      <div className="canvas-node-body">{preview || "Loading..."}</div>
      {selected && (
        <>
          <div className="canvas-resize-handle nw" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "nw", e); }} />
          <div className="canvas-resize-handle ne" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "ne", e); }} />
          <div className="canvas-resize-handle sw" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "sw", e); }} />
          <div className="canvas-resize-handle se" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "se", e); }} />
        </>
      )}
      <div className="canvas-edge-anchor top" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "top", e); }} />
      <div className="canvas-edge-anchor bottom" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "bottom", e); }} />
      <div className="canvas-edge-anchor left" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "left", e); }} />
      <div className="canvas-edge-anchor right" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "right", e); }} />
    </div>
  );
}

function GroupNodeView({ node, selected, editingLabel, defaultLabel, onPointerDown, onDoubleClick, onLabelChange, onLabelBlur, onResizePointerDown, onContextMenu }: {
  defaultLabel: string;
  node: CanvasNode; selected: boolean; editingLabel: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void; onDoubleClick: (id: string) => void;
  onLabelChange: (id: string, label: string) => void; onLabelBlur: () => void;
  onResizePointerDown: (nodeId: string, corner: string, e: React.PointerEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingLabel && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editingLabel]);

  return (
    <div className={`canvas-node canvas-node-group${selected ? " selected" : ""}`} data-color={node.color || undefined}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={(e) => onPointerDown(node.id, e)} onDoubleClick={() => onDoubleClick(node.id)} onContextMenu={(e) => onContextMenu(node.id, e)}>
      <div className="canvas-group-label">
        {editingLabel ? (
          <input ref={inputRef} value={node.label || ""} onChange={(e) => onLabelChange(node.id, e.target.value)} onBlur={onLabelBlur}
            onKeyDown={(e) => { if (e.key === "Enter") onLabelBlur(); }} onPointerDown={(e) => e.stopPropagation()} />
        ) : (node.label || defaultLabel)}
      </div>
      {selected && (
        <>
          <div className="canvas-resize-handle nw" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "nw", e); }} />
          <div className="canvas-resize-handle ne" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "ne", e); }} />
          <div className="canvas-resize-handle sw" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "sw", e); }} />
          <div className="canvas-resize-handle se" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "se", e); }} />
        </>
      )}
    </div>
  );
}

function StickyNoteView({ node, selected, editing, onPointerDown, onDoubleClick, onTextChange, onTextBlur, onAnchorPointerDown, onResizePointerDown, onContextMenu }: {
  node: CanvasNode; selected: boolean; editing: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void; onDoubleClick: (id: string) => void;
  onTextChange: (id: string, text: string) => void; onTextBlur: () => void;
  onAnchorPointerDown: (nodeId: string, side: string, e: React.PointerEvent) => void;
  onResizePointerDown: (nodeId: string, corner: string, e: React.PointerEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing && textareaRef.current) { textareaRef.current.focus(); textareaRef.current.selectionStart = textareaRef.current.value.length; }
  }, [editing]);

  const rotation = node.rotation ?? 0;

  return (
    <div className={`canvas-node canvas-node-sticky${selected ? " selected" : ""}`} data-sticky-color={node.color || "yellow"}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height, transform: `rotate(${rotation}deg)`, background: STICKY_COLORS[node.color || "yellow"] || "#f9e2af" }}
      onPointerDown={(e) => onPointerDown(node.id, e)} onDoubleClick={() => onDoubleClick(node.id)} onContextMenu={(e) => onContextMenu(node.id, e)}>
      <div className="canvas-sticky-body">
        {editing ? (
          <textarea ref={textareaRef} value={node.text || ""} onChange={(e) => onTextChange(node.id, e.target.value)} onBlur={onTextBlur} onPointerDown={(e) => e.stopPropagation()} />
        ) : (
          <div className="sticky-text-display">{node.text || "Double-click to edit"}</div>
        )}
      </div>
      {selected && (
        <>
          <div className="canvas-resize-handle nw" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "nw", e); }} />
          <div className="canvas-resize-handle ne" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "ne", e); }} />
          <div className="canvas-resize-handle sw" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "sw", e); }} />
          <div className="canvas-resize-handle se" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "se", e); }} />
        </>
      )}
      <div className="canvas-edge-anchor top" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "top", e); }} />
      <div className="canvas-edge-anchor bottom" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "bottom", e); }} />
      <div className="canvas-edge-anchor left" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "left", e); }} />
      <div className="canvas-edge-anchor right" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "right", e); }} />
    </div>
  );
}

function ImageNodeView({ node, services, selected, onPointerDown, onDoubleClick, onAnchorPointerDown, onResizePointerDown, onContextMenu }: {
  node: CanvasNode; services: CanvasServices; selected: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void; onDoubleClick: (id: string) => void;
  onAnchorPointerDown: (nodeId: string, side: string, e: React.PointerEvent) => void;
  onResizePointerDown: (nodeId: string, corner: string, e: React.PointerEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}) {
  // node.imagePath: a link target from `vault.saveAttachment`/`listAttachments`, or an older form (web attachment id,
  // desktop absolute path) the host still resolves.
  const src = useImageUrl(services, node.imagePath);

  return (
    <div className={`canvas-node canvas-node-image${selected ? " selected" : ""}`} data-color={node.color || undefined}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={(e) => onPointerDown(node.id, e)} onDoubleClick={() => onDoubleClick(node.id)} onContextMenu={(e) => onContextMenu(node.id, e)}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <div className="canvas-image-placeholder">
          <svg width="24" height="24" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="5" cy="6" r="1.5" stroke="currentColor" strokeWidth="1" />
            <path d="M1 11l4-3 3 2 3-4 4 5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      {selected && (
        <>
          <div className="canvas-resize-handle nw" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "nw", e); }} />
          <div className="canvas-resize-handle ne" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "ne", e); }} />
          <div className="canvas-resize-handle sw" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "sw", e); }} />
          <div className="canvas-resize-handle se" onPointerDown={(e) => { e.stopPropagation(); onResizePointerDown(node.id, "se", e); }} />
        </>
      )}
      <div className="canvas-edge-anchor top" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "top", e); }} />
      <div className="canvas-edge-anchor bottom" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "bottom", e); }} />
      <div className="canvas-edge-anchor left" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "left", e); }} />
      <div className="canvas-edge-anchor right" onPointerDown={(e) => { e.stopPropagation(); onAnchorPointerDown(node.id, "right", e); }} />
    </div>
  );
}

function DrawingNodeView({ node, selected, onPointerDown, onContextMenu }: {
  node: CanvasNode; selected: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  onContextMenu: (id: string, e: React.MouseEvent) => void;
}) {
  const points = node.drawingPoints || [];
  if (points.length < 2) return null;
  const polylinePoints = points.map(([px, py]) => `${px},${py}`).join(" ");

  return (
    <div className={`canvas-node canvas-node-drawing${selected ? " selected" : ""}`}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onPointerDown={(e) => { e.stopPropagation(); onPointerDown(node.id, e); }} onContextMenu={(e) => onContextMenu(node.id, e)}>
      <svg viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", top: 0, left: 0, width: node.width, height: node.height, overflow: "visible" }}>
        <polyline points={polylinePoints} fill="none" stroke={node.strokeColor || "#cdd6f4"} strokeWidth={node.strokeWidth || 3} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** File picker overlay — sourced from the already-loaded vault index, not a filesystem scan. */
function FilePicker({ notes, onSelect, onClose, labels }: {
  notes: { noteId: string; name: string; path: string }[] | null;
  labels: CanvasLabels;
  onSelect: (noteId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    if (!notes) return [];
    if (!query) return notes;
    const q = query.toLowerCase();
    return notes.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }, [notes, query]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && filtered[selectedIndex]) { e.preventDefault(); onSelect(filtered[selectedIndex].noteId); }
    else if (e.key === "Escape") onClose();
  };

  return (
    <div className="canvas-file-picker" onClick={onClose}>
      <div className="canvas-file-picker-inner" onClick={(e) => e.stopPropagation()}>
        <div className="canvas-file-picker-header">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5" stroke="var(--text-muted)" strokeWidth="1.3" />
            <path d="M11 11l3 3" stroke="var(--text-muted)" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input ref={inputRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} placeholder={labels.searchNotes} />
        </div>
        <div className="canvas-file-picker-list">
          {filtered.slice(0, 50).map((f, i) => (
            <button key={f.noteId} className={`canvas-file-picker-item${i === selectedIndex ? " active" : ""}`} onClick={() => onSelect(f.noteId)}>
              <span>{f.name.replace(/\.(md|markdown)$/i, "")}</span>
              <span className="file-path">{f.path}</span>
            </button>
          ))}
          {filtered.length === 0 && <div style={{ padding: "16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>{notes === null ? labels.loading : labels.noMatchingNotes}</div>}
        </div>
      </div>
    </div>
  );
}

/** Image picker: images already in the vault (attachments), or a new one uploaded from the computer. */
function ImagePicker({ services, labels, onSelect, onClose }: { services: CanvasServices; labels: CanvasLabels; onSelect: (target: string) => void; onClose: () => void }) {
  const [images, setImages] = useState<{ target: string; name: string; url: string | null }[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await services.images().catch(() => []);
      const withUrls = await Promise.all(list.map(async (img) => ({ ...img, url: await services.imageUrl(img.target).catch(() => null) })));
      if (!cancelled) setImages(withUrls);
    })();
    return () => {
      cancelled = true;
    };
  }, [services]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      onSelect(await services.uploadImage(file));
    } catch {
      setUploading(false);
    }
  };

  return (
    <div className="canvas-file-picker" onClick={onClose}>
      <div className="canvas-file-picker-inner" onClick={(e) => e.stopPropagation()}>
        <div className="canvas-file-picker-header" style={{ justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{labels.pickImage}</span>
          <button className="canvas-toolbar-btn" style={{ width: "auto", padding: "0 8px", fontSize: 12 }} disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? labels.uploading : labels.upload}
          </button>
          <input ref={fileInput} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => void upload(e.target.files?.[0])} />
        </div>
        <div className="canvas-file-picker-list" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, padding: 8 }}>
          {images === null && <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>{labels.loading}</div>}
          {images !== null && images.length === 0 && (
            <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13, gridColumn: "1 / -1" }}>{labels.noImages}</div>
          )}
          {images?.map((img) => (
            <button key={img.target} onClick={() => onSelect(img.target)} style={{ border: "1px solid var(--border)", borderRadius: 6, padding: 0, overflow: "hidden", background: "var(--bg-tertiary)", cursor: "pointer", aspectRatio: "1" }} title={img.name}>
              {img.url && <img src={img.url} alt={img.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CanvasContextMenu({ x, y, nodeId, nodeType, nodeColor, labels, onDelete, onColorChange, onStickyColorChange, onDuplicate, onAddTextNode, onAddStickyNote, onAddImage, onClose }: {
  labels: CanvasLabels["menu"];
  x: number; y: number; nodeId: string | null; nodeType?: string; nodeColor?: string;
  onDelete: () => void; onColorChange: (color: string) => void; onStickyColorChange: (color: string) => void;
  onDuplicate: () => void; onAddTextNode: () => void; onAddStickyNote: () => void; onAddImage: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const handleClick = () => onClose();
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [onClose]);

  return (
    <div className="canvas-context-menu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      {nodeId && (
        <>
          <button className="canvas-context-item" onClick={onDuplicate}>{labels.duplicate}</button>
          <div className="canvas-context-divider" />
          {nodeType === "sticky" ? (
            <>
              <div style={{ padding: "4px 10px", fontSize: 11, color: "var(--text-muted)" }}>{labels.stickyColor}</div>
              <div className="canvas-context-submenu">
                {Object.entries(STICKY_COLORS).map(([name, hex]) => (
                  <div key={name} className={`canvas-sticky-color-dot${nodeColor === name ? " active" : ""}`} style={{ background: hex }} onClick={() => onStickyColorChange(name)} />
                ))}
              </div>
            </>
          ) : nodeType !== "drawing" ? (
            <>
              <div style={{ padding: "4px 10px", fontSize: 11, color: "var(--text-muted)" }}>{labels.color}</div>
              <div className="canvas-context-submenu">
                {NODE_COLORS.map((c) => (
                  <div key={c || "none"} className={`canvas-color-dot${nodeColor === c ? " active" : ""}`}
                    style={{ background: c ? ({ red: "#e55", orange: "#e93", yellow: "#ec5", green: "#5b5", blue: "#58c", purple: "#a6e" } as Record<string, string>)[c] : "var(--bg-hover)" }}
                    onClick={() => onColorChange(c)} />
                ))}
              </div>
            </>
          ) : null}
          <div className="canvas-context-divider" />
          <button className="canvas-context-item danger" onClick={onDelete}>{labels.delete}</button>
        </>
      )}
      {!nodeId && (
        <>
          <button className="canvas-context-item" onClick={onAddTextNode}>{labels.addText}</button>
          <button className="canvas-context-item" onClick={onAddStickyNote}>{labels.addSticky}</button>
          <button className="canvas-context-item" onClick={onAddImage}>{labels.addImage}</button>
        </>
      )}
    </div>
  );
}

function Minimap({ nodes, panX, panY, zoom, viewportWidth, viewportHeight }: {
  nodes: CanvasNode[]; panX: number; panY: number; zoom: number; viewportWidth: number; viewportHeight: number;
}) {
  if (nodes.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
  }
  const pad = 100;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  const mmW = 160;
  const mmH = 100;
  const scale = Math.min(mmW / worldW, mmH / worldH);

  const vpLeft = -panX / zoom;
  const vpTop = -panY / zoom;
  const vpW = viewportWidth / zoom;
  const vpH = viewportHeight / zoom;

  return (
    <div className="canvas-minimap">
      {nodes.map((n) => (
        <div key={n.id} className="canvas-minimap-node"
          style={{ left: (n.x - minX) * scale, top: (n.y - minY) * scale, width: Math.max(n.width * scale, 2), height: Math.max(n.height * scale, 2) }} />
      ))}
      <div className="canvas-minimap-viewport" style={{ left: (vpLeft - minX) * scale, top: (vpTop - minY) * scale, width: vpW * scale, height: vpH * scale }} />
    </div>
  );
}

// ─── Main Canvas Component ───

export function CanvasView({ content, onChange, services, labels }: CanvasViewProps) {
  // The frontmatter block (web notes: `canvas: true`, the marker isCanvasContent looks for) is kept as it was and put
  // back on every save; serializeCanvas only produces the JSON. Desktop `.canvas` files have none and get none.
  const frontmatterRef = useRef<string>("");
  const [canvasData, setCanvasData] = useState<CanvasData>(() => {
    const { frontmatter, body } = splitFrontmatter(content);
    frontmatterRef.current = frontmatter;
    return parseCanvas(body);
  });
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [imagePicker, setImagePicker] = useState<{ atX: number; atY: number; replacingNodeId: string | null } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);
  const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
  const [viewportSize, setViewportSize] = useState({ w: 800, h: 600 });

  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [drawStrokeColor, setDrawStrokeColor] = useState("#cdd6f4");
  const [drawStrokeWidth] = useState(3);

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentDrawPoints, setCurrentDrawPoints] = useState<number[][]>([]);
  const drawPointsRef = useRef<number[][]>([]);

  const [drawingEdge, setDrawingEdge] = useState<{ fromNode: string; fromSide: string; mouseX: number; mouseY: number } | null>(null);
  const [resizing, setResizing] = useState<{ nodeId: string; corner: string; startX: number; startY: number; origX: number; origY: number; origW: number; origH: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const nodeDragRef = useRef<{ nodeId: string; startX: number; startY: number; nodePositions: Map<string, { x: number; y: number }> } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedRef = useRef(true); // content already parsed via lazy useState init above
  const didFitRef = useRef(false);
  const measuredRef = useRef(false);

  // File nodes keep whatever reference they were made with: a vault path (since 2.5b), a web note id or a desktop
  // absolute path (older canvases). `services.note` resolves all three to a name and the start of the note.
  const [noteNames, setNoteNames] = useState<Record<string, string>>({});
  const [filePickerNotes, setFilePickerNotes] = useState<{ noteId: string; name: string; path: string }[] | null>(null);

  useEffect(() => {
    if (!showFilePicker) return;
    let cancelled = false;
    setFilePickerNotes(null);
    void services
      .notes()
      .catch(() => [])
      .then((notes) => !cancelled && setFilePickerNotes(notes.map((n) => ({ noteId: n.path, name: n.name, path: n.path }))));
    return () => {
      cancelled = true;
    };
  }, [showFilePicker, services]);

  // ─── Load file-node previews ───
  useEffect(() => {
    async function loadPreviews() {
      const fileNodes = canvasData.nodes.filter((n) => n.type === "file" && n.filePath);
      for (const node of fileNodes) {
        const ref = node.filePath!;
        if (filePreviews[ref] !== undefined) continue;
        const note = await services.note(ref).catch(() => null);
        setFilePreviews((prev) => ({ ...prev, [ref]: note ? note.content.slice(0, 300) : labels.noteNotFound }));
        if (note) setNoteNames((prev) => ({ ...prev, [ref]: note.name }));
      }
    }
    loadPreviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasData.nodes, services]);

  // ─── Observe viewport size ───
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) measuredRef.current = true;
        setViewportSize({ w: width, h: height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ─── Debounced save ───
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** The document as last written (or loaded): an incoming `content` equal to it is our own echo. */
  const writtenRef = useRef(content);
  const pendingRef = useRef<CanvasData | null>(null);
  const flush = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const data = pendingRef.current;
    if (!data) return;
    pendingRef.current = null;
    const doc = frontmatterRef.current + serializeCanvas(data);
    writtenRef.current = doc;
    onChangeRef.current(doc);
  }, []);
  const scheduleSave = useCallback((data: CanvasData) => {
    pendingRef.current = data;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flush, 500);
  }, [flush]);

  // Closing the tab must not lose the last edit made within the debounce.
  useEffect(() => flush, [flush]);

  // The tab's content changed elsewhere (source mode, the file on disk, a collaborator): show that document.
  useEffect(() => {
    if (content === writtenRef.current) return;
    writtenRef.current = content;
    pendingRef.current = null;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const { frontmatter, body } = splitFrontmatter(content);
    frontmatterRef.current = frontmatter;
    setCanvasData(parseCanvas(body));
  }, [content]);

  const updateCanvas = useCallback((updater: (prev: CanvasData) => CanvasData) => {
    setCanvasData((prev) => {
      const next = updater(prev);
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const screenToWorld = useCallback((sx: number, sy: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (sx - rect.left - panX) / zoom, y: (sy - rect.top - panY) / zoom };
  }, [panX, panY, zoom]);

  const handleViewportPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".canvas-node")) return;

    e.preventDefault();
    setContextMenu(null);

    if (activeTool === "draw") {
      const world = screenToWorld(e.clientX, e.clientY);
      const startPoint = [world.x, world.y];
      setIsDrawing(true);
      setCurrentDrawPoints([startPoint]);
      drawPointsRef.current = [startPoint];
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    setIsPanning(true);
    setSelectedNodeIds(new Set());
    setSelectedEdgeId(null);
    setEditingNodeId(null);
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [panX, panY, activeTool, screenToWorld]);

  const handleViewportPointerMove = useCallback((e: React.PointerEvent) => {
    if (isDrawing) {
      const world = screenToWorld(e.clientX, e.clientY);
      const newPoint = [world.x, world.y];
      drawPointsRef.current = [...drawPointsRef.current, newPoint];
      setCurrentDrawPoints([...drawPointsRef.current]);
      return;
    }

    if (isPanning && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPanX(dragStartRef.current.panX + dx);
      setPanY(dragStartRef.current.panY + dy);
      return;
    }

    if (isDraggingNode && nodeDragRef.current) {
      const drag = nodeDragRef.current;
      if (!drag.nodePositions) return;
      const dx = (e.clientX - drag.startX) / zoom;
      const dy = (e.clientY - drag.startY) / zoom;
      updateCanvas((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          const orig = drag.nodePositions.get(n.id);
          if (!orig) return n;
          return { ...n, x: orig.x + dx, y: orig.y + dy };
        }),
      }));
      return;
    }

    if (drawingEdge) {
      const world = screenToWorld(e.clientX, e.clientY);
      setDrawingEdge((prev) => prev ? { ...prev, mouseX: world.x, mouseY: world.y } : null);
      return;
    }

    if (resizing) {
      const dx = (e.clientX - resizing.startX) / zoom;
      const dy = (e.clientY - resizing.startY) / zoom;
      updateCanvas((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          if (n.id !== resizing.nodeId) return n;
          let { origX: nx, origY: ny, origW: nw, origH: nh } = resizing;
          const corner = resizing.corner;
          if (corner.includes("e")) nw = Math.max(MIN_NODE_W, nw + dx);
          if (corner.includes("w")) { nw = Math.max(MIN_NODE_W, nw - dx); nx = nw > MIN_NODE_W ? nx + dx : nx; }
          if (corner.includes("s")) nh = Math.max(MIN_NODE_H, nh + dy);
          if (corner.includes("n")) { nh = Math.max(MIN_NODE_H, nh - dy); ny = nh > MIN_NODE_H ? ny + dy : ny; }
          return { ...n, x: nx, y: ny, width: nw, height: nh };
        }),
      }));
      return;
    }
  }, [isDrawing, isPanning, isDraggingNode, drawingEdge, resizing, zoom, updateCanvas, screenToWorld]);

  const handleViewportPointerUp = useCallback((e: React.PointerEvent) => {
    if (isDrawing) {
      setIsDrawing(false);
      const points = drawPointsRef.current;
      if (points.length >= 2) {
        const drawNode = createDrawingNode(points, drawStrokeColor, drawStrokeWidth);
        updateCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, drawNode] }));
      }
      setCurrentDrawPoints([]);
      drawPointsRef.current = [];
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
      return;
    }

    if (isPanning) {
      setIsPanning(false);
      dragStartRef.current = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }

    if (isDraggingNode) {
      setIsDraggingNode(false);
      nodeDragRef.current = null;
      updateCanvas((prev) => ({ ...prev, edges: prev.edges.map((edge) => recalcEdgeSides(edge, prev.nodes)) }));
    }

    if (drawingEdge) {
      const world = screenToWorld(e.clientX, e.clientY);
      const targetNode = canvasData.nodes.find((n) => n.id !== drawingEdge.fromNode && world.x >= n.x && world.x <= n.x + n.width && world.y >= n.y && world.y <= n.y + n.height);
      if (targetNode) {
        const fromNode = canvasData.nodes.find((n) => n.id === drawingEdge.fromNode);
        if (fromNode) {
          const exists = canvasData.edges.some((edge) => (edge.fromNode === drawingEdge.fromNode && edge.toNode === targetNode.id) || (edge.fromNode === targetNode.id && edge.toNode === drawingEdge.fromNode));
          if (!exists) {
            const fromSide = drawingEdge.fromSide as "top" | "bottom" | "left" | "right";
            const opposite: Record<string, string> = { top: "bottom", bottom: "top", left: "right", right: "left" };
            const toSide = (opposite[fromSide] || "left") as "top" | "bottom" | "left" | "right";
            const newEdge = createEdge(drawingEdge.fromNode, targetNode.id, fromSide, toSide);
            const recalced = recalcEdgeSides(newEdge, canvasData.nodes);
            updateCanvas((prev) => ({ ...prev, edges: [...prev.edges, recalced] }));
          }
        }
      }
      setDrawingEdge(null);
    }

    if (resizing) {
      setResizing(null);
      updateCanvas((prev) => ({ ...prev, edges: prev.edges.map((edge) => recalcEdgeSides(edge, prev.nodes)) }));
    }
  }, [isDrawing, isPanning, isDraggingNode, drawingEdge, resizing, canvasData.nodes, canvasData.edges, screenToWorld, updateCanvas, drawStrokeColor, drawStrokeWidth]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const direction = e.deltaY > 0 ? -1 : 1;
    const factor = 1 + ZOOM_STEP * direction;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    const scale = newZoom / zoom;
    setPanX(mouseX - (mouseX - panX) * scale);
    setPanY(mouseY - (mouseY - panY) * scale);
    setZoom(newZoom);
  }, [zoom, panX, panY]);

  const handleNodePointerDown = useCallback((nodeId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setContextMenu(null);

    if (e.shiftKey) {
      setSelectedNodeIds((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
        return next;
      });
    } else {
      if (!selectedNodeIds.has(nodeId)) setSelectedNodeIds(new Set([nodeId]));
    }
    setSelectedEdgeId(null);

    if (editingNodeId === nodeId) return;

    setIsDraggingNode(true);
    const positions = new Map<string, { x: number; y: number }>();
    const idsToMove = selectedNodeIds.has(nodeId) ? selectedNodeIds : new Set([nodeId]);
    if (!selectedNodeIds.has(nodeId)) setSelectedNodeIds(new Set([nodeId]));
    for (const id of idsToMove) {
      const node = canvasData.nodes.find((n) => n.id === id);
      if (node) positions.set(id, { x: node.x, y: node.y });
    }
    const clickedNode = canvasData.nodes.find((n) => n.id === nodeId);
    if (clickedNode && !positions.has(nodeId)) positions.set(nodeId, { x: clickedNode.x, y: clickedNode.y });
    nodeDragRef.current = { nodeId, startX: e.clientX, startY: e.clientY, nodePositions: positions };
  }, [selectedNodeIds, editingNodeId, canvasData.nodes]);

  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    const node = canvasData.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    if (node.type === "text" || node.type === "group" || node.type === "sticky") {
      setEditingNodeId(nodeId);
    } else if (node.type === "file" && node.filePath) {
      flush();
      services.openNote(node.filePath);
    } else if (node.type === "image") {
      const cx = (-panX + viewportSize.w / 2) / zoom;
      const cy = (-panY + viewportSize.h / 2) / zoom;
      setImagePicker({ atX: cx, atY: cy, replacingNodeId: nodeId });
    }
  }, [canvasData.nodes, services, flush, panX, panY, zoom, viewportSize]);

  const handleTextChange = useCallback((nodeId: string, text: string) => {
    updateCanvas((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, text } : n)) }));
  }, [updateCanvas]);

  const handleLabelChange = useCallback((nodeId: string, label: string) => {
    updateCanvas((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, label } : n)) }));
  }, [updateCanvas]);

  const handleEditBlur = useCallback(() => { setEditingNodeId(null); }, []);

  const handleAnchorPointerDown = useCallback((nodeId: string, side: string, e: React.PointerEvent) => {
    e.preventDefault();
    const world = screenToWorld(e.clientX, e.clientY);
    setDrawingEdge({ fromNode: nodeId, fromSide: side, mouseX: world.x, mouseY: world.y });
  }, [screenToWorld]);

  const handleEdgeClick = useCallback((edgeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedEdgeId(edgeId);
    setSelectedNodeIds(new Set());
  }, []);

  const handleResizePointerDown = useCallback((nodeId: string, corner: string, e: React.PointerEvent) => {
    e.preventDefault();
    const node = canvasData.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setResizing({ nodeId, corner, startX: e.clientX, startY: e.clientY, origX: node.x, origY: node.y, origW: node.width, origH: node.height });
  }, [canvasData.nodes]);

  const handleNodeContextMenu = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedNodeIds(new Set([nodeId]));
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);

  const handleViewportContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!(e.target as HTMLElement).closest(".canvas-node")) setContextMenu({ x: e.clientX, y: e.clientY, nodeId: null });
  }, []);

  const deleteSelected = useCallback(() => {
    if (selectedEdgeId) {
      updateCanvas((prev) => ({ ...prev, edges: prev.edges.filter((e) => e.id !== selectedEdgeId) }));
      setSelectedEdgeId(null);
      return;
    }
    if (selectedNodeIds.size > 0) {
      updateCanvas((prev) => ({
        ...prev,
        nodes: prev.nodes.filter((n) => !selectedNodeIds.has(n.id)),
        edges: prev.edges.filter((e) => !selectedNodeIds.has(e.fromNode) && !selectedNodeIds.has(e.toNode)),
      }));
      setSelectedNodeIds(new Set());
    }
  }, [selectedNodeIds, selectedEdgeId, updateCanvas]);

  const duplicateSelected = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    const idMap = new Map<string, string>();
    const newNodes: CanvasNode[] = [];
    for (const id of selectedNodeIds) {
      const node = canvasData.nodes.find((n) => n.id === id);
      if (!node) continue;
      const newId = generateId();
      idMap.set(id, newId);
      newNodes.push({ ...node, id: newId, x: node.x + 30, y: node.y + 30 });
    }
    const newEdges: CanvasEdge[] = [];
    for (const edge of canvasData.edges) {
      if (idMap.has(edge.fromNode) && idMap.has(edge.toNode)) {
        newEdges.push({ ...edge, id: generateId(), fromNode: idMap.get(edge.fromNode)!, toNode: idMap.get(edge.toNode)! });
      }
    }
    updateCanvas((prev) => ({ nodes: [...prev.nodes, ...newNodes], edges: [...prev.edges, ...newEdges] }));
    setSelectedNodeIds(new Set(newNodes.map((n) => n.id)));
  }, [selectedNodeIds, canvasData, updateCanvas]);

  const changeSelectedColor = useCallback((color: string) => {
    if (contextMenu?.nodeId) {
      updateCanvas((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === contextMenu.nodeId ? { ...n, color: color || undefined } : n)) }));
    }
    setContextMenu(null);
  }, [contextMenu, updateCanvas]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingNodeId) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (document.activeElement === document.body || document.activeElement === viewportRef.current) {
          e.preventDefault();
          deleteSelected();
        }
      }

      if (e.key === "Escape") {
        if (selectedNodeIds.size > 0 || selectedEdgeId || editingNodeId || drawingEdge || isDrawing || contextMenu || activeTool !== "select") {
          setSelectedNodeIds(new Set());
          setSelectedEdgeId(null);
          setEditingNodeId(null);
          setContextMenu(null);
          setDrawingEdge(null);
          setActiveTool("select");
          setIsDrawing(false);
          setCurrentDrawPoints([]);
          drawPointsRef.current = [];
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        if (document.activeElement === document.body || document.activeElement === viewportRef.current) {
          e.preventDefault();
          setSelectedNodeIds(new Set(canvasData.nodes.map((n) => n.id)));
        }
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        if (selectedNodeIds.size > 0) { e.preventDefault(); duplicateSelected(); }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingNodeId, deleteSelected, duplicateSelected, canvasData.nodes, selectedNodeIds, selectedEdgeId, drawingEdge, isDrawing, contextMenu, activeTool]);

  const addTextNode = useCallback((atX?: number, atY?: number) => {
    const cx = atX ?? (-panX + viewportSize.w / 2) / zoom;
    const cy = atY ?? (-panY + viewportSize.h / 2) / zoom;
    const node = createTextNode(cx - 130, cy - 80, "");
    updateCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeIds(new Set([node.id]));
    setEditingNodeId(node.id);
    setActiveTool("select");
  }, [panX, panY, zoom, viewportSize, updateCanvas]);

  const addStickyNode = useCallback((atX?: number, atY?: number) => {
    const cx = atX ?? (-panX + viewportSize.w / 2) / zoom;
    const cy = atY ?? (-panY + viewportSize.h / 2) / zoom;
    const node = createStickyNode(cx - 100, cy - 100, "", "yellow");
    updateCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeIds(new Set([node.id]));
    setEditingNodeId(node.id);
    setActiveTool("select");
  }, [panX, panY, zoom, viewportSize, updateCanvas]);

  /** Opens the attachment picker to create (or replace) an image node. */
  const addImageNode = useCallback((atX?: number, atY?: number) => {
    const cx = atX ?? (-panX + viewportSize.w / 2) / zoom;
    const cy = atY ?? (-panY + viewportSize.h / 2) / zoom;
    setImagePicker({ atX: cx, atY: cy, replacingNodeId: null });
    setActiveTool("select");
  }, [panX, panY, zoom, viewportSize]);

  const handleImagePickerSelect = useCallback((target: string) => {
    if (!imagePicker) return;
    if (imagePicker.replacingNodeId) {
      updateCanvas((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === imagePicker.replacingNodeId ? { ...n, imagePath: target } : n)) }));
    } else {
      const node = createImageNode(imagePicker.atX - 150, imagePicker.atY - 120, target);
      updateCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
      setSelectedNodeIds(new Set([node.id]));
    }
    setImagePicker(null);
  }, [imagePicker, updateCanvas]);

  /** Change the color of a sticky note via context menu */
  const handleStickyColorChange = useCallback((color: string) => {
    if (contextMenu?.nodeId) {
      updateCanvas((prev) => ({ ...prev, nodes: prev.nodes.map((n) => (n.id === contextMenu.nodeId ? { ...n, color } : n)) }));
    }
    setContextMenu(null);
  }, [contextMenu, updateCanvas]);

  const handleFilePickerSelect = useCallback((selectedNoteId: string) => {
    const cx = (-panX + viewportSize.w / 2) / zoom;
    const cy = (-panY + viewportSize.h / 2) / zoom;
    const node = createFileNode(cx - 130, cy - 60, selectedNoteId);
    updateCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeIds(new Set([node.id]));
    setShowFilePicker(false);
  }, [panX, panY, zoom, viewportSize, updateCanvas]);

  const addGroupNode = useCallback(() => {
    const cx = (-panX + viewportSize.w / 2) / zoom;
    const cy = (-panY + viewportSize.h / 2) / zoom;
    const node = createGroupNode(cx - 200, cy - 150, 400, 300, labels.group);
    updateCanvas((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
    setSelectedNodeIds(new Set([node.id]));
  }, [panX, panY, zoom, viewportSize, updateCanvas]);

  const zoomIn = useCallback(() => {
    const newZoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP);
    const cx = viewportSize.w / 2, cy = viewportSize.h / 2;
    const scale = newZoom / zoom;
    setPanX(cx - (cx - panX) * scale);
    setPanY(cy - (cy - panY) * scale);
    setZoom(newZoom);
  }, [zoom, panX, panY, viewportSize]);

  const zoomOut = useCallback(() => {
    const newZoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP);
    const cx = viewportSize.w / 2, cy = viewportSize.h / 2;
    const scale = newZoom / zoom;
    setPanX(cx - (cx - panX) * scale);
    setPanY(cy - (cy - panY) * scale);
    setZoom(newZoom);
  }, [zoom, panX, panY, viewportSize]);

  const resetZoom = useCallback(() => { setZoom(1); setPanX(0); setPanY(0); }, []);

  const zoomToFit = useCallback(() => {
    if (canvasData.nodes.length === 0) { resetZoom(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of canvasData.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width); maxY = Math.max(maxY, n.y + n.height);
    }
    const pad = 80;
    const worldW = maxX - minX + pad * 2;
    const worldH = maxY - minY + pad * 2;
    const fitZoom = Math.min(viewportSize.w / worldW, viewportSize.h / worldH, 1.5);
    const fitPanX = (viewportSize.w - worldW * fitZoom) / 2 - (minX - pad) * fitZoom;
    const fitPanY = (viewportSize.h - worldH * fitZoom) / 2 - (minY - pad) * fitZoom;
    setZoom(fitZoom);
    setPanX(fitPanX);
    setPanY(fitPanY);
  }, [canvasData.nodes, viewportSize, resetZoom]);

  useEffect(() => {
    if (didFitRef.current || !loadedRef.current || !measuredRef.current) return;
    if (viewportSize.w <= 0 || viewportSize.h <= 0) return;
    didFitRef.current = true;
    zoomToFit();
  }, [canvasData, viewportSize, zoomToFit]);

  const drawingEdgeSvg = useMemo(() => {
    if (!drawingEdge) return null;
    const fromNode = canvasData.nodes.find((n) => n.id === drawingEdge.fromNode);
    if (!fromNode) return null;
    const fromPt = getAnchorPoint(fromNode, drawingEdge.fromSide as "top" | "bottom" | "left" | "right");
    return <line x1={fromPt.x} y1={fromPt.y} x2={drawingEdge.mouseX} y2={drawingEdge.mouseY} className="canvas-edge-drawing" />;
  }, [drawingEdge, canvasData.nodes]);

  const sortedNodes = useMemo(() => {
    const groups = canvasData.nodes.filter((n) => n.type === "group");
    const others = canvasData.nodes.filter((n) => n.type !== "group" && n.type !== "drawing");
    const drawings = canvasData.nodes.filter((n) => n.type === "drawing");
    return [...groups, ...others, ...drawings];
  }, [canvasData.nodes]);

  const selectedNodeColor = useMemo(() => {
    if (contextMenu?.nodeId) {
      const node = canvasData.nodes.find((n) => n.id === contextMenu.nodeId);
      return node?.color || "";
    }
    return "";
  }, [contextMenu, canvasData.nodes]);

  const selectedNodeType = useMemo(() => {
    if (contextMenu?.nodeId) {
      const node = canvasData.nodes.find((n) => n.id === contextMenu.nodeId);
      return node?.type || "";
    }
    return "";
  }, [contextMenu, canvasData.nodes]);

  const bgPosX = panX % (24 * zoom);
  const bgPosY = panY % (24 * zoom);
  const bgSize = 24 * zoom;

  return (
    <div ref={containerRef} className="canvas-container">
      <div ref={viewportRef}
        className={`canvas-viewport${isPanning ? " is-panning" : ""}${drawingEdge ? " is-connecting" : ""}${activeTool === "draw" ? " is-drawing" : ""}`}
        onPointerDown={handleViewportPointerDown} onPointerMove={handleViewportPointerMove} onPointerUp={handleViewportPointerUp}
        onWheel={handleWheel} onContextMenu={handleViewportContextMenu}
        style={{ backgroundPosition: `${bgPosX}px ${bgPosY}px`, backgroundSize: `${bgSize}px ${bgSize}px` }} tabIndex={0}>
        <div className="canvas-transform" style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})` }}>
          <svg className="canvas-edges-svg">
            <EdgeMarkerDefs />
            {canvasData.edges.map((edge) => (
              <EdgeLine key={edge.id} edge={edge} nodes={canvasData.nodes} selected={selectedEdgeId === edge.id} onClick={handleEdgeClick} />
            ))}
            {drawingEdgeSvg}
          </svg>

          {sortedNodes.map((node) => {
            const isSelected = selectedNodeIds.has(node.id);
            if (node.type === "text") {
              return <TextNodeView key={node.id} node={node} selected={isSelected} editing={editingNodeId === node.id}
                onPointerDown={handleNodePointerDown} onDoubleClick={handleNodeDoubleClick} onTextChange={handleTextChange}
                onTextBlur={handleEditBlur} onAnchorPointerDown={handleAnchorPointerDown} onResizePointerDown={handleResizePointerDown} onContextMenu={handleNodeContextMenu} />;
            }
            if (node.type === "file") {
              return <FileNodeView key={node.id} node={node} selected={isSelected} preview={node.filePath ? filePreviews[node.filePath] || "" : ""}
                noteName={node.filePath ? noteNames[node.filePath] || "" : ""}
                onPointerDown={handleNodePointerDown} onDoubleClick={handleNodeDoubleClick}
                onAnchorPointerDown={handleAnchorPointerDown} onResizePointerDown={handleResizePointerDown} onContextMenu={handleNodeContextMenu} />;
            }
            if (node.type === "group") {
              return <GroupNodeView key={node.id} node={node} selected={isSelected} editingLabel={editingNodeId === node.id} defaultLabel={labels.group}
                onPointerDown={handleNodePointerDown} onDoubleClick={handleNodeDoubleClick} onLabelChange={handleLabelChange}
                onLabelBlur={handleEditBlur} onResizePointerDown={handleResizePointerDown} onContextMenu={handleNodeContextMenu} />;
            }
            if (node.type === "sticky") {
              return <StickyNoteView key={node.id} node={node} selected={isSelected} editing={editingNodeId === node.id}
                onPointerDown={handleNodePointerDown} onDoubleClick={handleNodeDoubleClick} onTextChange={handleTextChange}
                onTextBlur={handleEditBlur} onAnchorPointerDown={handleAnchorPointerDown} onResizePointerDown={handleResizePointerDown} onContextMenu={handleNodeContextMenu} />;
            }
            if (node.type === "image") {
              return <ImageNodeView key={node.id} node={node} services={services} selected={isSelected}
                onPointerDown={handleNodePointerDown} onDoubleClick={handleNodeDoubleClick}
                onAnchorPointerDown={handleAnchorPointerDown} onResizePointerDown={handleResizePointerDown} onContextMenu={handleNodeContextMenu} />;
            }
            if (node.type === "drawing") {
              return <DrawingNodeView key={node.id} node={node} selected={isSelected} onPointerDown={handleNodePointerDown} onContextMenu={handleNodeContextMenu} />;
            }
            return null;
          })}

          {isDrawing && currentDrawPoints.length >= 2 && (
            <svg className="canvas-drawing-live-svg">
              <polyline points={currentDrawPoints.map(([px, py]) => `${px},${py}`).join(" ")} fill="none" stroke={drawStrokeColor} strokeWidth={drawStrokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>

      <div className="canvas-toolbar">
        <button className={`canvas-toolbar-btn${activeTool === "select" ? " active" : ""}`} onClick={() => setActiveTool("select")} title={labels.select}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 2l8 6-3.5.5L10 13l-2-1-2.5-4.5L3 10V2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>
        </button>
        <div className="canvas-toolbar-divider" />
        <button className={`canvas-toolbar-btn${activeTool === "text" ? " active" : ""}`} onClick={() => { setActiveTool("select"); addTextNode(); }} title={labels.addText}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3h10M8 3v10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        <button className={`canvas-toolbar-btn${activeTool === "sticky" ? " active" : ""}`} onClick={() => { setActiveTool("select"); addStickyNode(); }} title={labels.addSticky}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.3" fill="rgba(249,226,175,0.3)" /><path d="M5 6h6M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
        </button>
        <button className={`canvas-toolbar-btn${activeTool === "image" ? " active" : ""}`} onClick={() => { addImageNode(); }} title={labels.addImage}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" /><circle cx="5" cy="6" r="1.5" stroke="currentColor" strokeWidth="1" /><path d="M1 11l4-3 3 2 3-4 4 5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
        </button>
        <button className="canvas-toolbar-btn" onClick={() => setShowFilePicker(true)} title={labels.addFile}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 1h5l4 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" /><path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.3" /></svg>
        </button>
        <button className="canvas-toolbar-btn" onClick={addGroupNode} title={labels.addGroup}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" strokeDasharray="3 2" /></svg>
        </button>
        <div className="canvas-toolbar-divider" />
        <button className={`canvas-toolbar-btn${activeTool === "draw" ? " active" : ""}`} onClick={() => setActiveTool(activeTool === "draw" ? "select" : "draw")} title={labels.draw}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 13.5l1-4L11 2l2.5 2.5-7.5 7.5-4 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /><path d="M9.5 3.5l2.5 2.5" stroke="currentColor" strokeWidth="1.3" /></svg>
        </button>
        {activeTool === "draw" && (
          <>
            <div className="canvas-toolbar-divider" />
            <div className="canvas-toolbar-color-group">
              {DRAW_STROKE_COLORS.map((c) => (
                <div key={c} className={`canvas-toolbar-color-dot${drawStrokeColor === c ? " active" : ""}`} style={{ background: c }} onClick={() => setDrawStrokeColor(c)} />
              ))}
            </div>
          </>
        )}
        <div className="canvas-toolbar-divider" />
        <button className="canvas-toolbar-btn" onClick={zoomOut} title={labels.zoomOut}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" /><path d="M5 7h4M11 11l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
        <span className="canvas-toolbar-zoom" onClick={resetZoom} title={labels.resetZoom}>{Math.round(zoom * 100)}%</span>
        <button className="canvas-toolbar-btn" onClick={zoomIn} title={labels.zoomIn}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" /><path d="M5 7h4M7 5v4M11 11l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
        <button className="canvas-toolbar-btn" onClick={zoomToFit} title={labels.zoomToFit}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 6V3a1 1 0 011-1h3M10 2h3a1 1 0 011 1v3M14 10v3a1 1 0 01-1 1h-3M6 14H3a1 1 0 01-1-1v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="canvas-toolbar-divider" />
        <button className="canvas-toolbar-btn" onClick={deleteSelected} disabled={selectedNodeIds.size === 0 && !selectedEdgeId} title={labels.deleteSelected}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V3a1 1 0 011-1h2a1 1 0 011 1v1M5 4v9a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
      </div>

      <Minimap nodes={canvasData.nodes} panX={panX} panY={panY} zoom={zoom} viewportWidth={viewportSize.w} viewportHeight={viewportSize.h} />

      {contextMenu && (
        <CanvasContextMenu x={contextMenu.x} y={contextMenu.y} nodeId={contextMenu.nodeId} nodeType={selectedNodeType} nodeColor={selectedNodeColor}
          onDelete={() => { deleteSelected(); setContextMenu(null); }} onColorChange={changeSelectedColor} onStickyColorChange={handleStickyColorChange}
          onDuplicate={() => { duplicateSelected(); setContextMenu(null); }}
          onAddTextNode={() => { const world = screenToWorld(contextMenu.x, contextMenu.y); addTextNode(world.x, world.y); setContextMenu(null); }}
          onAddStickyNote={() => { const world = screenToWorld(contextMenu.x, contextMenu.y); addStickyNode(world.x, world.y); setContextMenu(null); }}
          onAddImage={() => { const world = screenToWorld(contextMenu.x, contextMenu.y); addImageNode(world.x, world.y); setContextMenu(null); }}
          onClose={() => setContextMenu(null)} labels={labels.menu} />
      )}

      {showFilePicker && <FilePicker notes={filePickerNotes} labels={labels} onSelect={handleFilePickerSelect} onClose={() => setShowFilePicker(false)} />}
      {imagePicker && <ImagePicker services={services} labels={labels} onSelect={handleImagePickerSelect} onClose={() => setImagePicker(null)} />}
    </div>
  );
}
