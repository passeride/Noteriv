"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, webApi } from "@/lib/webApi";
import type { UsageSnapshot, UsageStatus } from "@/types/usage";

export const USAGE_POLL_INTERVAL_MS = 30_000;

export interface UseUsageTrackingOptions {
  /** Poll only while true (e.g. while the chat panel is open). Default true. */
  enabled?: boolean;
  intervalMs?: number;
}

export interface UsageTracking {
  usage: UsageSnapshot | null;
  status: UsageStatus;
  /** Fetch now (e.g. right after a chat reply finished). Concurrent calls share the request in flight. */
  refresh: () => Promise<void>;
}

/** The server has no usage endpoint: retrying every 30 s would only fill the logs with 404s. */
const isEndpointMissing = (err: unknown): boolean => err instanceof ApiError && (err.status === 404 || err.status === 501);

/**
 * Polls `GET /api/v1/usage/current` every `intervalMs` while enabled. Polling pauses while the tab is hidden and
 * refreshes as soon as it becomes visible again. A failed refresh keeps the last good snapshot.
 */
export function useUsageTracking({ enabled = true, intervalMs = USAGE_POLL_INTERVAL_MS }: UseUsageTrackingOptions = {}): UsageTracking {
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [status, setStatus] = useState<UsageStatus>("loading");
  const inFlight = useRef<Promise<void> | null>(null);
  const missing = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback((): Promise<void> => {
    if (missing.current) return Promise.resolve();
    if (inFlight.current) return inFlight.current;
    const run = webApi.usage
      .current()
      .then((snapshot) => {
        if (!mounted.current) return;
        setUsage(snapshot);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (!mounted.current) return;
        if (isEndpointMissing(err)) {
          missing.current = true;
          setUsage(null);
          setStatus("unavailable");
          return;
        }
        // Keep showing the last snapshot; only report "error" when there is nothing to show.
        setStatus((prev) => (prev === "ready" ? prev : "error"));
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs, refresh]);

  return { usage, status, refresh };
}
