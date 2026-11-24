export interface LimitAnalysis {
  isRateLimit: boolean;
  remedy: "wait_short" | "wait_long" | "shrink_context" | "switch_model" | "none";
  waitSeconds?: number;
  resetTimeStr?: string;
  rawError: string;
}

/**
 * Parses real-world LLM error messages to identify rate limits, quota exhaustion,
 * and context overflow. Inspired by JAVIS OS `limit_learner.py`.
 */
export function analyzeProviderError(
  error: unknown,
  _currentContextLength?: number
): LimitAnalysis {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
      ? error.message
      : JSON.stringify(error ?? "");

  const s = raw.toLowerCase();

  // 1. Context window overflow -> shrink context
  if (
    s.includes("maximum context length") ||
    s.includes("context_length_exceeded") ||
    s.includes("prompt is too long") ||
    s.includes("token limit exceeded") ||
    s.includes("too many tokens")
  ) {
    return {
      isRateLimit: true,
      remedy: "shrink_context",
      rawError: raw,
    };
  }

  // 2. Subscription limit with specific reset time (e.g. "reset at 15:30" or "resets at 3:00 PM")
  const resetMatch = raw.match(/reset(?:s)?\s+(?:at\s+)?(\d{1,2}:\d{2}(?:\s*(?:am|pm))?)/i);
  if (resetMatch) {
    return {
      isRateLimit: true,
      remedy: "wait_long",
      resetTimeStr: resetMatch[1],
      rawError: raw,
    };
  }

  // 3. Rate limit with specific retry seconds (e.g. "try again in 14.5s")
  const retryMatch = raw.match(/try again in (\d+(?:\.\d+)?)\s*s/i);
  if (retryMatch) {
    const secs = parseFloat(retryMatch[1]);
    return {
      isRateLimit: true,
      remedy: "wait_short",
      waitSeconds: secs,
      rawError: raw,
    };
  }

  // 4. Quota exhaustion (Google Gemini, OpenAI 429 quota, etc.) -> switch model
  if (
    s.includes("resource_exhausted") ||
    s.includes("quota exceeded") ||
    s.includes("insufficient_quota") ||
    s.includes("billing details") ||
    s.includes("exceeded your current quota")
  ) {
    return {
      isRateLimit: true,
      remedy: "switch_model",
      rawError: raw,
    };
  }

  // 5. Generic 429 Too Many Requests without explicit duration
  if (s.includes("429") || s.includes("too many requests") || s.includes("rate limit")) {
    return {
      isRateLimit: true,
      remedy: "wait_short",
      waitSeconds: 20,
      rawError: raw,
    };
  }

  return {
    isRateLimit: false,
    remedy: "none",
    rawError: raw,
  };
}
