// Settings the API gives every page at run time (web/server/src/routes/ops.ts), so turning error reporting or the
// status page link on is an env change on the server, not a web rebuild. Fetched once per page load.

export interface PublicConfig {
  errorReporting: { dsn: string; environment: string; release: string | null } | null;
  statusPageUrl: string | null;
}

const OFF: PublicConfig = { errorReporting: null, statusPageUrl: null };
let pending: Promise<PublicConfig> | null = null;

/** Never rejects: when the API cannot be reached everything optional stays off. */
export function publicConfig(): Promise<PublicConfig> {
  pending ??= fetch("/api/v1/config", { credentials: "omit" })
    .then((r) => (r.ok ? (r.json() as Promise<PublicConfig>) : OFF))
    .catch(() => OFF);
  return pending;
}
