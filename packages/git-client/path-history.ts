export interface GitCommit {
  hash: string;
  author: string;
  /** Unix seconds, as returned by the native Git bridge. */
  date: string;
  message: string;
}

export interface PathActivity extends GitCommit {
  /** Vault-relative paths changed in this commit. */
  paths: string[];
}

export function relativeGitPath(root: string, path: string): string | null {
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const full = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (full === base) return '';
  return full.startsWith(base + '/') ? full.slice(base.length + 1) : null;
}

/** A blank block or .*.* shows all descendants of the note's folder. */
export function activityFolder(source: string, notePath: string | null): string {
  const value = source.trim().replace(/^folder:\s*/i, '');
  if (!value || value === '.*.*' || value === '.') {
    const cut = notePath?.lastIndexOf('/') ?? -1;
    return cut < 0 ? '' : (notePath ?? '').slice(0, cut);
  }
  if (value === '/') return '';
  const folder = value.replace(/\/+$/, '');
  if (!folder || /[\\\x00-\x1f]/.test(folder) ||
    folder.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Use a vault-relative folder path, or / for the entire vault.');
  }
  return folder;
}

export function activityTimeline(entries: PathActivity[]) {
  const dates = entries.map(entry => new Date(Number(entry.date) * 1000))
    .filter(date => Number.isFinite(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return null;
  const day = 86_400_000;
  const monthly = last.getTime() - first.getTime() >= 90 * day;
  const bucketKey = (date: Date) => date.toISOString().slice(0, monthly ? 7 : 10);
  const counts = new Map<string, number>();
  for (const date of dates) {
    const key = bucketKey(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const cursor = new Date(bucketKey(first));
  const end = bucketKey(last);
  const buckets: { label: string; count: number }[] = [];
  for (let key = bucketKey(cursor); key <= end; key = bucketKey(cursor)) {
    buckets.push({ label: key, count: counts.get(key) ?? 0 });
    if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return {
    first: first.toISOString().slice(0, 10),
    last: last.toISOString().slice(0, 10),
    total: dates.length,
    buckets,
    peak: Math.max(...counts.values()),
  };
}

export function parseFileOrder(content: string | null): string[] | undefined {
  if (content === null) return undefined;
  return [...new Set(content.split(/\r?\n/).filter(name => name.trim()))];
}

export function orderFileEntries<T extends { name: string }>(entries: T[], order: string[]): T[] {
  const positions = new Map(order.map((name, index) => [name, index]));
  return [...entries].sort((a, b) =>
    (positions.get(a.name) ?? order.length) - (positions.get(b.name) ?? order.length));
}
