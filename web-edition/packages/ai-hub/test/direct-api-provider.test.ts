import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  streamOpenAiCompatible,
  formatOpenAiTools,
  formatAnthropicTools,
} from "../src/direct-api-provider";
import type { AiToolDefinition } from "@noteriv/core";

describe("Direct API Provider (OpenAI, Anthropic, Gemini, Ollama)", () => {
  const sampleTools: AiToolDefinition[] = [
    {
      name: "read_note",
      description: "Read note content",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("converts Noteriv tool definitions to OpenAI format", () => {
    const formatted = formatOpenAiTools(sampleTools);
    expect(formatted).toHaveLength(1);
    expect(formatted[0].type).toBe("function");
    expect(formatted[0].function.name).toBe("read_note");
    expect(formatted[0].function.parameters.properties).toHaveProperty("path");
  });

  it("converts Noteriv tool definitions to Anthropic format", () => {
    const formatted = formatAnthropicTools(sampleTools);
    expect(formatted).toHaveLength(1);
    expect(formatted[0].name).toBe("read_note");
    expect(formatted[0].input_schema.properties).toHaveProperty("path");
  });

  it("parses streaming chunks from OpenAI SSE format into text deltas", async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world!"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join("");

    const mockResponse = new Response(sseLines, {
      headers: { "Content-Type": "text/event-stream" },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const events: any[] = [];
    for await (const evt of streamOpenAiCompatible({
      apiKey: "test-key",
      endpointUrl: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o",
      messages: [{ id: "1", role: "user", content: "Hi", createdAt: Date.now() }],
    })) {
      events.push(evt);
    }

    const textDeltas = events.filter((e) => e.type === "text_delta").map((e) => e.text);
    expect(textDeltas.join("")).toBe("Hello world!");
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
