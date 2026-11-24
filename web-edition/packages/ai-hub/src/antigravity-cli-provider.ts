import type { AiMessage, AiStreamEvent, AiToolDefinition, AiReasoningEffort } from "@noteriv/core";

export interface AntigravityCliOptions {
  model?: string;
  reasoningEffort?: AiReasoningEffort;
  messages: AiMessage[];
  systemPrompt?: string;
  tools?: AiToolDefinition[];
  relayUrl?: string;
}

/**
 * Antigravity CLI Provider:
 * Driver for Google Antigravity Agentic CLI workflows.
 * In Web/Mobile, communicates via local sidecar relay.
 */
export async function* streamAntigravityCli(
  options: AntigravityCliOptions
): AsyncGenerator<AiStreamEvent, void, unknown> {
  const relayBase = options.relayUrl?.trim() || (typeof window !== "undefined" ? "/api" : undefined);

  if (relayBase) {
    const cleanBase = relayBase.replace(/\/+$/, "");
    try {
      const resp = await fetch(`${cleanBase}/ai/antigravity-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: options.model || "gemini-3.8-flash-high",
          reasoningEffort: options.reasoningEffort,
          messages: options.messages,
          systemPrompt: options.systemPrompt,
          tools: options.tools,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        yield { type: "error", message: `Antigravity Relay HTTP ${resp.status}: ${err}` };
        return;
      }

      if (!resp.body) {
        yield { type: "error", message: "Antigravity Relay returned empty response" };
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
              // ignore partial chunk
            }
          }
        }
        yield { type: "done" };
      } finally {
        reader.releaseLock();
      }
      return;
    } catch (err: any) {
      yield { type: "error", message: `Failed to connect to Antigravity Relay: ${err.message}` };
      return;
    }
  }

  yield {
    type: "error",
    message: "Antigravity CLI requires a running local relay. Check your connection in Settings -> AI.",
  };
}
