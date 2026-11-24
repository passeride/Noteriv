import type { AiProviderConfig } from "@noteriv/core";

export interface ModelOption {
  id: string;
  name: string;
  supportsReasoning?: boolean;
  description?: string;
}

export interface ProviderGroup {
  id: string;
  name: string;
  kind: AiProviderConfig["kind"];
  category: "subscription" | "byok" | "local";
  models: ModelOption[];
}

export const PROVIDER_GROUPS: ProviderGroup[] = [
  {
    id: "antigravity-cli",
    name: "Google Antigravity Agentic CLI",
    kind: "cli",
    category: "subscription",
    models: [
      { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High Reasoning)", supportsReasoning: true },
      { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium Reasoning)", supportsReasoning: true },
      { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low Reasoning)", supportsReasoning: true },
      { id: "gemini-4-argon-high", name: "Gemini 4 Argon (High Reasoning)", supportsReasoning: true },
      { id: "gemini-4-argon-medium", name: "Gemini 4 Argon (Medium Reasoning)", supportsReasoning: true },
      { id: "claude-sonnet-5-5-high", name: "Claude Sonnet 5.5 (High Reasoning)", supportsReasoning: true },
      { id: "claude-opus-5-5-high", name: "Claude Opus 5.5 (High Reasoning)", supportsReasoning: true },
      { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium Reasoning)", supportsReasoning: true },
    ],
  },
  {
    id: "claude-sdk",
    name: "Claude Code CLI (Claude Pro/Max)",
    kind: "cli",
    category: "subscription",
    models: [
      { id: "sonnet", name: "Claude Sonnet 5.5 (Mới nhất - Mặc định)", supportsReasoning: true },
      { id: "opus", name: "Claude Opus 5.5 (Mới nhất)", supportsReasoning: true },
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5 (High Reasoning)", supportsReasoning: true },
      { id: "claude-opus-5-5", name: "Claude Opus 5.5 (High Reasoning)", supportsReasoning: true },
      { id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet (Thinking)", supportsReasoning: true },
      { id: "haiku", name: "Claude Haiku (Tốc độ cao)", supportsReasoning: false },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet v2", supportsReasoning: false },
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku", supportsReasoning: false },
      { id: "claude-3-opus-latest", name: "Claude 3 Opus", supportsReasoning: false },
      { id: "claude-sonnet-4", name: "Claude Sonnet 4 (Next-Gen Preview)", supportsReasoning: true },
      { id: "claude-opus-4", name: "Claude Opus 4 (Next-Gen Preview)", supportsReasoning: true },
    ],
  },
  {
    id: "codex-oauth",
    name: "ChatGPT Plus (Codex Device OAuth)",
    kind: "oauth",
    category: "subscription",
    models: [
      { id: "gpt-4o", name: "ChatGPT GPT-4o", supportsReasoning: false },
      { id: "gpt-4o-mini", name: "ChatGPT GPT-4o Mini", supportsReasoning: false },
      { id: "o3-mini", name: "OpenAI o3-mini (Reasoning)", supportsReasoning: true },
      { id: "o1", name: "OpenAI o1 (Deep Reasoning)", supportsReasoning: true },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "api",
    category: "byok",
    models: [
      { id: "deepseek-reasoner", name: "DeepSeek R1 (Reasoning)", supportsReasoning: true },
      { id: "deepseek-chat", name: "DeepSeek V3 (Chat)", supportsReasoning: false },
    ],
  },
  {
    id: "grok",
    name: "xAI Grok",
    kind: "api",
    category: "byok",
    models: [
      { id: "grok-2-latest", name: "xAI Grok-2 Latest", supportsReasoning: false },
      { id: "grok-2-vision-1212", name: "xAI Grok-2 Vision", supportsReasoning: false },
      { id: "grok-beta", name: "xAI Grok Beta (Reasoning)", supportsReasoning: true },
    ],
  },
  {
    id: "gemini-api",
    name: "Google Gemini API",
    kind: "api",
    category: "byok",
    models: [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", supportsReasoning: false },
      { id: "gemini-2.0-flash-thinking-exp-01-21", name: "Gemini 2.0 Flash Thinking", supportsReasoning: true },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", supportsReasoning: false },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", supportsReasoning: false },
    ],
  },
  {
    id: "openai-api",
    name: "OpenAI API",
    kind: "api",
    category: "byok",
    models: [
      { id: "gpt-4o", name: "OpenAI GPT-4o (Vision)", supportsReasoning: false },
      { id: "gpt-4o-mini", name: "OpenAI GPT-4o Mini", supportsReasoning: false },
      { id: "o3-mini", name: "OpenAI o3-mini (Reasoning)", supportsReasoning: true },
      { id: "o1", name: "OpenAI o1 (Deep Reasoning)", supportsReasoning: true },
    ],
  },
  {
    id: "ollama",
    name: "Ollama Local (Offline)",
    kind: "local",
    category: "local",
    models: [
      { id: "llama3.2", name: "Llama 3.2 (3B)", supportsReasoning: false },
      { id: "llama3.3", name: "Llama 3.3 (70B)", supportsReasoning: false },
      { id: "deepseek-r1:8b", name: "DeepSeek R1 8B (Reasoning)", supportsReasoning: true },
      { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", supportsReasoning: false },
      { id: "mistral", name: "Mistral 7B", supportsReasoning: false },
    ],
  },
];

export function getModelsForProvider(providerId: string): ModelOption[] {
  const group = PROVIDER_GROUPS.find((g) => g.id === providerId);
  return group ? group.models : [];
}

export function getDefaultModelForProvider(providerId: string): string {
  const models = getModelsForProvider(providerId);
  return models.length > 0 ? models[0].id : "gpt-4o";
}
