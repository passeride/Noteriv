"use client";

import { useState } from "react";
import type { CorePluginInfo } from "@noteriv/core/plugin-registry";
import type { HostPanel } from "./core-plugin-host";
import { PanelBody } from "./CorePluginSidePanels";
import { t } from "../i18n";
import { useLocale } from "../i18n/react";

/** Visible text; defaults come from the i18n catalog. */
export interface CorePluginsLabels {
  intro: string;
  empty: string;
  loading: string;
  failed: string;
  enable: string;
  disable: string;
  settings: string;
  hideSettings: string;
}

/** Catalog group of a core plugin: `word-count` → `plugins.wordCount` (its `name` and `description` live there). */
export function corePluginGroup(id: string): string {
  return `plugins.${id.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`;
}

/** The plugin's name and description in the current language; a name given by the app wins. */
function describe(p: CorePluginInfo) {
  const group = corePluginGroup(p.id);
  return { name: p.name ?? t(`${group}.name`), description: p.description ?? t(`${group}.description`) };
}

/** The failure line: a save failure keeps the plugin running, a load failure stopped it. */
function errorText(p: CorePluginInfo, failed: string): string {
  if (!p.error) return "";
  if (p.errorKind === "save") return t("settings.corePlugins.saveFailed", { detail: p.error });
  return p.status === "error" ? `${failed}: ${p.error}` : p.error;
}

const defaultLabels = (): CorePluginsLabels => ({
  intro: t("settings.corePlugins.intro"),
  empty: t("settings.corePlugins.empty"),
  loading: t("settings.corePlugins.loading"),
  failed: t("settings.corePlugins.failed"),
  enable: t("settings.corePlugins.enable"),
  disable: t("settings.corePlugins.disable"),
  settings: t("settings.corePlugins.settings"),
  hideSettings: t("settings.corePlugins.hideSettings"),
});

export interface CorePluginsSectionProps {
  plugins: CorePluginInfo[];
  onToggle: (id: string, enabled: boolean) => void;
  /** Settings tabs core plugins registered (`ui.addSettingsTab`), shown under their plugin's row. */
  settingsTabs?: HostPanel[];
  labels?: Partial<CorePluginsLabels>;
}

/** Settings section listing core plugins with an on/off switch each (same row and toggle styles as Settings). */
export default function CorePluginsSection({ plugins, onToggle, settingsTabs = [], labels }: CorePluginsSectionProps) {
  useLocale();
  const text = { ...defaultLabels(), ...labels };
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="st-section">
      <div className="st-row-desc" style={{ padding: "4px 0 8px" }}>
        {text.intro}
      </div>
      {plugins.length === 0 && <div className="st-row-desc">{text.empty}</div>}
      {plugins.map((p) => {
        const on = p.enabled;
        const { name, description } = describe(p);
        const tabs = on ? settingsTabs.filter((t) => t.pluginId === p.id) : [];
        const open = openId === p.id && tabs.length > 0;
        return (
          <div key={p.id} data-core-plugin={p.id}>
          <div className="st-row">
            <div className="st-row-info">
              <span className="st-row-label">{name}</span>
              <span className="st-row-desc">{description}</span>
              {p.status === "loading" && <span className="st-row-desc">{text.loading}</span>}
              {p.error && (
                <span className="st-row-desc" style={{ color: "var(--red, #f38ba8)" }}>
                  {errorText(p, text.failed)}
                </span>
              )}
            </div>
            <div className="st-row-control">
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${on ? text.disable : text.enable} ${name}`}
                className={`st-toggle${on ? " st-toggle-on" : ""}`}
                disabled={p.status === "loading"}
                onClick={() => onToggle(p.id, !on)}
              >
                <span className="st-toggle-thumb" />
              </button>
            </div>
          </div>
          {tabs.length > 0 && (
            <div style={{ padding: "0 0 8px" }}>
              <button type="button" className="st-test-btn" aria-expanded={open} onClick={() => setOpenId(open ? null : p.id)}>
                {open ? text.hideSettings : text.settings}
              </button>
              {open &&
                tabs.map((t) => (
                  <div key={t.key} className="core-plugin-settings" data-settings-tab={t.key} style={{ marginTop: 8 }}>
                    {tabs.length > 1 && <div className="st-row-label">{t.title}</div>}
                    <PanelBody panel={t} />
                  </div>
                ))}
            </div>
          )}
          </div>
        );
      })}
    </div>
  );
}
