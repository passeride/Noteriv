"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  HotkeyBinding,
  HotkeyAction,
  DEFAULT_HOTKEYS,
  eventToKeyString,
  formatHotkey,
} from "@/lib/hotkeys";
import { EDITOR_FONTS, AUTO_SAVE_OPTIONS, ACCENT_COLORS, TAB_SIZES } from "@/lib/settings";
import ThemePicker from "@/components/ThemePicker";
import SyncSection from "@/components/sync/SyncSection";
import { PluginMirror } from "@noteriv/ui/plugins/sandbox";
import ClipperSection from "@/components/ClipperSection";
import PlanSection from "@/components/PlanSection";
import type { PluginPanelRef } from "@noteriv/ui/plugins/sandbox";
import type { MirrorEvent } from "@noteriv/ui/plugins/sandbox";
import { CorePluginsSection, type HostPanel } from "@noteriv/ui/plugins";
import type { CorePluginInfo } from "@noteriv/core/plugin-registry";
import { t, tOr } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import { applyAutomaticLanguage, applyLanguage } from "@/lib/i18n";

type BuiltInSection = "general" | "appearance" | "editor" | "shortcuts" | "sync" | "corePlugins" | "ecosystem" | "clipper" | "plan";
/** Plugin settings tabs are addressed as `plugin:<pluginDbId>:<tabId>`. */
type Section = BuiltInSection | `plugin:${string}`;

/** Built-in sections in nav order; their names are `settings.sections.<id>` in the i18n catalog. */
const SECTIONS: BuiltInSection[] = ["general", "appearance", "editor", "shortcuts", "sync", "corePlugins", "ecosystem", "clipper", "plan"];

export interface EditorSettings {
  editorFont: string;
  fontSize: number;
  lineHeight: number;
  autoSaveInterval: number;
  vimModeEnabled: boolean;
  spellCheck: boolean;
  accentColor: string;
  tabSize: number;
  pdfColumnLayout: 1 | 2;
  pdfChessboardWidth: 75 | 100;
  autoCollapseSidebar: boolean;
  autoUpdateLinks: boolean;
  /** Interface language; unset follows the browser (web/src/lib/i18n.ts). */
  language?: "en" | "vi";
}

interface SettingsModalProps {
  vaultId: string;
  vaultName?: string;
  currentThemeId: string;
  onThemeSelect: (themeId: string) => void;
  hotkeys: HotkeyBinding[];
  onHotkeysChange: (hotkeys: HotkeyBinding[]) => void;
  editorSettings: EditorSettings;
  onEditorSettingsChange: (patch: Partial<EditorSettings>) => void;
  platform: string;
  onOpenPlugins: () => void;
  onOpenSnippets: () => void;
  onClose: () => void;
  initialSection?: BuiltInSection;
  /** Settings tabs registered by plugins (ui.addSettingsTab). */
  pluginTabs?: PluginPanelRef[];
  onPluginEvent?: (tab: PluginPanelRef, e: MirrorEvent) => void;
  /** Built-in plugins (Plugin API v1 core tier) and their on/off switch. */
  corePlugins?: CorePluginInfo[];
  onToggleCorePlugin?: (id: string, enabled: boolean) => void;
  /** Settings tabs registered by core plugins (shown under each plugin in "Core plugins"). */
  corePluginSettingsTabs?: HostPanel[];
}

export default function SettingsModal({
  vaultId,
  vaultName,
  currentThemeId,
  onThemeSelect,
  hotkeys,
  onHotkeysChange,
  editorSettings,
  onEditorSettingsChange,
  platform,
  onOpenPlugins,
  onOpenSnippets,
  onClose,
  initialSection,
  pluginTabs = [],
  onPluginEvent,
  corePlugins = [],
  onToggleCorePlugin,
  corePluginSettingsTabs = [],
}: SettingsModalProps) {
  useLocale();
  const [active, setActive] = useState<Section>(initialSection ?? "general");
  const [recording, setRecording] = useState<HotkeyAction | null>(null);
  const [shortcutQuery, setShortcutQuery] = useState("");
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose]
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (recording) {
        e.preventDefault();
        e.stopPropagation();
        const combo = eventToKeyString(e);
        if (!combo) return;
        const conflict = hotkeys.find((h) => h.keys === combo && h.action !== recording);
        onHotkeysChange(
          hotkeys.map((h) => {
            if (h.action === recording) return { ...h, keys: combo };
            if (conflict && h.action === conflict.action) {
              const def = DEFAULT_HOTKEYS.find((d) => d.action === h.action);
              return { ...h, keys: def?.keys ?? "" };
            }
            return h;
          })
        );
        setRecording(null);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [recording, hotkeys, onHotkeysChange, onClose]);

  const resetAllHotkeys = () => onHotkeysChange(DEFAULT_HOTKEYS.map((d) => ({ ...d })));
  const resetHotkey = (action: HotkeyAction) => {
    const def = DEFAULT_HOTKEYS.find((d) => d.action === action);
    if (!def) return;
    onHotkeysChange(hotkeys.map((h) => (h.action === action ? { ...h, keys: def.keys } : h)));
  };

  // `category` stays the table's English name (it groups rows); what is shown and searched is the catalog's text.
  const categories = Array.from(new Set(hotkeys.map((h) => h.category)));
  const normalizedShortcutQuery = shortcutQuery.trim().toLowerCase();
  const filteredHotkeys = normalizedShortcutQuery
    ? hotkeys.filter((h) =>
        [hotkeyLabel(h), h.action, categoryLabel(h.category), h.keys, formatHotkey(h.keys, platform)].some((v) =>
          v.toLowerCase().includes(normalizedShortcutQuery)
        )
      )
    : hotkeys;

  const renderGeneral = () => (
    <div className="st-section">
      <Row label={t("settings.language.label")} desc={t("settings.language.desc")}>
        <select
          className="st-select"
          aria-label={t("settings.language.label")}
          value={editorSettings.language ?? "auto"}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "en" || value === "vi") {
              onEditorSettingsChange({ language: value });
              applyLanguage(value);
            } else {
              onEditorSettingsChange({ language: undefined });
              applyAutomaticLanguage();
            }
          }}
        >
          <option value="auto">{t("settings.language.autoWeb")}</option>
          {/* Each language is named in itself, so it can be found whatever the current language is. */}
          <option value="en">English</option>
          <option value="vi">Tiếng Việt</option>
        </select>
      </Row>
      <Row label={t("settings.autoCollapse.label")} desc={t("settings.autoCollapse.desc")}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={editorSettings.autoCollapseSidebar} onChange={(e) => onEditorSettingsChange({ autoCollapseSidebar: e.target.checked })} />
          <span className="st-hint">{editorSettings.autoCollapseSidebar ? t("settings.on") : t("settings.off")}</span>
        </label>
      </Row>
      <Row label={t("settings.pdfColumnLayout.label")} desc={t("settings.pdfColumnLayout.descWeb")}>
        <select className="st-select" value={editorSettings.pdfColumnLayout} onChange={(e) => onEditorSettingsChange({ pdfColumnLayout: Number(e.target.value) as 1 | 2 })}>
          <option value={1}>{t("settings.pdfColumns", { count: 1 })}</option>
          <option value={2}>{t("settings.pdfColumns", { count: 2 })}</option>
        </select>
      </Row>
      <Row label={t("settings.autoSave.label")} desc={t("settings.autoSave.descWeb")}>
        <select
          className="st-select"
          value={editorSettings.autoSaveInterval}
          onChange={(e) => onEditorSettingsChange({ autoSaveInterval: Number(e.target.value) })}
        >
          {AUTO_SAVE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label()}
            </option>
          ))}
        </select>
      </Row>
      <div className="st-divider" />
      <div className="st-row-desc" style={{ padding: "8px 0" }}>
        {t("settings.exportAccountHint")}
      </div>
    </div>
  );

  const renderAppearance = () => (
    <div className="st-section">
      <Row label={t("settings.accent.label")} desc={t("settings.accent.descWeb")}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ACCENT_COLORS.map((c) => (
            <button
              key={c.name}
              title={c.label()}
              onClick={() => onEditorSettingsChange({ accentColor: c.value })}
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: c.value || "transparent",
                border: editorSettings.accentColor === c.value ? "2px solid var(--text-primary)" : "1px solid var(--border)",
                fontSize: 10,
              }}
            >
              {c.value ? "" : "∅"}
            </button>
          ))}
        </div>
      </Row>
      <ThemePicker currentThemeId={currentThemeId} vaultId={vaultId} onThemeSelect={onThemeSelect} />
    </div>
  );

  const renderEditor = () => (
    <div className="st-section">
      <Row label={t("settings.fontSize.label")} desc={t("settings.fontSize.desc")}>
        <Stepper value={editorSettings.fontSize} min={11} max={24} onChange={(v) => onEditorSettingsChange({ fontSize: v })} />
      </Row>
      <Row label={t("settings.lineHeight.label")} desc={t("settings.lineHeight.desc")}>
        <Stepper
          value={editorSettings.lineHeight}
          min={1.2}
          max={2.5}
          step={0.05}
          format={(v) => v.toFixed(2)}
          onChange={(v) => onEditorSettingsChange({ lineHeight: v })}
        />
      </Row>
      <Row label={t("settings.editorFont.label")} desc={t("settings.editorFont.desc")}>
        <select
          className="st-select"
          value={editorSettings.editorFont}
          onChange={(e) => onEditorSettingsChange({ editorFont: e.target.value })}
        >
          {EDITOR_FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.name}
            </option>
          ))}
        </select>
      </Row>
      <div className="st-divider" />
      <Row label={t("settings.tabSize.label")} desc={t("settings.tabSize.desc")}>
        <select className="st-select" value={editorSettings.tabSize} onChange={(e) => onEditorSettingsChange({ tabSize: Number(e.target.value) })}>
          {TAB_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("settings.spellCheck.label")} desc={t("settings.spellCheck.desc")}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={editorSettings.spellCheck} onChange={(e) => onEditorSettingsChange({ spellCheck: e.target.checked })} />
          <span className="st-hint">{editorSettings.spellCheck ? t("settings.on") : t("settings.off")}</span>
        </label>
      </Row>
      <Row label={t("settings.vimMode.label")} desc={t("settings.vimMode.desc")}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={editorSettings.vimModeEnabled}
            onChange={(e) => onEditorSettingsChange({ vimModeEnabled: e.target.checked })}
          />
          <span className="st-hint">{editorSettings.vimModeEnabled ? t("settings.on") : t("settings.off")}</span>
        </label>
      </Row>
      <Row label={t("settings.autoUpdateLinks.label")} desc={t("settings.autoUpdateLinks.desc")}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={editorSettings.autoUpdateLinks}
            onChange={(e) => onEditorSettingsChange({ autoUpdateLinks: e.target.checked })}
          />
          <span className="st-hint">{editorSettings.autoUpdateLinks ? t("settings.on") : t("settings.off")}</span>
        </label>
      </Row>
    </div>
  );

  const renderShortcuts = () => (
    <div className="st-section">
      <div className="st-shortcuts-header">
        <span className="st-hint">{t("settings.shortcuts.hint")}</span>
        <button onClick={resetAllHotkeys} className="st-reset-all">
          {t("settings.shortcuts.resetAll")}
        </button>
      </div>
      <div className="st-shortcut-search">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          value={shortcutQuery}
          onChange={(e) => setShortcutQuery(e.target.value)}
          placeholder={t("settings.shortcuts.search")}
          aria-label={t("settings.shortcuts.searchLabel")}
        />
      </div>
      {categories.map(
        (cat) =>
          filteredHotkeys.some((h) => h.category === cat) && (
            <div key={cat} className="st-shortcut-group">
              <div className="st-shortcut-cat">{categoryLabel(cat)}</div>
              {filteredHotkeys
                .filter((h) => h.category === cat)
                .map((h) => {
                  const isRec = recording === h.action;
                  const isDefault = DEFAULT_HOTKEYS.find((d) => d.action === h.action)?.keys === h.keys;
                  return (
                    <div key={h.action} className="st-shortcut-row">
                      <span className="st-shortcut-label">{hotkeyLabel(h)}</span>
                      <div className="st-shortcut-keys">
                        <button
                          onClick={() => setRecording(isRec ? null : h.action)}
                          className={`settings-key-btn${isRec ? " recording" : ""}`}
                        >
                          {isRec ? t("settings.shortcuts.recording") : formatHotkey(h.keys, platform) || "—"}
                        </button>
                        {!isDefault && (
                          <button onClick={() => resetHotkey(h.action)} className="settings-key-reset" title={t("settings.shortcuts.reset")}>
                            <svg width="12" height="12" viewBox="0 0 12 12">
                              <path
                                d="M2 4h3L2 1M2 4a5 5 0 105 5"
                                stroke="currentColor"
                                strokeWidth="1.2"
                                fill="none"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )
      )}
      {normalizedShortcutQuery && filteredHotkeys.length === 0 && (
        <div className="st-shortcut-empty">{t("settings.shortcuts.empty", { query: shortcutQuery })}</div>
      )}
    </div>
  );

  const renderEcosystem = () => (
    <div className="st-section">
      <div className="st-ecosystem-card" onClick={() => { onClose(); onOpenPlugins(); }}>
        <div className="st-ecosystem-icon">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5L2 4.5v4l6 3 6-3v-4L8 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M2 4.5L8 7.5l6-3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M8 7.5v4.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
        <div className="st-ecosystem-info">
          <span className="st-ecosystem-title">{t("settings.ecosystem.plugins")}</span>
          <span className="st-ecosystem-desc">{t("settings.ecosystem.pluginsDesc")}</span>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="st-ecosystem-arrow">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="st-ecosystem-card" onClick={() => { onClose(); onOpenSnippets(); }}>
        <div className="st-ecosystem-icon">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <path d="M4 4h8v8H4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M6 7h4M6 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="st-ecosystem-info">
          <span className="st-ecosystem-title">{t("settings.ecosystem.snippets")}</span>
          <span className="st-ecosystem-desc">{t("settings.ecosystem.snippetsDesc")}</span>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="st-ecosystem-arrow">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="st-ecosystem-card" onClick={() => setActive("appearance")}>
        <div className="st-ecosystem-icon">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2 8h12M8 2a10 10 0 013 6 10 10 0 01-3 6 10 10 0 01-3-6 10 10 0 013-6z" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
        <div className="st-ecosystem-info">
          <span className="st-ecosystem-title">{t("settings.ecosystem.themes")}</span>
          <span className="st-ecosystem-desc">{t("settings.ecosystem.themesDesc")}</span>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="st-ecosystem-arrow">
          <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );

  const builtInContent: Record<BuiltInSection, () => React.JSX.Element> = {
    general: renderGeneral,
    appearance: renderAppearance,
    editor: renderEditor,
    shortcuts: renderShortcuts,
    sync: () => <SyncSection vaultId={vaultId} />,
    corePlugins: () => (
      <CorePluginsSection
        plugins={corePlugins}
        onToggle={(id, enabled) => onToggleCorePlugin?.(id, enabled)}
        settingsTabs={corePluginSettingsTabs}
      />
    ),
    ecosystem: renderEcosystem,
    clipper: () => <ClipperSection vaultId={vaultId} vaultName={vaultName ?? t("settings.thisVault")} />,
    plan: () => <PlanSection />,
  };

  const navItems: { id: Section; label: string }[] = [
    ...SECTIONS.map((id) => ({ id, label: t(`settings.sections.${id}`) })),
    // A plugin's own tab title, as the plugin gave it.
    ...pluginTabs.map((t) => ({ id: `plugin:${t.pluginDbId}:${t.id}` as Section, label: t.title })),
  ];
  const activePluginTab = active.startsWith("plugin:")
    ? pluginTabs.find((t) => `plugin:${t.pluginDbId}:${t.id}` === active)
    : undefined;

  function renderActive() {
    if (active.startsWith("plugin:")) {
      // A plugin tab can disappear while open (plugin disabled): fall back to a notice, not a crash.
      return activePluginTab ? (
        <PluginMirror html={activePluginTab.html} css={activePluginTab.css} onEvent={(e) => onPluginEvent?.(activePluginTab, e)} />
      ) : (
        <div className="st-row-desc">{t("settings.pluginTabGone")}</div>
      );
    }
    return builtInContent[active as BuiltInSection]();
  }

  return (
    <div ref={overlayRef} className="settings-overlay" onClick={handleBackdrop}>
      <div className="settings-modal">
        <div className="st-nav">
          <div className="st-nav-title">{t("settings.title")}</div>
          {navItems.map((s) => (
            <button key={s.id} className={`st-nav-item${active === s.id ? " st-nav-active" : ""}`} onClick={() => setActive(s.id)}>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
        <div className="st-main">
          <div className="st-header">
            <h2 className="st-title">{navItems.find((s) => s.id === active)?.label}</h2>
            <button onClick={onClose} className="settings-close-btn">
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="st-content">{renderActive()}</div>
        </div>
      </div>
    </div>
  );
}

/** A hotkey's name and category in the current language (the table's English when the catalog lacks it). */
const hotkeyLabel = (h: HotkeyBinding) => tOr(`hotkeys.${h.action}`, h.label);
const categoryLabel = (category: string) => tOr(`hotkeys.category.${category.toLowerCase()}`, category);

function Row({ label, desc, children }: { label: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="st-row">
      <div className="st-row-info">
        <span className="st-row-label">{label}</span>
        {desc && <span className="st-row-desc">{desc}</span>}
      </div>
      <div className="st-row-control">{children}</div>
    </div>
  );
}

function Stepper({
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const dec = () => onChange(Math.max(min, +(value - step).toFixed(4)));
  const inc = () => onChange(Math.min(max, +(value + step).toFixed(4)));
  return (
    <div className="st-stepper">
      <button onClick={dec} disabled={value <= min}>
        -
      </button>
      <span>{format ? format(value) : value}</span>
      <button onClick={inc} disabled={value >= max}>
        +
      </button>
    </div>
  );
}
