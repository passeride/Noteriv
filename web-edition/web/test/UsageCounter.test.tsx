import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UsageCounter } from "@/components/UsageCounter";
import type { UsageSnapshot } from "@/types/usage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base: UsageSnapshot = { tokens_used: 1234, tokens_limit: 10_000, cost_usd: 12.5, budget_usd: 50, provider: "claude-sdk" };

let host: HTMLElement;
let root: Root;

const render = async (usage: UsageSnapshot | null, model?: string) => {
  await act(async () => {
    root.render(createElement(UsageCounter, { usage, model }));
  });
};

beforeEach(() => {
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

describe("UsageCounter", () => {
  it("renders nothing without a snapshot", async () => {
    await render(null);
    expect(host.innerHTML).toBe("");
  });

  it("shows tokens, budget, remaining tokens and the provider/model", async () => {
    await render(base, "sonnet");
    const text = host.textContent ?? "";
    expect(text).toContain("Tokens used: 1,234 / 10,000");
    expect(text).toContain("8,766 remaining");
    expect(text).toContain("Budget: $12.50 / $50.00");
    expect(text).toContain("claude-sdk / sonnet");
  });

  it("exposes the budget progress as an accessible progressbar without a warning at 25%", async () => {
    await render(base);
    const bar = host.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("25");
    expect(bar?.getAttribute("aria-valuemin")).toBe("0");
    expect(bar?.getAttribute("aria-valuemax")).toBe("100");
    expect(host.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });

  it("warns politely at 80%", async () => {
    await render({ ...base, cost_usd: 40 });
    const msg = host.querySelector('[role="status"]');
    expect(msg?.textContent).toContain("80%");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="progressbar"] > div')?.className).toContain("--color-warning");
  });

  it("turns red at 95%", async () => {
    await render({ ...base, cost_usd: 48 });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Almost out");
    expect(host.querySelector('[role="progressbar"] > div')?.className).toContain("--color-danger");
  });

  it("raises an alert when the limit is exceeded and caps the bar at 100%", async () => {
    await render({ ...base, cost_usd: 60 });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Model selection is disabled");
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
    expect(host.textContent).toContain("Budget: $60.00 / $50.00");
  });

  it("shows 79% (not 80%) just below the warning threshold", async () => {
    await render({ ...base, cost_usd: 39.8 });
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("79");
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
