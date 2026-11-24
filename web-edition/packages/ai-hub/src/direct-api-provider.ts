import type {
  AiMessage,
  AiStreamEvent,
  AiToolCall,
  AiToolDefinition,
} from "@noteriv/core";

export function formatOpenAiTools(tools: AiToolDefinition[]): Array<{
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}> {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export function formatAnthropicTools(tools: AiToolDefinition[]): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

export interface StreamOpenAiOptions {
  apiKey?: string;
  endpointUrl?: string;
  model: string;
  messages: AiMessage[];
  systemPrompt?: string;
  tools?: AiToolDefinition[];
  temperature?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "max";
}

/**
 * Universal SSE Streamer for OpenAI-compatible endpoints (OpenAI, OpenRouter, Groq, DeepSeek, Ollama).
 */
export async function* streamOpenAiCompatible(
  options: StreamOpenAiOptions
): AsyncGenerator<AiStreamEvent, void, unknown> {
  const endpoint = options.endpointUrl || "https://api.openai.com/v1/chat/completions";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.apiKey) {
    headers["Authorization"] = `Bearer ${options.apiKey}`;
  }

  const formattedMessages: Array<{ role: string; content: string | any[] }> = [];
  if (options.systemPrompt) {
    formattedMessages.push({ role: "system", content: options.systemPrompt });
  }
  for (const m of options.messages) {
    if (m.images && m.images.length > 0) {
      const parts: any[] = [{ type: "text", text: m.content }];
      for (const img of m.images) {
        const url = img.data.startsWith("data:") ? img.data : `data:${img.mimeType};base64,${img.data}`;
        parts.push({
          type: "image_url",
          image_url: { url },
        });
      }
      formattedMessages.push({ role: m.role, content: parts });
    } else {
      formattedMessages.push({ role: m.role, content: m.content });
    }
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages: formattedMessages,
    stream: true,
    temperature: options.temperature ?? 0.7,
  };

  if (options.reasoningEffort && options.reasoningEffort !== "none") {
    body.reasoning_effort = options.reasoningEffort;
  }

  if (options.tools && options.tools.length > 0) {
    body.tools = formatOpenAiTools(options.tools);
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    yield { type: "error", message: `HTTP ${resp.status}: ${errText}` };
    return;
  }

  if (!resp.body) {
    yield { type: "error", message: "Response body is empty" };
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
        if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data:")) continue;

        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") {
          yield { type: "done" };
          return;
        }

        try {
          const parsed = JSON.parse(dataStr);
          const choice = parsed.choices?.[0];
          if (!choice) continue;

          // Reasoning / Thinking content (DeepSeek R1, Grok, etc.)
          const reasoning = choice.delta?.reasoning_content || choice.delta?.thinking;
          if (reasoning) {
            yield { type: "thinking_delta", thinking: reasoning };
          }

          // Text content
          const content = choice.delta?.content;
          if (content) {
            yield { type: "text_delta", text: content };
          }

          // Tool calls
          const toolCalls = choice.delta?.tool_calls;
          if (toolCalls && Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              if (tc.function?.name) {
                yield {
                  type: "tool_call_started",
                  toolCall: {
                    id: tc.id || `tc-${Date.now()}`,
                    name: tc.function.name,
                    arguments: {},
                  },
                };
              }
            }
          }

          // Usage
          if (parsed.usage) {
            yield {
              type: "usage",
              inputTokens: parsed.usage.prompt_tokens || 0,
              outputTokens: parsed.usage.completion_tokens || 0,
            };
          }
        } catch {
          // ignore partial JSON chunk
        }
      }
    }

    yield { type: "done" };
  } finally {
    reader.releaseLock();
  }
}
