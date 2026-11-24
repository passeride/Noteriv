/**
 * Community plugin marketplace — same repo and manifest shape desktop already
 * uses (desktop/src/lib/plugin-api.ts's fetchCommunityPluginManifest/
 * installCommunityPlugin), ported against webApi.plugins.install instead of
 * window.electronAPI's filesystem writes. Matches the fetch pattern already
 * established for community themes/snippets (lib/theme-utils.ts,
 * lib/css-snippets.ts): fetch manifest.json, then per-item files, fail soft
 * (return null) on any network/parse error rather than throwing.
 */

import { inferPermissions } from "@noteriv/core/permissions";

const COMMUNITY_PLUGINS_BASE = "https://raw.githubusercontent.com/thejacedev/NoterivPlugins/master";

export interface CommunityPluginEntry {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  dir: string;
}

export interface CommunityPluginManifest {
  name: string;
  description: string;
  version: string;
  plugins: CommunityPluginEntry[];
}

export async function fetchCommunityPluginManifest(): Promise<CommunityPluginManifest | null> {
  try {
    const res = await fetch(`${COMMUNITY_PLUGINS_BASE}/manifest.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as CommunityPluginManifest;
    if (!Array.isArray(data.plugins)) return null;
    return data;
  } catch {
    return null;
  }
}

async function fetchCommunityPluginFile(filePath: string): Promise<string | null> {
  try {
    const res = await fetch(`${COMMUNITY_PLUGINS_BASE}/${filePath}`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Permission proposals (inferPermissions) live in @noteriv/core so desktop shares them.
export { inferPermissions };

/** Fetches a community plugin's manifest.json + main.js. Returns null if either file is unavailable. */
export async function fetchCommunityPluginSource(
  entry: CommunityPluginEntry
): Promise<{ manifest: Record<string, unknown>; mainJs: string } | null> {
  const [manifestRaw, mainJs] = await Promise.all([
    fetchCommunityPluginFile(`${entry.dir}/manifest.json`),
    fetchCommunityPluginFile(`${entry.dir}/main.js`),
  ]);
  if (!manifestRaw || !mainJs) return null;
  try {
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    if (!Array.isArray(manifest.permissions)) manifest.permissions = inferPermissions(mainJs);
    return { manifest, mainJs };
  } catch {
    return null;
  }
}
