import type { AiMessage, AiStreamEvent, AiToolDefinition, AiReasoningEffort } from "@noteriv/core";

export interface ClaudeSdkOptions {
  model?: string;
  reasoningEffort?: AiReasoningEffort;
  messages: AiMessage[];
  systemPrompt?: string;
  tools?: AiToolDefinition[];
  relayUrl?: string;
  sessionTag?: string;
}

/**
 * Driver for Claude Code (utilizing the user's logged-in Claude Pro / Team / Max subscription).
 * In Desktop / Node sidecar: directly communicates with the local Claude CLI agent runtime.
 * In Web / Mobile: streams via the user's personal Noteriv Sidecar Relay.
 */
export async function* streamClaudeSdk(
  options: ClaudeSdkOptions
): AsyncGenerator<AiStreamEvent, void, unknown> {
  const relayBase = options.relayUrl?.trim() || (typeof window !== "undefined" ? "/api" : undefined);

  // If relay URL is configured (or fallback in browser)
  if (relayBase) {
    const cleanBase = relayBase.replace(/\/+$/, "");
    const resp = await fetch(`${cleanBase}/ai/claude-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model || "sonnet",
        reasoningEffort: options.reasoningEffort,
        messages: options.messages,
        systemPrompt: options.systemPrompt,
        tools: options.tools,
        sessionTag: options.sessionTag || "chat",
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      yield { type: "error", message: `Claude Relay HTTP ${resp.status}: ${err}` };
      return;
    }

    if (!resp.body) {
      yield { type: "error", message: "Claude Relay returned empty response" };
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === "[DONE]") {
            yield { type: "done" };
            return;
          }
          try {
            const event = JSON.parse(jsonStr) as AiStreamEvent;
            yield event;
          } catch {
            // ignore partial JSON
          }
        }
      }
      yield { type: "done" };
    } finally {
      reader.releaseLock();
    }
    return;
  }

  // Pure client fallback when neither relay nor CLI is active
  yield {
    type: "error",
    message:
      "Claude Code Subscription requires Noteriv Desktop or a connected Local Relay. Please configure your Relay URL in Settings -> AI, or switch to Direct API key.",
  };
}
