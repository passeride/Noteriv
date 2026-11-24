import { useEffect, useRef, useState } from "react";
import type { PluginApi } from "@noteriv/plugin-api";
import { scanVault } from "../shared/vault";
import { computeVaultInsights, type HeatmapDay, type VaultInsightsData } from "./insights";

export interface InsightsLabels {
  title: string;
  close: string;
  loading: string;
  activity: string;
  heatTip: (date: string, n: number) => string;
  less: string;
  more: string;
  overview: string;
  notes: string;
  words: string;
  tags: string;
  links: string;
  avgWords: string;
  streak: string;
  current: string;
  longest: string;
  last: (d: string) => string;
  hubs: string;
  noHubs: string;
  inOut: (i: number, o: number) => string;
  orphans: string;
  noOrphans: string;
  topTags: string;
  noTags: string;
  growth: string;
  noData: string;
  health: string;
  withBacklinks: string;
  withTags: string;
  withFrontmatter: string;
  overall: string;
  undated: (n: number) => string;
  dayLabels: string[];
  months: string[];
}

const CELL_SIZE = 11;
const CELL_STEP = CELL_SIZE + 2;
const LEVEL_OPACITY = [0, 0.25, 0.5, 0.75, 1.0];

const formatNumber = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString());

/** Vault statistics dashboard (styles: `vi-*` / `vault-insights-*` in the shared app.css). */
export function VaultInsights({ api, labels }: { api: PluginApi; labels: InsightsLabels }) {
  const [data, setData] = useState<VaultInsightsData | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const colors = useRef({ accent: "#89b4fa", bgSurface: "#313244", green: "#a6e3a1", yellow: "#f9e2af", red: "#f38ba8" });

  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    colors.current = {
      accent: v("--accent", "#89b4fa"),
      bgSurface: v("--bg-surface", "#313244"),
      green: v("--green", "#a6e3a1"),
      yellow: v("--yellow", "#f9e2af"),
      red: v("--red", "#f38ba8"),
    };
    let cancelled = false;
    Promise.all([scanVault(api.vault), api.vault.stats()])
      .then(([notes, stats]) => !cancelled && setData(computeVaultInsights(notes, stats)))
      .catch((err) => console.error("[vault-insights] failed:", err));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const open = (path: string) => {
    void api.workspace.openFile(path);
    api.workspace.closeView();
  };
  const healthColor = (pct: number) => (pct >= 70 ? colors.current.green : pct >= 40 ? colors.current.yellow : colors.current.red);

  function heatmap(days: HeatmapDay[]) {
    const startDay = new Date(days[0].date + "T00:00:00").getDay();
    const cols = Math.ceil((days.length + startDay) / 7);
    const labelW = 28;
    const monthLabels: { x: number; label: string }[] = [];
    let lastMonth = -1;
    days.forEach((day, i) => {
      const m = new Date(day.date + "T00:00:00").getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        monthLabels.push({ x: labelW + Math.floor((i + startDay) / 7) * CELL_STEP, label: labels.months[m] });
      }
    });
    const { accent, bgSurface } = colors.current;
    return (
      <div className="vi-heatmap-scroll">
        <svg width={labelW + cols * CELL_STEP} height={20 + 7 * CELL_STEP}>
          {monthLabels.map((ml, i) => (
            <text key={i} x={ml.x} y={10} fontSize={10} fill="var(--text-muted)">
              {ml.label}
            </text>
          ))}
          {labels.dayLabels.map(
            (dl, i) =>
              dl && (
                <text key={i} x={0} y={20 + i * CELL_STEP + CELL_SIZE - 2} fontSize={9} fill="var(--text-muted)">
                  {dl}
                </text>
              )
          )}
          {days.map((day, i) => (
            <rect
              key={day.date}
              x={labelW + Math.floor((i + startDay) / 7) * CELL_STEP}
              y={20 + ((i + startDay) % 7) * CELL_STEP}
              width={CELL_SIZE}
              height={CELL_SIZE}
              rx={2}
              fill={day.level === 0 ? bgSurface : accent}
              opacity={day.level === 0 ? 1 : LEVEL_OPACITY[day.level]}
              onMouseEnter={(e) => setTooltip({ x: e.clientX + 10, y: e.clientY - 30, text: labels.heatTip(day.date, day.count) })}
              onMouseLeave={() => setTooltip(null)}
            />
          ))}
        </svg>
        <div className="vi-heatmap-legend">
          <span>{labels.less}</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <div key={lvl} className="vi-heatmap-legend-cell" style={{ background: lvl === 0 ? bgSurface : accent, opacity: lvl === 0 ? 1 : LEVEL_OPACITY[lvl] }} />
          ))}
          <span>{labels.more}</span>
        </div>
      </div>
    );
  }

  function growth(d: VaultInsightsData) {
    const points = d.growthOverTime;
    if (points.length === 0) return <p className="vi-empty">{labels.noData}</p>;
    const maxVal = points[points.length - 1].cumulative;
    const chartW = Math.max(400, points.length * 50);
    const chartH = 140;
    const padL = 40;
    const padT = 10;
    const plotW = chartW - padL - 10;
    const plotH = chartH - padT - 30;
    const xStep = points.length > 1 ? plotW / (points.length - 1) : 0;
    const yScale = maxVal > 0 ? plotH / maxVal : 0;
    const line = points.map((p, i) => `${padL + i * xStep},${padT + plotH - p.cumulative * yScale}`).join(" ");
    const area = `${padL},${padT + plotH} ${line} ${padL + (points.length - 1) * xStep},${padT + plotH}`;
    const { accent } = colors.current;
    return (
      <div className="vi-growth-chart">
        <svg width={chartW} height={chartH} viewBox={`0 0 ${chartW} ${chartH}`}>
          <defs>
            <linearGradient id="vi-growth-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity={0.3} />
              <stop offset="100%" stopColor={accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {[0, Math.round(maxVal / 2), maxVal].map((v) => {
            const y = padT + plotH - v * yScale;
            return (
              <g key={v}>
                <line x1={padL} y1={y} x2={padL + plotW} y2={y} stroke="var(--border)" strokeWidth={0.5} />
                <text x={padL - 6} y={y + 4} fontSize={9} fill="var(--text-muted)" textAnchor="end">
                  {v}
                </text>
              </g>
            );
          })}
          <polygon points={area} fill="url(#vi-growth-grad)" />
          <polyline points={line} fill="none" stroke={accent} strokeWidth={2} />
          {points.map((p, i) => (
            <circle key={p.month} cx={padL + i * xStep} cy={padT + plotH - p.cumulative * yScale} r={3} fill={accent} />
          ))}
          {points.map((p, i) =>
            i % (points.length > 12 ? 2 : 1) !== 0 && i !== points.length - 1 ? null : (
              <text key={p.month} x={padL + i * xStep} y={chartH - 4} fontSize={9} fill="var(--text-muted)" textAnchor="middle">
                {labels.months[parseInt(p.month.slice(5, 7), 10) - 1] ?? p.label.split(" ")[0]}
              </text>
            )
          )}
        </svg>
      </div>
    );
  }

  return (
    <div className="vault-insights-container" data-vault-insights="">
      <div className="vault-insights-header">
        <h2>{labels.title}</h2>
        <button className="vault-insights-close" onClick={() => api.workspace.closeView()} title={labels.close}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {!data ? (
        <div className="vault-insights-loading">
          <div className="vault-insights-spinner" />
          <span>{labels.loading}</span>
        </div>
      ) : (
        <div className="vault-insights-grid">
          <div className="vi-card vi-card-full">
            <h3>{labels.activity}</h3>
            {heatmap(data.heatmap)}
            {data.undated > 0 && <p className="vi-empty">{labels.undated(data.undated)}</p>}
          </div>

          <div className="vi-card">
            <h3>{labels.overview}</h3>
            <div className="vi-stats-row">
              {(
                [
                  [data.totalNotes, labels.notes],
                  [data.totalWords, labels.words],
                  [data.totalTags, labels.tags],
                  [data.totalLinks, labels.links],
                  [data.avgNoteLength, labels.avgWords],
                ] as const
              ).map(([value, label]) => (
                <div key={label} className="vi-stat">
                  <div className="vi-stat-value">{formatNumber(value)}</div>
                  <div className="vi-stat-label">{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="vi-card">
            <h3>{labels.streak}</h3>
            <div className="vi-streak-row">
              <div className="vi-streak-item">
                <div className="vi-streak-value">{data.dailyStreak.current}</div>
                <div className="vi-streak-label">{labels.current}</div>
              </div>
              <div className="vi-streak-item">
                <div className="vi-streak-value">{data.dailyStreak.longest}</div>
                <div className="vi-streak-label">{labels.longest}</div>
              </div>
            </div>
            {data.dailyStreak.lastDate && <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>{labels.last(data.dailyStreak.lastDate)}</div>}
          </div>

          <div className="vi-card">
            <h3>{labels.hubs}</h3>
            {data.hubNotes.length === 0 ? (
              <p className="vi-empty">{labels.noHubs}</p>
            ) : (
              <div className="vi-note-list">
                {data.hubNotes.map((n) => (
                  <button key={n.path} className="vi-note-item" onClick={() => open(n.path)}>
                    <span className="vi-note-name">{n.name}</span>
                    <span className="vi-note-count">{labels.inOut(n.incomingCount, n.outgoingCount)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="vi-card">
            <h3>{labels.orphans}</h3>
            {data.orphanNotes.length === 0 ? (
              <p className="vi-empty">{labels.noOrphans}</p>
            ) : (
              <div className="vi-note-list">
                {data.orphanNotes.map((n) => (
                  <button key={n.path} className="vi-note-item" onClick={() => open(n.path)}>
                    <span className="vi-note-name">{n.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="vi-card">
            <h3>{labels.topTags}</h3>
            {data.tagDistribution.length === 0 ? (
              <p className="vi-empty">{labels.noTags}</p>
            ) : (
              <div>
                {data.tagDistribution.map((t) => (
                  <div key={t.tag} className="vi-tag-bar-row">
                    <span className="vi-tag-label" title={t.tag}>
                      {t.tag}
                    </span>
                    <div className="vi-tag-bar-track">
                      <div className="vi-tag-bar-fill" style={{ width: `${(t.count / data.tagDistribution[0].count) * 100}%`, background: colors.current.accent }} />
                    </div>
                    <span className="vi-tag-count">{t.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="vi-card">
            <h3>{labels.growth}</h3>
            {growth(data)}
          </div>

          <div className="vi-card vi-card-full">
            <h3>{labels.health}</h3>
            <div className="vi-health-grid">
              {(
                [
                  [labels.withBacklinks, data.vaultHealth.withBacklinks],
                  [labels.withTags, data.vaultHealth.withTags],
                  [labels.withFrontmatter, data.vaultHealth.withFrontmatter],
                ] as const
              ).map(([label, pct]) => (
                <div key={label} style={{ display: "contents" }}>
                  <span className="vi-health-label">{label}</span>
                  <div className="vi-health-bar-track">
                    <div className="vi-health-bar-fill" style={{ width: `${pct}%`, background: healthColor(pct) }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="vi-health-overall">
              <div>
                <div className="vi-health-score" style={{ color: healthColor(data.vaultHealth.overall) }}>
                  {data.vaultHealth.overall}%
                </div>
                <div className="vi-health-score-label">{labels.overall}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tooltip && (
        <div className="vi-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
