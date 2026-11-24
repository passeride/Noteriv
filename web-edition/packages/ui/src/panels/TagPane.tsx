"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { aggregateTags } from "@noteriv/core/tag-utils";
import type { NoteRef, VaultAdapter } from "@noteriv/core/vault-adapter";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";

interface TagPaneProps {
  adapter: VaultAdapter | null;
  onTagClick: (tag: string) => void;
  onNoteSelect: (noteId: string) => void;
  visible: boolean;
}

interface TagInfo {
  tag: string;
  count: number;
  notes: NoteRef[];
}

/**
 * A tree node for nested tags.
 * e.g. #project/alpha/beta becomes:
 *   project (segment) -> alpha (segment) -> beta (segment)
 */
interface TagTreeNode {
  segment: string;
  fullTag: string | null; // non-null if this node represents an actual tag
  count: number;
  notes: NoteRef[];
  children: Map<string, TagTreeNode>;
}

function buildTagTree(tags: TagInfo[]): Map<string, TagTreeNode> {
  const root = new Map<string, TagTreeNode>();

  for (const tagInfo of tags) {
    const rawTag = tagInfo.tag.startsWith("#") ? tagInfo.tag.slice(1) : tagInfo.tag;
    const segments = rawTag.split("/");
    let currentLevel = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (!currentLevel.has(segment)) {
        currentLevel.set(segment, {
          segment,
          fullTag: null,
          count: 0,
          notes: [],
          children: new Map(),
        });
      }

      const node = currentLevel.get(segment)!;

      if (isLast) {
        node.fullTag = tagInfo.tag;
        node.count = tagInfo.count;
        node.notes = tagInfo.notes;
      }

      currentLevel = node.children;
    }
  }

  return root;
}

function getTotalCount(node: TagTreeNode): number {
  let total = node.count;
  for (const child of node.children.values()) {
    total += getTotalCount(child);
  }
  return total;
}

function nodeMatchesFilter(node: TagTreeNode, filter: string): boolean {
  const lower = filter.toLowerCase();
  if (node.segment.toLowerCase().includes(lower)) return true;
  if (node.fullTag && node.fullTag.toLowerCase().includes(lower)) return true;
  for (const child of node.children.values()) {
    if (nodeMatchesFilter(child, lower)) return true;
  }
  return false;
}

function TagTreeItem({
  node,
  depth,
  filter,
  expandedNodes,
  onToggle,
  onTagClick,
  onNoteSelect,
  selectedTag,
}: {
  node: TagTreeNode;
  depth: number;
  filter: string;
  expandedNodes: Set<string>;
  onToggle: (key: string) => void;
  onTagClick: (tag: string) => void;
  onNoteSelect: (noteId: string) => void;
  selectedTag: string | null;
}) {
  const hasChildren = node.children.size > 0;
  const nodeKey = node.fullTag || `__group:${node.segment}:${depth}`;
  const isExpanded = expandedNodes.has(nodeKey);
  const totalCount = getTotalCount(node);
  const isSelected = selectedTag === node.fullTag;

  if (filter && !nodeMatchesFilter(node, filter)) {
    return null;
  }

  const sortedChildren = Array.from(node.children.values()).sort(
    (a, b) => getTotalCount(b) - getTotalCount(a) || a.segment.localeCompare(b.segment)
  );

  return (
    <div className="tag-tree-item">
      <button
        className={`tag-tree-row ${isSelected ? "tag-tree-row-active" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => {
          if (node.fullTag) onTagClick(node.fullTag);
          if (hasChildren) onToggle(nodeKey);
        }}
        title={
          node.fullTag
            ? t("panels.tags.tagTitle", { tag: node.fullTag, count: node.count })
            : t("panels.tags.groupTitle", { segment: node.segment, count: totalCount })
        }
      >
        {hasChildren && (
          <svg width="10" height="10" viewBox="0 0 10 10" className={`tag-tree-chevron ${isExpanded ? "tag-tree-chevron-open" : ""}`}>
            <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {!hasChildren && <span className="tag-tree-spacer" />}

        <span className="tag-tree-hash">#</span>
        <span className="tag-tree-label">{node.segment}</span>
        <span className="tag-tree-count">{totalCount}</span>
      </button>

      {isSelected && node.fullTag && node.notes.length > 0 && (
        <div className="tag-files-list">
          {node.notes.map((note) => (
            <button
              key={note.id}
              className="tag-file-item"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              onClick={(e) => {
                e.stopPropagation();
                onNoteSelect(note.id);
              }}
              title={note.path}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="tag-file-icon">
                <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" fill="none" />
                <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" fill="none" />
              </svg>
              <span className="tag-file-name">{note.name.replace(/\.(md|markdown)$/i, "")}</span>
            </button>
          ))}
        </div>
      )}

      {isExpanded &&
        sortedChildren.map((child) => (
          <TagTreeItem
            key={child.segment}
            node={child}
            depth={depth + 1}
            filter={filter}
            expandedNodes={expandedNodes}
            onToggle={onToggle}
            onTagClick={onTagClick}
            onNoteSelect={onNoteSelect}
            selectedTag={selectedTag}
          />
        ))}
    </div>
  );
}

export default function TagPane({ adapter, onTagClick, onNoteSelect, visible }: TagPaneProps) {
  useLocale();
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const loadTags = useCallback(async () => {
    if (!adapter) return;
    setLoading(true);
    try {
      const result = await aggregateTags(await adapter.listNotes(), (id) => adapter.readNote(id));
      setTags(result);
    } catch (err) {
      console.error("Failed to load tags:", err);
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    if (visible && adapter) loadTags();
  }, [visible, adapter, loadTags]);

  const tree = useMemo(() => buildTagTree(tags), [tags]);

  const handleToggle = useCallback((key: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleTagClick = useCallback(
    (tag: string) => {
      setSelectedTag((prev) => (prev === tag ? null : tag));
      onTagClick(tag);
    },
    [onTagClick]
  );

  const handleExpandAll = useCallback(() => {
    const allKeys = new Set<string>();
    function collectKeys(nodes: Map<string, TagTreeNode>, depth: number) {
      for (const node of nodes.values()) {
        if (node.children.size > 0) {
          const key = node.fullTag || `__group:${node.segment}:${depth}`;
          allKeys.add(key);
          collectKeys(node.children, depth + 1);
        }
      }
    }
    collectKeys(tree, 0);
    setExpandedNodes(allKeys);
  }, [tree]);

  const handleCollapseAll = useCallback(() => {
    setExpandedNodes(new Set());
    setSelectedTag(null);
  }, []);

  if (!visible) return null;

  const sortedRootNodes = Array.from(tree.values()).sort(
    (a, b) => getTotalCount(b) - getTotalCount(a) || a.segment.localeCompare(b.segment)
  );

  const totalTagCount = tags.length;

  return (
    <div className="tag-pane">
      <div className="tag-pane-header">
        <span className="tag-pane-title">
          {t("panels.tags.title")}
          {totalTagCount > 0 && <span className="tag-pane-total">{totalTagCount}</span>}
        </span>
        <div className="tag-pane-actions">
          <button className="tag-pane-btn" onClick={handleExpandAll} title={t("panels.tags.expandAll")}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="tag-pane-btn" onClick={handleCollapseAll} title={t("panels.tags.collapseAll")}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="tag-pane-btn" onClick={loadTags} title={t("panels.tags.refresh")} disabled={loading}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className={loading ? "tag-pane-spin" : ""}>
              <path d="M14 8A6 6 0 114 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M14 3v5h-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="tag-pane-filter">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className="tag-filter-icon">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <input
          ref={filterInputRef}
          type="text"
          placeholder={t("panels.tags.filter")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="tag-filter-input"
        />
        {filter && (
          <button className="tag-filter-clear" onClick={() => setFilter("")} title={t("panels.tags.clearFilter")}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="tag-pane-content">
        {loading && tags.length === 0 ? (
          <div className="tag-pane-empty">
            <span className="tag-pane-loading">{t("panels.tags.scanning")}</span>
          </div>
        ) : sortedRootNodes.length === 0 ? (
          <div className="tag-pane-empty">
            <span>{filter ? t("panels.tags.noMatch") : t("panels.tags.empty")}</span>
          </div>
        ) : (
          sortedRootNodes.map((node) => (
            <TagTreeItem
              key={node.segment}
              node={node}
              depth={0}
              filter={filter}
              expandedNodes={expandedNodes}
              onToggle={handleToggle}
              onTagClick={handleTagClick}
              onNoteSelect={onNoteSelect}
              selectedTag={selectedTag}
            />
          ))
        )}
      </div>
    </div>
  );
}
