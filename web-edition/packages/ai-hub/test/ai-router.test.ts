import { describe, it, expect, vi, beforeEach } from "vitest";
import { streamChat } from "../src/ai-router";
import type { AiProviderConfig } from "@noteriv/core";

describe("Universal AI Stream Router", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("routes Claude SDK requests to Claude driver", async () => {
    const claudeProvider: AiProviderConfig = {
      id: "claude-sdk",
      kind: "cli",
      name: "Claude Code Subscription",
      model: "claude-3-5-sonnet-latest",
    };

    const events: any[] = [];
    for await (const evt of streamChat({
      provider: claudeProvider,
      messages: [{ id: "1", role: "user", content: "Hello", createdAt: Date.now() }],
    })) {
      events.push(evt);
    }

    expect(events.length).toBeGreaterThan(0);
    // In test environment without relay, reports clear guidance
    expect(events[0].type).toBe("error");
    expect(events[0].message).toContain("Claude Code Subscription");
  });

  it("routes direct API requests to OpenAI-compatible stream", async () => {
    const sseLines = [
      'data: {"choices":[{"delta":{"content":"Pleased to meet you!"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join("");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(sseLines, { headers: { "Content-Type": "text/event-stream" } })
      )
    );

    const openAiProvider: AiProviderConfig = {
      id: "openai-api",
      kind: "api",
      name: "OpenAI GPT-4o",
      model: "gpt-4o",
      apiKey: "sk-mock",
    };

    const events: any[] = [];
    for await (const evt of streamChat({
      provider: openAiProvider,
      messages: [{ id: "1", role: "user", content: "Hi", createdAt: Date.now() }],
    })) {
      events.push(evt);
    }

    const textDeltas = events.filter((e) => e.type === "text_delta").map((e) => e.text);
    expect(textDeltas.join("")).toBe("Pleased to meet you!");
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("routes Grok requests to xAI endpoint with reasoning support", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url, init) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(init.body);
        const sse = 'data: {"choices":[{"delta":{"content":"Grok answer"}}]}\n\ndata: [DONE]\n\n';
        return Promise.resolve(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
      })
    );

    const grokProvider: AiProviderConfig = {
      id: "grok",
      kind: "api",
      name: "xAI Grok",
      model: "grok-2-latest",
      apiKey: "xai-test-key",
      reasoningEffort: "high",
    };

    const events: any[] = [];
    for await (const evt of streamChat({
      provider: grokProvider,
      messages: [{ id: "1", role: "user", content: "What is 2+2?", createdAt: Date.now() }],
    })) {
      events.push(evt);
    }

    expect(capturedUrl).toBe("https://api.x.ai/v1/chat/completions");
    expect(capturedBody.reasoning_effort).toBe("high");
    expect(events[0].type).toBe("text_delta");
    expect(events[0].text).toBe("Grok answer");
  });

  it("handles multimodal image attachments in OpenAI-compatible stream", async () => {
    let capturedBody: any = null;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, init) => {
        capturedBody = JSON.parse(init.body);
        const sse = 'data: {"choices":[{"delta":{"content":"I see a chess board."}}]}\n\ndata: [DONE]\n\n';
        return Promise.resolve(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
      })
    );

    const visionProvider: AiProviderConfig = {
      id: "openai-api",
      kind: "api",
      name: "OpenAI GPT-4o Vision",
      model: "gpt-4o",
      apiKey: "sk-mock",
    };

    const events: any[] = [];
    for await (const evt of streamChat({
      provider: visionProvider,
      messages: [{
        id: "1",
        role: "user",
        content: "What is this image?",
        images: [{ mimeType: "image/png", data: "base64mock" }],
        createdAt: Date.now(),
      }],
    })) {
      events.push(evt);
    }

    expect(capturedBody.messages[0].content).toEqual([
      { type: "text", text: "What is this image?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,base64mock" } },
    ]);
    expect(events[0].type).toBe("text_delta");
    expect(events[0].text).toBe("I see a chess board.");
  });
});
