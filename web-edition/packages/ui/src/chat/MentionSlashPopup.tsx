import React from "react";
import type { SlashCommand, PopupMode } from "./useMentionSlash";

export interface MentionSlashPopupProps<TNote> {
  mode: PopupMode;
  filteredCommands: SlashCommand[];
  filteredNotes: TNote[];
  selectedIndex: number;
  getNotePath: (note: TNote) => string;
  getNoteName: (note: TNote) => string;
  onSelectCommand: (cmd: SlashCommand) => void;
  onSelectNote: (note: TNote) => void;
}

export function MentionSlashPopup<TNote>({
  mode,
  filteredCommands,
  filteredNotes,
  selectedIndex,
  getNotePath,
  getNoteName,
  onSelectCommand,
  onSelectNote,
}: MentionSlashPopupProps<TNote>) {
  if (!mode) return null;

  if (mode === "slash" && filteredCommands.length === 0) return null;
  if (mode === "mention" && filteredNotes.length === 0) return null;

  return (
    <div className="mx-3 mb-1 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg shadow-xl overflow-hidden text-xs max-h-60 flex flex-col z-20 animate-in fade-in slide-in-from-bottom-2 duration-150">
      <div className="px-2.5 py-1.5 bg-[var(--bg-primary)] border-b border-[var(--border-subtle)] text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider flex items-center justify-between">
        <span>{mode === "slash" ? "⚡ Lệnh nhanh (Slash Commands)" : "📄 Nhắc đến ghi chú (@mentions)"}</span>
        <span className="font-normal text-[10px] lowercase text-[var(--text-muted)]">↑↓ điều hướng • ↵ chọn</span>
      </div>

      <div className="overflow-y-auto p-1 space-y-0.5">
        {mode === "slash" &&
          filteredCommands.map((cmd, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={cmd.id}
                type="button"
                onClick={() => onSelectCommand(cmd)}
                className={`w-full text-left px-2.5 py-2 rounded-md flex items-center gap-2.5 transition-colors ${
                  isSelected
                    ? "bg-[var(--interactive-accent, #3b82f6)] text-white"
                    : "hover:bg-[var(--bg-modifier-hover)] text-[var(--text-primary)]"
                }`}
              >
                <span className="text-base shrink-0">{cmd.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs">{cmd.name}</span>
                    <span className={`font-mono text-[11px] ${isSelected ? "text-white/80" : "text-[var(--text-muted)]"}`}>
                      {cmd.command}
                    </span>
                  </div>
                  <div className={`truncate text-[11px] ${isSelected ? "text-white/90" : "text-[var(--text-secondary)]"}`}>
                    {cmd.description}
                  </div>
                </div>
              </button>
            );
          })}

        {mode === "mention" &&
          filteredNotes.map((n, idx) => {
            const isSelected = idx === selectedIndex;
            const path = getNotePath(n);
            const name = getNoteName(n);
            const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
            return (
              <button
                key={path}
                type="button"
                onClick={() => onSelectNote(n)}
                className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 transition-colors ${
                  isSelected
                    ? "bg-[var(--interactive-accent, #3b82f6)] text-white"
                    : "hover:bg-[var(--bg-modifier-hover)] text-[var(--text-primary)]"
                }`}
              >
                <span className="text-sm shrink-0">📄</span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate text-xs">{name}</div>
                  {folder && (
                    <div className={`truncate text-[10px] ${isSelected ? "text-white/80" : "text-[var(--text-muted)]"}`}>
                      📁 {folder}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
}

export default MentionSlashPopup;
