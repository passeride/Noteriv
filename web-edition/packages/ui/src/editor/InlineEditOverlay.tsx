import React, { useState, useRef, useEffect } from "react";
import type { EditorView } from "@codemirror/view";
import type { AiProviderConfig } from "@noteriv/core";
import { streamChat } from "@noteriv/ai-hub";
import {
  type InlineEditValue,
  setInlineDiffEffect,
  closeInlineEditEffect,
  acceptInlineEditCommand,
  rejectInlineEditCommand,
  computeLineDiff,
} from "./inline-edit-extension";

export interface InlineEditOverlayProps {
  view: EditorView;
  inlineEdit: InlineEditValue;
  coords: { top: number; left: number } | null;
  provider?: AiProviderConfig;
  relayUrl?: string;
  onClose: () => void;
  onAccept: () => void;
}

const PRESET_PROMPTS = [
  { label: "✍️ Viết lại mượt hơn", prompt: "Viết lại đoạn văn này cho tự nhiên, mượt mà và cuốn hút hơn nhưng giữ nguyên ý chính." },
  { label: "🔍 Sửa chính tả & ngữ pháp", prompt: "Sửa toàn bộ lỗi chính tả, dấu câu và ngữ pháp trong đoạn văn này." },
  { label: "📝 Tóm tắt ngắn gọn", prompt: "Tóm tắt đoạn văn này thành 1-2 câu súc tích nhất." },
  { label: "🌐 Dịch sang tiếng Anh", prompt: "Dịch chuẩn xác đoạn văn này sang tiếng Anh tự nhiên." },
  { label: "📋 Định dạng danh sách", prompt: "Chuyển đổi các ý trong đoạn văn thành danh sách gạch đầu dòng rõ ràng." },
  { label: "💡 Mở rộng & thêm chi tiết", prompt: "Mở rộng và phát triển thêm các ý chi tiết, sắc sảo cho đoạn văn này." },
];

export const InlineEditOverlay: React.FC<InlineEditOverlayProps> = ({
  view,
  inlineEdit,
  coords,
  provider,
  relayUrl = "",
  onClose,
  onAccept,
}) => {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (inlineEdit.status === "prompting") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [inlineEdit.status]);

  const handleGenerate = async (customPrompt?: string) => {
    const instruction = customPrompt || prompt.trim();
    if (!instruction || isGenerating) return;

    setIsGenerating(true);
    setError(null);

    const activeProvider: AiProviderConfig = provider || {
      id: "claude-sdk",
      kind: "cli",
      name: "Claude Code CLI",
      model: "sonnet",
    };

    const systemInstruction = `Bạn là trợ lý biên tập văn bản chuyên nghiệp.
Nhiệm vụ của bạn là đọc đoạn văn bản gốc và thực hiện chỉnh sửa theo đúng yêu cầu của người dùng.
Yêu cầu chỉnh sửa: ${instruction}

Đoạn văn bản gốc:
"""
${inlineEdit.originalText}
"""

QUY TẮC BẮT BUỘC:
- Chỉ trả về DUY NHẤT nội dung văn bản sau khi đã sửa đổi hoặc viết lại.
- Tuyệt đối không thêm lời giải thích, không mở đầu bằng "Dưới đây là...", không đóng mở ngoặc kép thừa thãi.
- Giữ nguyên cú pháp định dạng Markdown nếu có.`;

    const userMessage = {
      id: `inline-${Date.now()}`,
      role: "user" as const,
      content: instruction,
      createdAt: Date.now(),
    };

    try {
      const stream = streamChat({
        provider: activeProvider,
        messages: [userMessage],
        systemPrompt: systemInstruction,
        relayUrl,
      });

      let accumulated = "";

      for await (const event of stream) {
        if (event.type === "text_delta") {
          accumulated += event.text;
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }

      const cleanResult = accumulated.trim();
      if (!cleanResult) {
        throw new Error("Mô hình không trả về nội dung sửa đổi.");
      }

      view.dispatch({
        effects: setInlineDiffEffect.of({ replacementText: cleanResult }),
      });
    } catch (err: any) {
      setError(err.message || "Có lỗi khi gọi AI.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (inlineEdit.status === "prompting") {
        void handleGenerate();
      } else if (inlineEdit.status === "diff") {
        onAccept();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const stylePosition: React.CSSProperties = coords
    ? {
        position: "absolute",
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        zIndex: 50,
      }
    : {
        position: "absolute",
        top: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 50,
      };

  return (
    <div
      style={stylePosition}
      className="w-[440px] max-w-[92vw] bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden backdrop-blur-md text-[var(--text-primary)] animate-in fade-in zoom-in-95 duration-150"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border)] text-xs">
        <div className="flex items-center gap-1.5 font-medium">
          <span className="text-base leading-none">✨</span>
          <span>Chỉnh sửa thông minh (Inline Edit)</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-[var(--bg-modifier-hover)] text-[var(--text-secondary)]">
            Ctrl+K
          </span>
        </div>
        <div className="flex items-center gap-1 text-[var(--text-muted)] text-[11px]">
          <span>{provider?.name || "Claude Sonnet 5.5"}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 p-0.5 rounded hover:bg-[var(--bg-modifier-hover)] text-[var(--text-secondary)]"
            title="Đóng (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-3 space-y-3">
        {/* Selected text preview snippet */}
        <div className="text-[11px] text-[var(--text-secondary)] bg-[var(--bg-secondary)] px-2.5 py-1.5 rounded border border-[var(--border-subtle)] truncate">
          <span className="font-semibold text-[var(--text-muted)]">Đoạn chọn: </span>
          <span className="italic font-mono">
            {inlineEdit.originalText.slice(0, 100)}
            {inlineEdit.originalText.length > 100 ? "..." : ""}
          </span>
          <span className="ml-1 text-[10px] text-[var(--text-muted)]">
            ({inlineEdit.originalText.length} ký tự)
          </span>
        </div>

        {inlineEdit.status === "prompting" && (
          <>
            {/* Input Form */}
            <div className="relative flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isGenerating}
                placeholder="Yêu cầu sửa đoạn văn này (vd: viết mượt hơn, dịch...)"
                className="w-full pl-3 pr-20 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-xs placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--interactive-accent, #3b82f6)] shadow-inner"
              />
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={isGenerating || !prompt.trim()}
                className="absolute right-1.5 px-2.5 py-1 bg-[var(--interactive-accent, #3b82f6)] text-white text-[11px] font-medium rounded hover:brightness-110 disabled:opacity-50 transition"
              >
                {isGenerating ? "Đang xử lý..." : "Tạo Diff ↵"}
              </button>
            </div>

            {/* Quick Action Chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PRESET_PROMPTS.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => {
                    setPrompt(item.prompt);
                    void handleGenerate(item.prompt);
                  }}
                  className="text-[11px] px-2 py-0.8 rounded-full bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--interactive-accent, #3b82f6)] hover:bg-[var(--bg-modifier-hover)] transition text-left truncate max-w-full"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Diff Preview View */}
        {inlineEdit.status === "diff" && (
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-[var(--text-secondary)] flex items-center justify-between">
              <span>Bản so sánh sửa đổi (Diff):</span>
              <span className="text-[10px] text-[var(--text-muted)]">Xem trước thay đổi</span>
            </div>

            <div className="max-h-56 overflow-y-auto border border-[var(--border)] rounded-lg bg-[var(--bg-secondary)] font-mono text-xs p-2 space-y-1">
              {inlineEdit.diffLines?.map((line, idx) => (
                <div
                  key={idx}
                  className={`px-1.5 py-0.5 rounded leading-relaxed whitespace-pre-wrap ${
                    line.type === "delete"
                      ? "bg-red-500/15 text-red-400 line-through"
                      : line.type === "insert"
                      ? "bg-emerald-500/20 text-emerald-300 font-medium"
                      : "text-[var(--text-muted)] opacity-80"
                  }`}
                >
                  <span className="select-none inline-block w-4 text-[10px] font-mono opacity-60">
                    {line.type === "delete" ? "-" : line.type === "insert" ? "+" : " "}
                  </span>
                  {line.text || " "}
                </div>
              ))}
            </div>

            {/* Actions for Diff */}
            <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => {
                  view.dispatch({
                    effects: closeInlineEditEffect.of(),
                  });
                }}
                className="px-2.5 py-1 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-modifier-hover)]"
              >
                ✕ Hủy (Esc)
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleGenerate()}
                  className="px-2.5 py-1 text-xs rounded border border-[var(--border)] hover:bg-[var(--bg-modifier-hover)] text-[var(--text-secondary)]"
                  title="Tạo lại bản khác"
                >
                  🔄 Tạo lại
                </button>
                <button
                  type="button"
                  onClick={onAccept}
                  className="px-3 py-1 text-xs font-medium rounded bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm flex items-center gap-1"
                >
                  ✓ Chấp nhận (Enter)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-2">
            ⚠️ {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default InlineEditOverlay;
