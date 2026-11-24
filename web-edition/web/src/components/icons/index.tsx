/**
 * Shared hand-authored SVG icon set, matching desktop's exact convention
 * (no icon library in either project): viewBox 16x16 (12x12/10x10 for small
 * controls), fill="none", stroke="currentColor", strokeWidth 1.2-1.4.
 * Icons marked "ported" copy desktop's path data verbatim (see
 * desktop/src/app/page.tsx's ribbon block and TitleBar.tsx/Sidebar.tsx).
 * Icons marked "new" have no desktop equivalent (web-only features) and are
 * hand-authored here in the same stroke style.
 */

interface IconProps {
  size?: number;
  className?: string;
}

// ── Ported from desktop's ribbon (desktop/src/app/page.tsx) ──

export function QuickOpenIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function NewNoteIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 6v4M6 8h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3 4h10M3 8h7M3 12h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="12" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M14 13l1 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Ported from desktop's TitleBar.tsx / Sidebar.tsx ──

export function SidebarToggleIcon({ size = 14, className, collapsed = false }: IconProps & { collapsed?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <rect x="1" y="2" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" fill={collapsed ? "none" : "rgba(137,180,250,0.12)"} />
      <rect x="7" y="2" width="8" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function ChevronIcon({ size = 10, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className={className}>
      <path d="M3.5 2L7 5L3.5 8" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon({ size = 10, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className={className}>
      <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function VaultChevronIcon({ size = 10, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" className={className}>
      <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── New — web-only features, no desktop equivalent, same stroke style ──

export function SnippetsIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M5.5 3L2 8l3.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.5 3L14 8l-3.5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 2.5L7 13.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function PluginIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M6 2v2.5M10 2v2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M3.5 4.5h9v4a2 2 0 01-2 2h-5a2 2 0 01-2-2v-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 10.5V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.5 14h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function BacklinksIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 4.5h3a2 2 0 012 2v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M8.3 5.2L7 4.5l.7-1.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CollabIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="5.5" cy="5.5" r="2.2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="11" cy="7.5" r="1.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 13c0-2.2 1.6-3.5 3.5-3.5S9 10.8 9 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M9.3 11c.4-1 1.4-1.6 2.5-1.6 1.6 0 2.7 1.1 2.7 2.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function ExportIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M4 2h5l3 3v9H4V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 6.5v4M6.2 8.7L8 10.5l1.8-1.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RenameIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function OutlineIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M2 4h3M7 4h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2 8h2M6 8h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2 12h2M6 12h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function TagIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M2 2h5l7 7-5 5-7-7V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="5" cy="5" r="1" fill="currentColor" />
    </svg>
  );
}

export function TrashIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3 4.5h10M6.5 4.5V3a1 1 0 011-1h1a1 1 0 011 1v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4.5 4.5l.6 9a1 1 0 001 .9h3.8a1 1 0 001-.9l.6-9" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function BookmarkIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M4 2.5h8a.5.5 0 01.5.5v10.5l-4.5-3-4.5 3V3a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function AttachmentIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M10.5 4.5l-5 5a2.121 2.121 0 103 3l5-5a3.536 3.536 0 10-5-5l-5 5a1 1 0 001.414 1.414l5-5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PublishIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <path d="M3 6.5l5-4 5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 2.5v8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M3 10.5v3h10v-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** File Recovery button (D5): the clock glyph of FileRecovery.tsx's header. */
export function HistoryIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4v4l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Phase D8 — Audio recorder. */
// ── Phase 1 discoverability additions (docs/plans/2026-10-14-noteriv-web-desktop-parity-v2.md) ──

export function SyncIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.5" />
      <path d="M13.5 2.5v3h-3" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.5" />
      <path d="M2.5 13.5v-3h3" />
    </svg>
  );
}

export function ThemeIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13c1 0 1.5-.7 1.5-1.4 0-.9-.7-1.1-.7-1.9 0-.7.6-1.2 1.3-1.2h1.4a2.5 2.5 0 0 0 2.5-2.5C14 4.1 11.3 1.5 8 1.5Z" />
      <circle cx="5" cy="7" r=".6" fill="currentColor" />
      <circle cx="8" cy="4.8" r=".6" fill="currentColor" />
      <circle cx="11" cy="7" r=".6" fill="currentColor" />
    </svg>
  );
}

// ── Round 3: ribbon rework ──

export function CommandIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 4.5l3.5 3.5L3 11.5" />
      <path d="M8.5 12h4.5" />
    </svg>
  );
}

export function MoreIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className}>
      <circle cx="3.5" cy="8" r="1.2" />
      <circle cx="8" cy="8" r="1.2" />
      <circle cx="12.5" cy="8" r="1.2" />
    </svg>
  );
}
