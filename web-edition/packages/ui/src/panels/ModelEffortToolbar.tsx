import React, { useState, useRef, useEffect } from "react";
import type { AiProviderConfig, AiReasoningEffort, AiImageAttachment } from "@noteriv/core";
import { PROVIDER_GROUPS, type ProviderGroup, type ModelOption } from "@noteriv/ai-hub";

export interface ModelEffortToolbarProps {
  provider: AiProviderConfig;
  onProviderChange: (updated: AiProviderConfig) => void;
  onAttachImage?: (img: AiImageAttachment) => void;
  onOpenSettings?: () => void;
  /** Disable the model picker (the current model stays visible). */
  modelSelectionDisabled?: boolean;
}

export const ModelEffortToolbar: React.FC<ModelEffortToolbarProps> = ({
  provider,
  onProviderChange,
  modelSelectionDisabled = false,
  onAttachImage,
  onOpenSettings,
}) => {
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showEffortMenu, setShowEffortMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowModelMenu(false);
        setShowEffortMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentEffort: AiReasoningEffort = provider.reasoningEffort || "none";

  const handleSelectModel = (group: ProviderGroup, m: ModelOption) => {
    onProviderChange({
      ...provider,
      id: group.id,
      name: group.name,
      model: m.id,
      kind: group.kind,
    });
    setShowModelMenu(false);
  };

  const handleSelectEffort = (effort: AiReasoningEffort) => {
    onProviderChange({
      ...provider,
      reasoningEffort: effort,
    });
    setShowEffortMenu(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onAttachImage) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.includes(",") ? result.split(",")[1] : result;
      onAttachImage({
        mimeType: file.type || "image/png",
        data: base64Data,
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const effortLabels: Record<AiReasoningEffort, { icon: string; label: string }> = {
    none: { icon: "⚡", label: "Tắt" },
    low: { icon: "🧠", label: "Thấp" },
    medium: { icon: "🧠", label: "Vừa" },
    high: { icon: "🔥", label: "Cao" },
    max: { icon: "💥", label: "Max" },
  };

  // Find active model & group for readable label on button
  const activeGroup = PROVIDER_GROUPS.find((g) => g.id === provider.id);
  const activeModel = activeGroup?.models.find((m) => m.id === provider.model);

  const getProviderShortName = (id: string) => {
    switch (id) {
      case "antigravity-cli": return "Antigravity";
      case "claude-sdk": return "Claude";
      case "codex-oauth": return "ChatGPT";
      case "deepseek": return "DeepSeek";
      case "grok": return "Grok";
      case "gemini-api": return "Gemini";
      case "openai-api": return "OpenAI";
      case "ollama": return "Ollama";
      default: return id;
    }
  };

  const displayLabel = activeModel
    ? `${getProviderShortName(provider.id)} • ${activeModel.name.split(" ")[0]} ${activeModel.name.split(" ")[1] || ""}`.trim()
    : (provider.name || provider.model || "Chọn mô hình");

  return (
    <div
      ref={toolbarRef}
      className="flex items-center justify-between px-2.5 py-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] select-none relative"
    >
      {/* Left: Model Picker & Effort Level */}
      <div className="flex items-center gap-1.5">
        {/* Model Selector Button */}
        <div className="relative">
          <button
            type="button"
            disabled={modelSelectionDisabled}
            onClick={() => {
              setShowModelMenu((prev) => !prev);
              setShowEffortMenu(false);
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:bg-[var(--bg-modifier-hover)] text-[var(--text-primary)] font-medium text-[11px] transition-colors max-w-[170px] truncate disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[var(--bg-primary)]"
            title={modelSelectionDisabled ? "Đã hết hạn mức AI của tháng" : "Đổi mô hình AI nhanh của từng provider"}
          >
            <span className="truncate">{displayLabel}</span>
            <span className="text-[10px] text-[var(--text-secondary)] opacity-70">▾</span>
          </button>

          {/* Model Menu Dropdown */}
          {showModelMenu && !modelSelectionDisabled && (
            <div className="absolute bottom-full left-0 mb-1.5 w-72 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg shadow-2xl py-1 z-50 text-xs overflow-hidden max-h-80 overflow-y-auto">
              {PROVIDER_GROUPS.map((group, gIdx) => (
                <div key={group.id} className={gIdx > 0 ? "border-t border-[var(--border-subtle)] mt-1 pt-1" : ""}>
                  <div className="px-2.5 py-1 font-semibold text-[10px] text-[var(--text-muted)] tracking-wider uppercase flex items-center justify-between bg-[var(--bg-secondary)]/50">
                    <span>{group.name}</span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-[var(--bg-modifier-hover)] lowercase">
                      {group.category}
                    </span>
                  </div>
                  {group.models.map((m) => {
                    const isSelected = provider.id === group.id && provider.model === m.id;
                    return (
                      <button
                        key={`${group.id}-${m.id}`}
                        type="button"
                        onClick={() => handleSelectModel(group, m)}
                        className={`w-full text-left px-2.5 py-1.5 flex items-center justify-between hover:bg-[var(--bg-modifier-hover)] transition-colors ${
                          isSelected ? "text-[var(--interactive-accent, #3b82f6)] font-semibold bg-[var(--bg-modifier-hover)]/40" : ""
                        }`}
                      >
                        <span className="truncate text-[11px]">{m.name}</span>
                        {m.supportsReasoning && <span className="text-[10px] opacity-75 shrink-0 ml-1">🧠</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reasoning / Thinking Effort Selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowEffortMenu((prev) => !prev);
              setShowModelMenu(false);
            }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:bg-[var(--bg-modifier-hover)] text-[11px] transition-colors"
            title="Mức độ tư duy / suy luận (Thinking Effort)"
          >
            <span>{effortLabels[currentEffort].icon}</span>
            <span className="text-[10px]">{effortLabels[currentEffort].label}</span>
          </button>

          {/* Effort Menu Dropdown */}
          {showEffortMenu && (
            <div className="absolute bottom-full left-0 mb-1.5 w-32 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded shadow-xl py-1 z-50 text-xs">
              <div className="px-2 py-0.5 font-semibold text-[9px] text-[var(--text-muted)] tracking-wider uppercase">
                Mức độ tư duy
              </div>
              {(["none", "low", "medium", "high", "max"] as AiReasoningEffort[]).map((eff) => (
                <button
                  key={eff}
                  type="button"
                  onClick={() => handleSelectEffort(eff)}
                  className={`w-full text-left px-2 py-1 flex items-center gap-1.5 hover:bg-[var(--bg-modifier-hover)] ${
                    currentEffort === eff ? "text-[var(--interactive-accent, #3b82f6)] font-semibold" : ""
                  }`}
                >
                  <span>{effortLabels[eff].icon}</span>
                  <span>{effortLabels[eff].label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: Image Attachment Button & Settings */}
      <div className="flex items-center gap-1">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileInputChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="p-1 rounded hover:bg-[var(--bg-modifier-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title="Đính kèm ảnh hoặc dán ảnh (Ctrl+V)"
        >
          📎
        </button>

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1 rounded hover:bg-[var(--bg-modifier-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title="Cài đặt AI chi tiết"
          >
            ⚙️
          </button>
        )}
      </div>
    </div>
  );
};

export default ModelEffortToolbar;
