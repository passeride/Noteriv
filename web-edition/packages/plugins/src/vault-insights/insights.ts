/**
 * Vault insights, computed from notes the plugin read through the API. The aggregation (heatmap, link graph, tags,
 * daily streak, growth, health) is the pre-2.3 code shared by web and desktop, made pure: the apps' versions only
 * differed in how they fetched files and dates. Notes are keyed by vault-relative path.
 */

import type { NoteStats } from "@noteriv/plugin-api";
import { parseTags } from "@noteriv/core/tag-utils";
import { hasFrontmatter } from "@noteriv/core/frontmatter-utils";
import { wikiLinkTargets } from "@noteriv/core/graph-utils";
import { linkResolver } from "@noteriv/core/link-rename";

export interface HeatmapDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface HubNote {
  path: string;
  name: string;
  incomingCount: number;
  outgoingCount: number;
  totalConnections: number;
}

export interface OrphanNote {
  path: string;
  name: string;
}

export interface TagStat {
  tag: string;
  count: number;
}

export interface GrowthPoint {
  month: string;
  label: string;
  cumulative: number;
}

export interface DailyStreak {
  current: number;
  longest: number;
  lastDate: string | null;
}

export interface VaultHealthScore {
  overall: number;
  withBacklinks: number;
  withTags: number;
  withFrontmatter: number;
  totalNotes: number;
}

export interface VaultInsightsData {
  totalNotes: number;
  totalWords: number;
  totalTags: number;
  totalLinks: number;
  avgNoteLength: number;
  heatmap: HeatmapDay[];
  hubNotes: HubNote[];
  orphanNotes: OrphanNote[];
  tagDistribution: TagStat[];
  dailyStreak: DailyStreak;
  growthOverTime: GrowthPoint[];
  vaultHealth: VaultHealthScore;
  /** Notes whose dates the backend could not give (left out of the heatmap and growth chart). */
  undated: number;
}

interface Entry {
  path: string;
  /** File name with extension. */
  name: string;
  content: string;
  stats?: NoteStats;
}

const DAILY_NOTE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");
function toDateStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toMonthStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function toMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  return `${MONTH_LABELS[parseInt(month, 10) - 1]} ${year}`;
}
function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}
const stripExt = (name: string) => name.replace(/\.(md|markdown)$/i, "");

export function buildHeatmap(files: Entry[], now = new Date()): HeatmapDay[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const countByDate = new Map<string, number>();
  for (const f of files) {
    if (!f.stats) continue;
    const ds = toDateStr(f.stats.modifiedAt);
    countByDate.set(ds, (countByDate.get(ds) || 0) + 1);
  }
  const days: HeatmapDay[] = [];
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = toDateStr(d.getTime());
    days.push({ date: ds, count: countByDate.get(ds) || 0, level: 0 });
  }
  const nonZero = days.filter((d) => d.count > 0).map((d) => d.count);
  if (nonZero.length > 0) {
    nonZero.sort((a, b) => a - b);
    const p25 = nonZero[Math.floor(nonZero.length * 0.25)] || 1;
    const p50 = nonZero[Math.floor(nonZero.length * 0.5)] || 2;
    const p75 = nonZero[Math.floor(nonZero.length * 0.75)] || 3;
    for (const day of days) {
      if (day.count === 0) day.level = 0;
      else if (day.count <= p25) day.level = 1;
      else if (day.count <= p50) day.level = 2;
      else if (day.count <= p75) day.level = 3;
      else day.level = 4;
    }
  }
  return days;
}

function buildLinkGraph(files: Entry[]) {
  const resolve = linkResolver(files.map((f) => f.path));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, Set<string>>();
  for (const f of files) incoming.set(f.path, new Set());
  let totalLinks = 0;
  for (const f of files) {
    const targets = wikiLinkTargets(f.content, f.path, resolve);
    outgoing.set(f.path, targets);
    for (const t of targets) incoming.get(t)!.add(f.path);
    totalLinks += targets.length;
  }

  const connections: HubNote[] = files.map((f) => {
    const inc = incoming.get(f.path)?.size || 0;
    const out = outgoing.get(f.path)?.length || 0;
    return { path: f.path, name: stripExt(f.name), incomingCount: inc, outgoingCount: out, totalConnections: inc + out };
  });
  connections.sort((a, b) => b.totalConnections - a.totalConnections);
  return {
    totalLinks,
    hubNotes: connections.slice(0, 10).filter((n) => n.totalConnections > 0),
    orphanNotes: connections.filter((n) => n.totalConnections === 0).map((n) => ({ path: n.path, name: n.name })),
    incoming,
  };
}

function buildTagDistribution(files: Entry[]): { tags: TagStat[]; totalUnique: number } {
  const counts = new Map<string, number>();
  for (const f of files) for (const tag of new Set(parseTags(f.content))) counts.set(tag, (counts.get(tag) || 0) + 1);
  const sorted = Array.from(counts, ([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  return { tags: sorted.slice(0, 20), totalUnique: counts.size };
}

export function computeDailyStreak(fileNames: string[], now = new Date()): DailyStreak {
  const unique = [...new Set(fileNames.map(stripExt).filter((n) => DAILY_NOTE_REGEX.test(n)))].sort();
  if (unique.length === 0) return { current: 0, longest: 0, lastDate: null };
  let longest = 1;
  let run = 1;
  for (let i = 1; i < unique.length; i++) {
    if (daysBetween(unique[i - 1], unique[i]) === 1) longest = Math.max(longest, ++run);
    else run = 1;
  }
  let current = 0;
  const last = unique[unique.length - 1];
  if (daysBetween(last, toDateStr(now.getTime())) <= 1) {
    current = 1;
    for (let i = unique.length - 2; i >= 0; i--) {
      if (daysBetween(unique[i], unique[i + 1]) === 1) current++;
      else break;
    }
  }
  return { current, longest, lastDate: last };
}

function buildGrowthTimeline(files: Entry[]): GrowthPoint[] {
  const monthCounts = new Map<string, number>();
  for (const f of files) {
    if (!f.stats) continue;
    const m = toMonthStr(f.stats.createdAt);
    monthCounts.set(m, (monthCounts.get(m) || 0) + 1);
  }
  let cumulative = 0;
  return Array.from(monthCounts.keys())
    .sort()
    .map((m) => ({ month: m, label: toMonthLabel(m), cumulative: (cumulative += monthCounts.get(m)!) }));
}

function computeVaultHealth(files: Entry[], incoming: Map<string, Set<string>>): VaultHealthScore {
  const total = files.length;
  if (total === 0) return { overall: 0, withBacklinks: 0, withTags: 0, withFrontmatter: 0, totalNotes: 0 };
  let bl = 0;
  let tg = 0;
  let fm = 0;
  for (const f of files) {
    if ((incoming.get(f.path)?.size || 0) > 0) bl++;
    if (parseTags(f.content).length > 0) tg++;
    if (hasFrontmatter(f.content)) fm++;
  }
  const withBacklinks = Math.round((bl / total) * 100);
  const withTags = Math.round((tg / total) * 100);
  const withFrontmatter = Math.round((fm / total) * 100);
  return { overall: Math.round(withBacklinks * 0.4 + withTags * 0.3 + withFrontmatter * 0.3), withBacklinks, withTags, withFrontmatter, totalNotes: total };
}

export function computeVaultInsights(
  notes: { path: string; content: string }[],
  stats: Record<string, NoteStats>,
  now = new Date()
): VaultInsightsData {
  const files: Entry[] = notes.map((n) => ({ path: n.path, name: n.path.split("/").pop() ?? n.path, content: n.content, stats: stats[n.path] }));
  const totalWords = files.reduce((sum, f) => sum + f.content.split(/\s+/).filter(Boolean).length, 0);
  const totalNotes = files.length;
  const { totalLinks, hubNotes, orphanNotes, incoming } = buildLinkGraph(files);
  const { tags: tagDistribution, totalUnique: totalTags } = buildTagDistribution(files);
  return {
    totalNotes,
    totalWords,
    totalTags,
    totalLinks,
    avgNoteLength: totalNotes > 0 ? Math.round(totalWords / totalNotes) : 0,
    heatmap: buildHeatmap(files, now),
    hubNotes,
    orphanNotes,
    tagDistribution,
    dailyStreak: computeDailyStreak(files.map((f) => f.name), now),
    growthOverTime: buildGrowthTimeline(files),
    vaultHealth: computeVaultHealth(files, incoming),
    undated: files.filter((f) => !f.stats).length,
  };
}
