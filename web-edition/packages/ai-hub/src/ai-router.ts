import type {
  AiMessage,
  AiProviderConfig,
  AiStreamEvent,
  AiToolDefinition,
} from "@noteriv/core";
import { streamOpenAiCompatible } from "./direct-api-provider";
import { streamClaudeSdk } from "./claude-sdk-provider";
import { streamAntigravityCli } from "./antigravity-cli-provider";
import { analyzeProviderError, type LimitAnalysis } from "./limit-learner";

export interface StreamChatOptions {
  provider: AiProviderConfig;
  messages: AiMessage[];
  systemPrompt?: string;
  tools?: AiToolDefinition[];
  relayUrl?: string;
}

/**
 * Universal AI Stream Dispatcher for Noteriv:
 * Routes to Subscription Harnesses (Claude Code, Codex ChatGPT),
 * Direct APIs (Gemini, Anthropic, OpenAI), or Ollama Local.
 */
export async function* streamChat(
  options: StreamChatOptions
): AsyncGenerator<AiStreamEvent, void, unknown> {
  const { provider, messages, systemPrompt, tools, relayUrl } = options;

  try {
    if (provider.id === "antigravity-cli") {
      yield* streamAntigravityCli({
        model: provider.model,
        reasoningEffort: provider.reasoningEffort,
        messages,
        systemPrompt,
        tools,
        relayUrl,
      });
      return;
    }

    if (provider.id === "claude-sdk" || provider.kind === "cli") {
      yield* streamClaudeSdk({
        model: provider.model,
        reasoningEffort: provider.reasoningEffort,
        messages,
        systemPrompt,
        tools,
        relayUrl,
      });
      return;
    }

    // Determine endpoint URL by provider ID if not explicitly configured
    let endpoint = provider.endpointUrl;
    if (!endpoint) {
      if (provider.id === "ollama") {
        endpoint = "http://localhost:11434/v1/chat/completions";
      } else if (provider.id === "grok" || provider.id.includes("grok")) {
        endpoint = "https://api.x.ai/v1/chat/completions";
      } else if (provider.id === "deepseek" || provider.id.includes("deepseek")) {
        endpoint = "https://api.deepseek.com/chat/completions";
      } else if (provider.id === "gemini-api") {
        endpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
      } else if (provider.id === "groq") {
        endpoint = "https://api.groq.com/openai/v1/chat/completions";
      } else {
        endpoint = "https://api.openai.com/v1/chat/completions";
      }
    }

    yield* streamOpenAiCompatible({
      apiKey: provider.apiKey,
      endpointUrl: endpoint,
      model: provider.model,
      messages,
      systemPrompt,
      tools,
      temperature: provider.temperature,
      reasoningEffort: provider.reasoningEffort,
    });
  } catch (err: unknown) {
    const analysis: LimitAnalysis = analyzeProviderError(err);
    if (analysis.isRateLimit) {
      let advice = "";
      if (analysis.remedy === "wait_short") {
        advice = ` (Please wait ${analysis.waitSeconds || 20}s before retrying)`;
      } else if (analysis.remedy === "wait_long") {
        advice = ` (Usage quota resets at ${analysis.resetTimeStr || "next hour"})`;
      } else if (analysis.remedy === "shrink_context") {
        advice = " (Context window exceeded. Please use /compact or shorten your notes)";
      }
      yield {
        type: "error",
        message: `Rate limit reached: ${analysis.rawError}${advice}`,
      };
    } else {
      yield {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
