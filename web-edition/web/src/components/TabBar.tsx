"use client";

import { useState, useCallback } from "react";
import ContextMenu, { ContextMenuItem } from "@/components/ContextMenu";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

export interface TabBarTab {
  noteId: string;
  path: string;
  name: string;
  isDirty: boolean;
}

interface TabBarProps {
  tabs: TabBarTab[];
  activeTabId: string | null;
  pinnedTabIds: Set<string>;
  onTabSelect: (noteId: string) => void;
  onTabClose: (noteId: string) => void;
  onTabReorder: (from: number, to: number) => void;
  onTogglePin: (noteId: string) => void;
  onCloseOtherTabs: (noteId: string) => void;
  onCloseAllTabs: () => void;
  onCloseTabsToRight: (noteId: string) => void;
  onSplitRight: (noteId: string) => void;
  onNewTab: () => void;
}

/**
 * Multi-note tab strip — ported from desktop's TitleBar.tsx `.tab-bar` section
 * (pin/reorder/context-menu logic). Desktop also renders window-chrome
 * controls and the view-mode toggle in the same component; those stay split
 * out into VaultHeader.tsx on web, so this file only owns the tab strip.
 */
export default function TabBar({
  tabs,
  activeTabId,
  pinnedTabIds,
  onTabSelect,
  onTabClose,
  onTabReorder,
  onTogglePin,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCloseTabsToRight,
  onSplitRight,
  onNewTab,
}: TabBarProps) {
  useLocale();
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; noteId: string } | null>(null);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== idx) onTabReorder(dragIdx, idx);
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    setDragIdx(null);
    setDragOverIdx(null);
  };

  const handleTabContextMenu = useCallback((e: React.MouseEvent, noteId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu({ x: e.clientX, y: e.clientY, noteId });
  }, []);

  const getTabContextMenuItems = useCallback((): ContextMenuItem[] => {
    if (!tabContextMenu) return [];
    const id = tabContextMenu.noteId;
    const isPinned = pinnedTabIds.has(id);
    return [
      { label: isPinned ? t("shell.tabs.unpin") : t("shell.tabs.pin"), onClick: () => onTogglePin(id) },
      { label: "", separator: true, onClick: () => {} },
      { label: t("shell.tabs.close"), onClick: () => onTabClose(id) },
      { label: t("shell.tabs.closeOthers"), onClick: () => onCloseOtherTabs(id) },
      { label: t("shell.tabs.closeRight"), onClick: () => onCloseTabsToRight(id) },
      { label: t("shell.tabs.closeAll"), onClick: () => onCloseAllTabs() },
      { label: "", separator: true, onClick: () => {} },
      { label: t("shell.tabs.openInSplit"), onClick: () => onSplitRight(id) },
    ];
  }, [tabContextMenu, pinnedTabIds, onTogglePin, onTabClose, onCloseOtherTabs, onCloseTabsToRight, onCloseAllTabs, onSplitRight]);

  // Pinned tabs sort first, preserving relative order within each group.
  const sortedTabs = [...tabs].sort((a, b) => {
    const aPinned = pinnedTabIds.has(a.noteId);
    const bPinned = pinnedTabIds.has(b.noteId);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return 0;
  });

  return (
    <div className="tab-bar">
      {sortedTabs.map((tab) => {
        const idx = tabs.findIndex((t) => t.noteId === tab.noteId);
        const isActive = tab.noteId === activeTabId;
        const isDragging = dragIdx === idx;
        const isDragOver = dragOverIdx === idx && dragIdx !== idx;
        const isPinned = pinnedTabIds.has(tab.noteId);

        return (
          <div
            key={tab.noteId}
            draggable
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            onDragEnd={handleDragEnd}
            onClick={() => onTabSelect(tab.noteId)}
            onContextMenu={(e) => handleTabContextMenu(e, tab.noteId)}
            title={tab.path}
            className={`tab${isActive ? " tab-active" : ""}${isDragging ? " tab-dragging" : ""}${isDragOver ? " tab-dragover" : ""}${isPinned ? " tab-pinned" : ""}`}
          >
            {isPinned && (
              <svg className="tab-pin-icon" width="10" height="10" viewBox="0 0 16 16" fill="none">
                <path d="M9.5 2L14 6.5L10 10.5L8.5 14L2 7.5L5.5 6L9.5 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                <path d="M5.5 10.5L2 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            )}
            <span className="tab-label">{tab.name}</span>
            {tab.isDirty && <span className="tab-dirty" />}
            {!isPinned && (
              <button onClick={(e) => { e.stopPropagation(); onTabClose(tab.noteId); }} className="tab-close">
                <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
              </button>
            )}
          </div>
        );
      })}

      <button onClick={onNewTab} className="tab-new" title={t("web.tabs.newTab")}>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
      </button>

      {tabContextMenu && (
        <ContextMenu
          x={tabContextMenu.x}
          y={tabContextMenu.y}
          items={getTabContextMenuItems()}
          onClose={() => setTabContextMenu(null)}
        />
      )}
    </div>
  );
}
