import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageSnapshot } from "@/types/usage";

const current = vi.fn<() => Promise<UsageSnapshot>>();

vi.mock("@/lib/webApi", () => {
  class ApiError extends Error {
    constructor(public status: number, public body: unknown) {
      super(`API error ${status}`);
    }
  }
  return { ApiError, webApi: { usage: { current: () => current() } } };
});

const { ApiError } = await import("@/lib/webApi");
const { useUsageTracking, USAGE_POLL_INTERVAL_MS } = await import("@/hooks/useUsageTracking");
type Tracking = ReturnType<typeof useUsageTracking>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot: UsageSnapshot = { tokens_used: 1234, tokens_limit: 10_000, cost_usd: 12.5, budget_usd: 50, provider: "claude-sdk" };

let root: Root;
let latest: Tracking;

function Probe({ enabled = true }: { enabled?: boolean }) {
  latest = useUsageTracking({ enabled });
  return null;
}

const mount = async (enabled = true) => {
  await act(async () => {
    root.render(createElement(Probe, { enabled }));
  });
};

const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
};

beforeEach(() => {
  vi.useFakeTimers();
  current.mockReset();
  setVisibility("visible");
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("useUsageTracking", () => {
  it("fetches on mount and exposes the snapshot", async () => {
    current.mockResolvedValue(snapshot);
    await mount();
    expect(current).toHaveBeenCalledTimes(1);
    expect(latest.status).toBe("ready");
    expect(latest.usage).toEqual(snapshot);
  });

  it("polls every 30 seconds", async () => {
    current.mockResolvedValue(snapshot);
    await mount();
    await tick(USAGE_POLL_INTERVAL_MS);
    expect(current).toHaveBeenCalledTimes(2);
    await tick(USAGE_POLL_INTERVAL_MS);
    expect(current).toHaveBeenCalledTimes(3);
  });

  it("does not poll while disabled", async () => {
    await mount(false);
    await tick(USAGE_POLL_INTERVAL_MS * 2);
    expect(current).not.toHaveBeenCalled();
    expect(latest.status).toBe("loading");
  });

  it("skips ticks while the tab is hidden and refreshes when it becomes visible", async () => {
    current.mockResolvedValue(snapshot);
    await mount();
    setVisibility("hidden");
    await tick(USAGE_POLL_INTERVAL_MS * 2);
    expect(current).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(current).toHaveBeenCalledTimes(2);
  });

  it("keeps the last snapshot when a refresh fails", async () => {
    current.mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new ApiError(500, null));
    await mount();
    await tick(USAGE_POLL_INTERVAL_MS);
    expect(current).toHaveBeenCalledTimes(2);
    expect(latest.status).toBe("ready");
    expect(latest.usage).toEqual(snapshot);
  });

  it("reports an error when the first request fails, and recovers on the next poll", async () => {
    current.mockRejectedValueOnce(new ApiError(500, null)).mockResolvedValueOnce(snapshot);
    await mount();
    expect(latest.status).toBe("error");
    expect(latest.usage).toBeNull();
    await tick(USAGE_POLL_INTERVAL_MS);
    expect(latest.status).toBe("ready");
  });

  it("stops polling for good when the endpoint does not exist", async () => {
    current.mockRejectedValue(new ApiError(404, null));
    await mount();
    expect(latest.status).toBe("unavailable");
    await tick(USAGE_POLL_INTERVAL_MS * 3);
    expect(current).toHaveBeenCalledTimes(1);
    await act(async () => latest.refresh());
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("shares one request between overlapping refresh calls", async () => {
    let resolve!: (s: UsageSnapshot) => void;
    current.mockReturnValue(new Promise<UsageSnapshot>((r) => (resolve = r)));
    await mount();
    await act(async () => {
      void latest.refresh();
      void latest.refresh();
    });
    expect(current).toHaveBeenCalledTimes(1);
    await act(async () => resolve(snapshot));
    expect(latest.usage).toEqual(snapshot);
  });

  it("stops the timer on unmount", async () => {
    current.mockResolvedValue(snapshot);
    await mount();
    await act(async () => root.unmount());
    await tick(USAGE_POLL_INTERVAL_MS * 2);
    expect(current).toHaveBeenCalledTimes(1);
    root = createRoot(document.createElement("div"));
  });
});
