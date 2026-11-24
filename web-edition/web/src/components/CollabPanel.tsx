"use client";

import type { CollabPeer } from "@/lib/collab";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

interface CollabPanelProps {
  connected: boolean;
  peers: CollabPeer[];
  onClose: () => void;
}

/**
 * Ported from desktop/src/components/CollabPanel.tsx, simplified per the plan
 * (docs/plans/2026-10-12-noteriv-web-version.md §8): desktop needed a room-code
 * share/join flow because a session had no durable identity. A web note already
 * has one (its id) — whoever has access to the note is automatically in the same
 * room — so this is now a pure presence display, not a join flow.
 */
export default function CollabPanel({ connected, peers, onClose }: CollabPanelProps) {
  useLocale();
  return (
    <div className="w-72 border-l border-[var(--border)] overflow-y-auto p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">{t("web.collab.title")}</span>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          ×
        </button>
      </div>

      <div className="flex items-center gap-2 mb-3 text-xs">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: connected ? "var(--green)" : "var(--text-muted)" }}
        />
        <span className={connected ? "text-[var(--green)]" : "text-[var(--text-muted)]"}>
          {connected ? t("web.collab.live") : t("web.collab.connecting")}
        </span>
      </div>

      <div className="text-xs text-[var(--text-muted)] mb-2">
        {peers.length === 0 ? t("web.collab.alone") : t("web.collab.peers", { count: peers.length })}
      </div>

      <div className="flex flex-col gap-1.5">
        {peers.map((p) => (
          <div key={p.clientId} className="flex items-center gap-2 text-sm">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
            <span>{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
