/**
 * Core AI Assistant interfaces and types.
 * Pure TypeScript definitions shared across Web, Desktop and Mobile.
 */

export type AiRole = "user" | "assistant" | "system" | "tool";

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface AiToolResult {
  toolCallId: string;
  name: string;
  result: unknown;
  error?: string;
}

export interface AiImageAttachment {
  mimeType: string;
  data: string; // base64 string or data URL
  name?: string;
}

export interface AiMessage {
  id: string;
  role: AiRole;
  content: string;
  images?: AiImageAttachment[];
  toolCalls?: AiToolCall[];
  toolCallId?: string;
  name?: string;
  createdAt: number;
}

export interface AiVaultOverview {
  name?: string;
  totalNotes: number;
  folders?: string[];
  notes?: Array<{
    path: string;
    name?: string;
  }>;
}

/** Structured context references attached to user prompts (Zero Context Bloat). */
export interface AiContextRef {
  /** Overview statistics and file tree of the active vault */
  vaultOverview?: AiVaultOverview;
  /** The note currently open in the active editor tab. */
  activeNote?: {
    path: string;
    title?: string;
    content?: string;
  };
  /** Text highlighted by the user in the editor. */
  selection?: {
    path: string;
    text: string;
    startLine?: number;
    endLine?: number;
  };
  /** Explicitly @mentioned notes in composer. */
  mentionedNotes?: Array<{
    path: string;
    title?: string;
    content?: string;
  }>;
  /** Current editor cursor position. */
  cursor?: {
    path: string;
    line: number;
  };
}

export interface AiPatchOperation {
  type: "replace" | "insert" | "delete";
  startLine?: number;
  endLine?: number;
  text: string;
}

export type AiStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "tool_call_started"; toolCall: AiToolCall }
  | { type: "tool_call_completed"; toolCallId: string; result: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number; cost?: number }
  | { type: "done" }
  | { type: "error"; message: string };

export type AiProviderKind = "cli" | "oauth" | "api" | "local";

export type AiReasoningEffort = "none" | "low" | "medium" | "high" | "max";

export interface AiProviderConfig {
  id: string;
  kind: AiProviderKind;
  name: string;
  model: string;
  apiKey?: string;
  endpointUrl?: string;
  temperature?: number;
  reasoningEffort?: AiReasoningEffort;
}
