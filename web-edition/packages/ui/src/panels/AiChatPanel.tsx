import React, { useState, useRef, useEffect } from "react";
import type { VaultAdapter, NoteRef, AiMessage, AiProviderConfig, AiContextRef, AiImageAttachment } from "@noteriv/core";
import { createVfsTools, buildPromptWithContext, buildSystemPrompt, GitSafetyNet, wrapAdapterWithSafetyNet } from "@noteriv/core";
import { streamChat } from "@noteriv/ai-hub";
import ContextUsageMeter from "./ContextUsageMeter";
import { ModelEffortToolbar } from "./ModelEffortToolbar";
import VaultInsightsPanel from "./VaultInsightsPanel";
import { useMentionSlash, MentionSlashPopup, DEFAULT_SLASH_COMMANDS, type SlashCommand } from "../chat";

export interface AiChatPanelProps {
  adapter: VaultAdapter;
  vaultName?: string;
  activeNotePath?: string | null;
  activeNoteContent?: string | null;
  onOpenNote?: (path: string) => void;
  provider: AiProviderConfig;
  onProviderChange?: (provider: AiProviderConfig) => void;
  relayUrl?: string;
  onOpenSettings?: () => void;
  safetyNet?: GitSafetyNet;
  /** Lock the model picker (e.g. the account's monthly AI limit is used up). */
  modelSelectionDisabled?: boolean;
  /** Called when a reply finishes (or fails or is stopped), e.g. to refresh a usage counter. */
  onGenerationEnd?: () => void;
}

export const AiChatPanel: React.FC<AiChatPanelProps> = ({
  adapter,
  vaultName,
  activeNotePath,
  activeNoteContent,
  onOpenNote,
  provider,
  onProviderChange,
  relayUrl,
  onOpenSettings,
  safetyNet: initialSafetyNet,
  modelSelectionDisabled,
  onGenerationEnd,
}) => {
  const [currentProvider, setCurrentProvider] = useState<AiProviderConfig>(provider);
  const [attachedImages, setAttachedImages] = useState<AiImageAttachment[]>([]);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [usedTokens, setUsedTokens] = useState(1200);
  const [maxTokens] = useState(128000);
  const [vaultNotes, setVaultNotes] = useState<NoteRef[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "insights">("chat");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    mode: popupMode,
    query: popupQuery,
    selectedIndex,
    filteredCommands,
    filteredNotes,
    handleInputChange: handleTriggerChange,
    handleKeyDown: handlePopupKeyDown,
    close: closePopup,
  } = useMentionSlash({
    notes: vaultNotes,
    getNotePath: (n) => n.path,
    getNoteName: (n) => n.name.replace(/\.md$/i, ""),
  });

  useEffect(() => {
    setCurrentProvider(provider);
  }, [provider]);

  const handleProviderChange = (updated: AiProviderConfig) => {
    setCurrentProvider(updated);
    onProviderChange?.(updated);
  };

  const [safetyNet] = useState(() => initialSafetyNet || new GitSafetyNet());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load vault notes for @mention autocomplete
  useEffect(() => {
    adapter.listNotes().then(setVaultNotes).catch(() => {});
  }, [adapter]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Handle @mention and /slash command trigger
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    handleTriggerChange(val, e.target.selectionStart || 0);
  };

  const handleSelectCommand = (cmd: SlashCommand) => {
    const slashIdx = input.lastIndexOf("/");
    const nextInput = slashIdx !== -1 ? input.slice(0, slashIdx) + `${cmd.command} ` : `${cmd.command} `;
    setInput(nextInput);
    closePopup();
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handleSelectMention = (note: NoteRef) => {
    const cursorPos = input.lastIndexOf("@");
    if (cursorPos === -1) return;
    const nextInput =
      input.slice(0, cursorPos) +
      `[[${note.name.replace(/\.md$/i, "")}]] ` +
      input.slice(cursorPos + 1 + (popupQuery?.length || 0));
    setInput(nextInput);
    closePopup();
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64Data = result.includes(",") ? result.split(",")[1] : result;
          setAttachedImages((prev) => [
            ...prev,
            {
              mimeType: file.type,
              data: base64Data,
              name: file.name || `screenshot-${Date.now()}.png`,
            },
          ]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleRemoveImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if ((!input.trim() && attachedImages.length === 0) || isGenerating) return;

    const userText = input.trim() || (attachedImages.length > 0 ? "Phân tích ảnh này giúp tôi" : "");
    const imagesToSend = [...attachedImages];
    setInput("");
    setAttachedImages([]);
    closePopup();

    // Check if userText starts with a slash command (/summarize, /action-items, etc.)
    let expandedPrompt = userText;
    const slashMatch = userText.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/s);
    if (slashMatch) {
      const cmdKey = `/${slashMatch[1].toLowerCase()}`;
      const matchedCmd = DEFAULT_SLASH_COMMANDS.find((c) => c.command.toLowerCase() === cmdKey);
      if (matchedCmd) {
        const userArg = slashMatch[2]?.trim();
        expandedPrompt = userArg
          ? `${matchedCmd.promptTemplate}\n\nYêu cầu bổ sung: ${userArg}`
          : matchedCmd.promptTemplate;
      }
    }

    // Build context with active note content and vault overview
    let activeContent = activeNoteContent || "";
    if (!activeContent && activeNotePath) {
      try {
        const notes = await adapter.listNotes();
        const found = notes.find((n) => n.path === activeNotePath || n.name === activeNotePath);
        if (found) {
          activeContent = (await adapter.readNote(found.id)) || "";
        } else {
          activeContent = (await adapter.readNote(activeNotePath)) || "";
        }
      } catch {}
    }

    // Extract unique folder list from vault notes
    const folders = Array.from(
      new Set(
        vaultNotes
          .map((n) => {
            const parts = n.path.split("/");
            return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
          })
          .filter(Boolean)
      )
    ).sort();

    // Scan user text for any referenced notes: [[Note Name]] or @Note
    const mentionedMatches = Array.from(userText.matchAll(/\[\[([^\]]+)\]\]/g)).map((m) => m[1].trim());
    const mentionedList: Array<{ path: string; title?: string; content?: string }> = [];

    for (const mention of mentionedMatches) {
      const found = vaultNotes.find(
        (n) =>
          n.name.replace(/\.md$/i, "").toLowerCase() === mention.toLowerCase() ||
          n.path.toLowerCase() === mention.toLowerCase() ||
          n.path.toLowerCase() === `${mention.toLowerCase()}.md`
      );
      if (found && found.path !== activeNotePath) {
        try {
          const content = await adapter.readNote(found.id);
          if (content) {
            mentionedList.push({
              path: found.path,
              title: found.name.replace(/\.md$/i, ""),
              content,
            });
          }
        } catch {}
      }
    }

    // Construct comprehensive AI Context
    const aiContext: AiContextRef = {
      vaultOverview: {
        name: vaultName || "Vault",
        totalNotes: vaultNotes.length,
        folders,
        // Send all note paths for comprehensive awareness (zero bloat, ~15 bytes/note)
        notes: vaultNotes.slice(0, 500).map((n) => ({
          path: n.path,
          name: n.name.replace(/\.md$/i, ""),
        })),
      },
      activeNote: activeNotePath
        ? {
            path: activeNotePath,
            title: activeNotePath.split("/").pop()?.replace(/\.md$/i, ""),
            content: activeContent,
          }
        : undefined,
      mentionedNotes: mentionedList.length > 0 ? mentionedList : undefined,
    };

    const userPromptWithContext = buildPromptWithContext(expandedPrompt, aiContext);

    const userMsg: AiMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: userText,
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
      createdAt: Date.now(),
    };

    const userMsgForApi: AiMessage = {
      ...userMsg,
      content: userPromptWithContext,
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
    };

    const assistantMsgId = `asst-${Date.now()}`;
    const initialAssistantMsg: AiMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg, initialAssistantMsg]);
    setIsGenerating(true);

    const wrappedAdapter = wrapAdapterWithSafetyNet(adapter, safetyNet);
    const vfsTools = createVfsTools(wrappedAdapter);
    const toolDefs = vfsTools.getToolDefinitions();

    try {
      const allMessages = [...messages, userMsgForApi];
      const stream = streamChat({
        provider: currentProvider,
        messages: allMessages,
        systemPrompt: buildSystemPrompt({ vaultName }),
        tools: toolDefs,
        relayUrl,
      });

      let accumulatedText = "";

      for await (const event of stream) {
        if (event.type === "text_delta") {
          accumulatedText += event.text;
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsgId ? { ...m, content: accumulatedText } : m))
          );
        } else if (event.type === "tool_call_started") {
          // Tool invocation executed by VFS
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    toolCalls: [...(m.toolCalls || []), event.toolCall],
                  }
                : m
            )
          );
          // Execute tool in client
          try {
            const toolResult = await vfsTools.executeTool(
              event.toolCall.name,
              event.toolCall.arguments
            );
            // In full loop, this feeds back to next turn; here we record success
          } catch (err: any) {
            // Record tool error
          }
        } else if (event.type === "usage") {
          setUsedTokens((prev) => prev + event.inputTokens + event.outputTokens);
        } else if (event.type === "error") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + `\n\n*(Error: ${event.message})*` }
                : m
            )
          );
        }
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: m.content + `\n\n*(Failed: ${err.message})*` }
            : m
        )
      );
    } finally {
      setIsGenerating(false);
      onGenerationEnd?.();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] border-l border-[var(--border-subtle)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Noteriv AI</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-modifier-hover)] text-[var(--text-secondary)]">
            {currentProvider.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ContextUsageMeter usedTokens={usedTokens} maxTokens={maxTokens} />
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-modifier-hover)]"
              title="AI Settings"
            >
              ⚙
            </button>
          )}
        </div>
      </div>

      {/* Tab Switcher: Chat vs Vault Insights */}
      <div className="flex border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 pt-1 gap-1 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab("chat")}
          className={`flex-1 py-1.5 px-2 rounded-t-md font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === "chat"
              ? "bg-[var(--bg-primary)] text-[var(--text-primary)] border-t border-x border-[var(--border-subtle)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <span>💬</span>
          <span>Trò chuyện</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("insights")}
          className={`flex-1 py-1.5 px-2 rounded-t-md font-medium flex items-center justify-center gap-1.5 transition-colors ${
            activeTab === "insights"
              ? "bg-[var(--bg-primary)] text-[var(--text-primary)] border-t border-x border-[var(--border-subtle)]"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <span>🕸️</span>
          <span>Khám phá Vault</span>
        </button>
      </div>

      {/* Active Context & Vault Indicator */}
      <div className="px-3 py-1.5 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] flex items-center justify-between gap-1">
        <div className="truncate flex items-center gap-1.5" title={`Bối cảnh AI: ${vaultName || "Vault"} (${vaultNotes.length} ghi chú)`}>
          <span className="font-medium text-[var(--text-accent, #3b82f6)]">
            🗄️ {vaultName || "Vault"}
          </span>
          <span className="text-[10px] px-1 py-0.2 rounded bg-[var(--bg-modifier-hover)] text-[var(--text-muted)]">
            {vaultNotes.length} notes
          </span>
          {activeNotePath && (
            <>
              <span className="text-[var(--text-muted)]">•</span>
              <span className="truncate" title={activeNotePath}>
                📄 {activeNotePath}
              </span>
            </>
          )}
        </div>
      </div>

      {activeTab === "insights" ? (
        <VaultInsightsPanel
          adapter={adapter}
          notes={vaultNotes}
          activeNotePath={activeNotePath}
          activeNoteContent={activeNoteContent}
          onOpenNote={onOpenNote}
          onAskAi={(prompt) => {
            setActiveTab("chat");
            setInput(prompt);
            setTimeout(() => textareaRef.current?.focus(), 50);
          }}
        />
      ) : (
        <>
          {/* Message List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-[var(--text-secondary)] p-4 text-xs space-y-2">
                <span className="text-2xl">✨</span>
                <p className="font-medium text-sm text-[var(--text-primary)]">Hỏi đáp & Tương tác Vault</p>
                <p>Hỏi bất kỳ điều gì về ghi chú, gõ / chọn lệnh nhanh, gõ @ nhắc file, hoặc bôi đen văn bản bấm Ctrl+K để chỉnh sửa trực tiếp.</p>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-[var(--interactive-accent, #3b82f6)] text-white"
                        : "bg-[var(--bg-secondary)] border border-[var(--border-subtle)]"
                    }`}
                  >
                    {/* Attached Images in User Message */}
                    {m.images && m.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {m.images.map((img, idx) => (
                          <img
                            key={idx}
                            src={`data:${img.mimeType};base64,${img.data}`}
                            alt={img.name || "attachment"}
                            className="max-h-36 max-w-full rounded border border-white/20 object-contain shadow-sm"
                          />
                        ))}
                      </div>
                    )}

                    <div className="whitespace-pre-wrap">{m.content || (isGenerating && m.role === "assistant" ? "Đang suy nghĩ..." : "")}</div>

                    {/* Render Tool Invocations */}
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] space-y-1 text-xs">
                        {m.toolCalls.map((tc) => (
                          <div key={tc.id} className="flex items-center gap-1.5 text-[var(--text-secondary)] font-mono">
                            <span>⚡ {tc.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Mention & Slash Command Popup */}
          <MentionSlashPopup
            mode={popupMode}
            filteredCommands={filteredCommands}
            filteredNotes={filteredNotes}
            selectedIndex={selectedIndex}
            getNotePath={(n) => n.path}
            getNoteName={(n) => n.name.replace(/\.md$/i, "")}
            onSelectCommand={handleSelectCommand}
            onSelectNote={handleSelectMention}
          />
        </>
      )}

      {/* Composer Input Area */}
      <div className="p-3 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] space-y-2">
        {/* Model & Reasoning Effort Toolbar */}
        <ModelEffortToolbar
          provider={currentProvider}
          onProviderChange={handleProviderChange}
          modelSelectionDisabled={modelSelectionDisabled}
          onAttachImage={(img) => setAttachedImages((prev) => [...prev, img])}
          onOpenSettings={onOpenSettings}
        />

        {/* Attached Images Preview Strip */}
        {attachedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 p-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md">
            {attachedImages.map((img, idx) => (
              <div key={idx} className="relative group rounded border border-[var(--border-subtle)] overflow-hidden">
                <img
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={img.name || "preview"}
                  className="h-12 w-12 object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveImage(idx)}
                  className="absolute top-0.5 right-0.5 bg-black/70 hover:bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]"
                  title="Xóa ảnh"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (popupMode) {
                if (e.key === "Enter" || e.key === "Tab") {
                  if (popupMode === "slash" && filteredCommands[selectedIndex]) {
                    e.preventDefault();
                    handleSelectCommand(filteredCommands[selectedIndex]);
                    return;
                  }
                  if (popupMode === "mention" && filteredNotes[selectedIndex]) {
                    e.preventDefault();
                    handleSelectMention(filteredNotes[selectedIndex]);
                    return;
                  }
                }
                if (handlePopupKeyDown(e)) {
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Hỏi AI, gõ / chọn lệnh, @ nhắc file, hoặc Ctrl+V dán ảnh..."
            rows={2}
            className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-md px-2.5 py-1.5 text-sm resize-none focus:outline-none focus:border-[var(--interactive-accent, #3b82f6)]"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={(!input.trim() && attachedImages.length === 0) || isGenerating}
            className="self-end px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--interactive-accent, #3b82f6)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {isGenerating ? "..." : "Gửi"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiChatPanel;
