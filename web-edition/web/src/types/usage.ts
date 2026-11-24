/** Response of `GET /api/v1/usage/current`. Field names are the wire format (snake_case). */
export interface UsageSnapshot {
  tokens_used: number;
  tokens_limit: number;
  cost_usd: number;
  budget_usd: number;
  /** Provider the usage was billed to, e.g. "claude-sdk". */
  provider: string;
}

/**
 * How close the account is to its monthly limits:
 * ok < 80%, warning >= 80%, critical >= 95%, exceeded >= 100% (of tokens or budget, whichever is higher).
 */
export type UsageLevel = "ok" | "warning" | "critical" | "exceeded";

/**
 * - loading: first request in flight, nothing to show yet
 * - ready: have a snapshot (it may be a few seconds stale if the latest refresh failed)
 * - unavailable: the server has no usage endpoint (404/501); polling stops and the counter hides
 * - error: no snapshot and the last request failed; polling continues
 */
export type UsageStatus = "loading" | "ready" | "unavailable" | "error";
