import { describe, it, expect } from "vitest";
import { analyzeProviderError } from "../src/limit-learner";

describe("AI Limit Learner (Error Pattern Detection & Quota Remedies)", () => {
  it("detects context length exceeded and recommends shrinking context", () => {
    const errorMsg =
      "This model's maximum context length is 128000 tokens. However, your messages resulted in 135000 tokens.";
    const analysis = analyzeProviderError(errorMsg);

    expect(analysis.isRateLimit).toBe(true);
    expect(analysis.remedy).toBe("shrink_context");
  });

  it("detects short wait retry error with second count", () => {
    const errorMsg = "Rate limit reached for requests. Please try again in 14.5s.";
    const analysis = analyzeProviderError(errorMsg);

    expect(analysis.isRateLimit).toBe(true);
    expect(analysis.remedy).toBe("wait_short");
    expect(analysis.waitSeconds).toBeCloseTo(14.5, 0);
  });

  it("detects subscription hourly limit with reset time (Claude/ChatGPT pattern)", () => {
    const errorMsg = "You've reached your limit. Your usage will reset at 15:30.";
    const analysis = analyzeProviderError(errorMsg);

    expect(analysis.isRateLimit).toBe(true);
    expect(analysis.remedy).toBe("wait_long");
    expect(analysis.resetTimeStr).toBe("15:30");
  });

  it("detects Gemini RESOURCE_EXHAUSTED quota error", () => {
    const errorMsg = "RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Queries' and limit 'Queries per minute'";
    const analysis = analyzeProviderError(errorMsg);

    expect(analysis.isRateLimit).toBe(true);
    expect(analysis.remedy).toBe("switch_model");
  });

  it("returns none for standard non-quota errors", () => {
    const errorMsg = "Network connection closed by peer";
    const analysis = analyzeProviderError(errorMsg);

    expect(analysis.isRateLimit).toBe(false);
    expect(analysis.remedy).toBe("none");
  });
});
