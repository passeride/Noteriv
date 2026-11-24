/**
 * Editor preference option lists — a reduced subset of
 * desktop/src/lib/settings.ts's AppSettings (only the fields web's Settings
 * modal actually wires up: editor font/size/line-height and autosave
 * interval). Applied via the --editor-font/--editor-font-size/
 * --editor-line-height CSS vars globals.css already defines (byte-identical
 * to desktop's stylesheet, see docs/plans/2026-10-13-noteriv-web-ui-parity.md).
 */

import { t } from "@noteriv/ui/i18n";

export const EDITOR_FONTS: { name: string; value: string }[] = [
  { name: "JetBrains Mono", value: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace' },
  { name: "Fira Code", value: '"Fira Code", "JetBrains Mono", monospace' },
  { name: "Cascadia Code", value: '"Cascadia Code", "JetBrains Mono", monospace' },
  { name: "System Monospace", value: "ui-monospace, Menlo, Consolas, monospace" },
];

/** `label` is read when the menu renders, so it follows the current language. */
export const AUTO_SAVE_OPTIONS: { label: () => string; value: number }[] = [
  { label: () => t("settings.autoSave.instant"), value: 500 },
  { label: () => t("settings.autoSave.default"), value: 800 },
  { label: () => t("settings.duration.seconds", { count: 2 }), value: 2000 },
  { label: () => t("settings.duration.seconds", { count: 5 }), value: 5000 },
];

export const DEFAULT_EDITOR_SETTINGS = {
  editorFont: EDITOR_FONTS[0].value,
  fontSize: 15,
  lineHeight: 1.7,
  autoSaveInterval: 800,
  // Phase D7 — ported from desktop/src/lib/vim-mode.ts's on/off toggle.
  vimModeEnabled: false,
  // Parity plan v2, Pha 6 — ported from desktop/src/lib/settings.ts.
  spellCheck: false,
  accentColor: "", // "" = keep the active theme's accent
  tabSize: 4,
  pdfColumnLayout: 2 as 1 | 2,
  // No UI in the general product (still applied to PDF export); the chess edition plugin will expose it.
  pdfChessboardWidth: 75 as 75 | 100,
  /** Renaming or moving a note rewrites the links that point to it. */
  autoUpdateLinks: true,
  /** Collapse the sidebar automatically on narrow windows. */
  autoCollapseSidebar: true,
  /** Interface language; unset = the app default (web/src/lib/i18n.ts). */
  language: undefined as "en" | "vi" | undefined,
};

/** `name` is a stable id (also the React key); `label` is the shown name in the current language. */
export const ACCENT_COLORS: { name: string; value: string; label: () => string }[] = [
  { name: "theme", value: "", label: () => t("settings.accent.themeDefault") },
  { name: "blue", value: "#89b4fa", label: () => t("settings.accent.blue") },
  { name: "lavender", value: "#b4befe", label: () => t("settings.accent.lavender") },
  { name: "mauve", value: "#cba6f7", label: () => t("settings.accent.mauve") },
  { name: "pink", value: "#f38ba8", label: () => t("settings.accent.pink") },
  { name: "peach", value: "#fab387", label: () => t("settings.accent.peach") },
  { name: "yellow", value: "#f9e2af", label: () => t("settings.accent.yellow") },
  { name: "green", value: "#a6e3a1", label: () => t("settings.accent.green") },
  { name: "teal", value: "#94e2d5", label: () => t("settings.accent.teal") },
];

export const TAB_SIZES = [2, 4, 8];
