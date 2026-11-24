import React from "react";

export interface ContextUsageMeterProps {
  usedTokens: number;
  maxTokens: number;
  onCompact?: () => void;
  compactLabel?: string;
}

/**
 * Context Usage Meter:
 * A compact SVG circular arc meter showing % of model context window used.
 * Turns amber/red when reaching capacity (>= 80%) with a compact action.
 * Inspired by Claudian `ContextUsageMeter.ts`.
 */
export const ContextUsageMeter: React.FC<ContextUsageMeterProps> = ({
  usedTokens,
  maxTokens,
  onCompact,
  compactLabel = "Compact",
}) => {
  const percent = Math.min(100, Math.max(0, Math.round((usedTokens / maxTokens) * 100)));
  const isHigh = percent >= 80;
  const isCritical = percent >= 95;

  const color = isCritical
    ? "var(--color-danger, #ef4444)"
    : isHigh
    ? "var(--color-warning, #f59e0b)"
    : "var(--color-accent, #3b82f6)";

  return (
    <div
      className="flex items-center gap-2 text-xs text-[var(--text-secondary)] select-none"
      title={`Context usage: ${usedTokens.toLocaleString()} / ${maxTokens.toLocaleString()} tokens (${percent}%)`}
    >
      <div className="relative w-5 h-5 flex items-center justify-center">
        <svg className="w-5 h-5 transform -rotate-90" viewBox="0 0 36 36">
          <path
            className="text-[var(--border-subtle, #374151)]"
            stroke="currentColor"
            strokeWidth="3.5"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          <path
            stroke={color}
            strokeDasharray={`${percent}, 100`}
            strokeWidth="3.5"
            strokeLinecap="round"
            fill="none"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
        </svg>
      </div>
      <span className="font-mono">{percent}%</span>

      {isHigh && onCompact && (
        <button
          type="button"
          onClick={onCompact}
          className="px-1.5 py-0.5 rounded text-[11px] bg-[var(--bg-modifier-hover)] hover:bg-[var(--bg-modifier-active)] text-[var(--color-warning, #f59e0b)] border border-[var(--color-warning)]"
        >
          {compactLabel}
        </button>
      )}
    </div>
  );
};

export default ContextUsageMeter;
