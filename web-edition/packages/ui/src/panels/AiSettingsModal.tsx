import React, { useState } from "react";
import type { AiProviderConfig } from "@noteriv/core";
import {
  startCodexDeviceAuth,
  pollCodexDeviceToken,
  type CodexDeviceAuthSession,
  PROVIDER_GROUPS,
  getModelsForProvider,
  getDefaultModelForProvider,
} from "@noteriv/ai-hub";

export interface AiSettingsModalProps {
  currentConfig: AiProviderConfig;
  onSave: (config: AiProviderConfig) => void;
  onClose: () => void;
  relayUrl?: string;
  onSaveRelayUrl?: (url: string) => void;
}

export const AiSettingsModal: React.FC<AiSettingsModalProps> = ({
  currentConfig,
  onSave,
  onClose,
  relayUrl: initialRelayUrl = "",
  onSaveRelayUrl,
}) => {
  const [selectedId, setSelectedId] = useState(currentConfig.id);
  const [apiKey, setApiKey] = useState(currentConfig.apiKey || "");
  const [selectedModel, setSelectedModel] = useState(() => {
    return currentConfig.model || getDefaultModelForProvider(currentConfig.id);
  });
  const [isCustomModel, setIsCustomModel] = useState(() => {
    const available = getModelsForProvider(currentConfig.id);
    return currentConfig.model ? !available.some((m) => m.id === currentConfig.model) : false;
  });
  const [customModelText, setCustomModelText] = useState(currentConfig.model || "");
  const [relayUrl, setRelayUrl] = useState(initialRelayUrl);

  // Device Code State for ChatGPT Plus
  const [deviceSession, setDeviceSession] = useState<CodexDeviceAuthSession | null>(null);
  const [deviceAuthStatus, setDeviceAuthStatus] = useState<"idle" | "waiting" | "success" | "error">("idle");
  const [authError, setAuthError] = useState<string | null>(null);

  const handleProviderSelect = (newId: string) => {
    setSelectedId(newId);
    const defaultMod = getDefaultModelForProvider(newId);
    setSelectedModel(defaultMod);
    setIsCustomModel(false);
  };

  const handleModelSelect = (val: string) => {
    if (val === "__custom__") {
      setIsCustomModel(true);
      if (!customModelText) setCustomModelText(selectedModel);
    } else {
      setIsCustomModel(false);
      setSelectedModel(val);
    }
  };

  const handleStartDeviceAuth = async () => {
    try {
      setDeviceAuthStatus("waiting");
      setAuthError(null);
      const session = await startCodexDeviceAuth();
      setDeviceSession(session);

      // Start background polling
      const pollInterval = setInterval(async () => {
        const res = await pollCodexDeviceToken(session.deviceAuthId, session.userCode);
        if (res.status === "approved") {
          clearInterval(pollInterval);
          setDeviceAuthStatus("success");
          onSave({
            id: "codex-oauth",
            kind: "oauth",
            name: "ChatGPT Plus (Codex OAuth)",
            model: "gpt-4o",
            apiKey: res.tokens.access_token,
          });
        } else if (res.status === "expired" || res.status === "error") {
          clearInterval(pollInterval);
          setDeviceAuthStatus("error");
          setAuthError(res.status === "expired" ? "Mã xác thực đã hết hạn, vui lòng thử lại." : res.error || "Lỗi xác thực.");
        }
      }, session.interval * 1000);
    } catch (e: any) {
      setDeviceAuthStatus("error");
      setAuthError(e?.message || "Không thể khởi tạo phiên xác thực thiết bị.");
    }
  };

  const handleSave = () => {
    const group = PROVIDER_GROUPS.find((g) => g.id === selectedId);
    const name = group?.name || "Custom AI";
    const kind = group?.kind || "api";

    const finalModel = isCustomModel
      ? customModelText.trim() || getDefaultModelForProvider(selectedId)
      : selectedModel || getDefaultModelForProvider(selectedId);

    onSave({
      id: selectedId,
      kind,
      name,
      model: finalModel,
      apiKey: apiKey.trim() || undefined,
    });

    if (onSaveRelayUrl) {
      onSaveRelayUrl(relayUrl.trim());
    }

    onClose();
  };

  const availableModels = getModelsForProvider(selectedId);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg shadow-2xl max-w-lg w-full p-5 space-y-4 text-sm text-[var(--text-primary)]">
        <div className="flex justify-between items-center border-b border-[var(--border-subtle)] pb-2">
          <h2 className="font-semibold text-base">Cài đặt Trợ lý AI (Noteriv AI)</h2>
          <button type="button" onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            ✕
          </button>
        </div>

        {/* Provider Selection */}
        <div className="space-y-1.5">
          <label className="font-medium text-xs text-[var(--text-secondary)]">Nguồn cung cấp mô hình (Provider)</label>
          <select
            value={selectedId}
            onChange={(e) => handleProviderSelect(e.target.value)}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-sm"
          >
            <optgroup label="Gói Thuê bao Tháng / Agentic CLI (Miễn phí Token)">
              <option value="antigravity-cli">Google Antigravity Agentic CLI (Gemini / Claude / DeepSeek)</option>
              <option value="claude-sdk">Claude Code (Gói Claude Pro / Max qua CLI)</option>
              <option value="codex-oauth">ChatGPT Plus / Team (Codex Device OAuth)</option>
            </optgroup>
            <optgroup label="Tự cấp API Key (BYOK)">
              <option value="deepseek">DeepSeek (R1 Reasoning / V3 Chat)</option>
              <option value="grok">xAI Grok (Grok-2 Vision / Grok-3)</option>
              <option value="gemini-api">Google Gemini API (Gemini 2.0 Flash / Pro)</option>
              <option value="openai-api">OpenAI API (GPT-4o / o3-mini)</option>
              <option value="ollama">Ollama Local (Offline trên máy cá nhân)</option>
            </optgroup>
          </select>
        </div>

        {/* Model Selection per Provider */}
        <div className="space-y-1.5">
          <label className="font-medium text-xs text-[var(--text-secondary)]">
            Mô hình của Provider ({selectedId})
          </label>
          <select
            value={isCustomModel ? "__custom__" : selectedModel}
            onChange={(e) => handleModelSelect(e.target.value)}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-sm"
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.supportsReasoning ? "🧠" : ""} ({m.id})
              </option>
            ))}
            <option value="__custom__">-- Tự nhập model khác... --</option>
          </select>

          {isCustomModel && (
            <input
              type="text"
              value={customModelText}
              onChange={(e) => setCustomModelText(e.target.value)}
              placeholder="Nhập định danh model (VD: gemini-3.8-flash-high, gpt-4o)..."
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-sm mt-1 font-mono text-xs"
            />
          )}
        </div>

        {/* ChatGPT Plus Device OAuth Section */}
        {selectedId === "codex-oauth" && (
          <div className="p-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded space-y-2 text-xs">
            <p className="font-medium">Đăng nhập tài khoản ChatGPT Plus bằng mã thiết bị:</p>
            {deviceAuthStatus === "idle" && (
              <button
                type="button"
                onClick={handleStartDeviceAuth}
                className="px-3 py-1.5 bg-[var(--interactive-accent, #3b82f6)] text-white rounded font-medium"
              >
                Nhận mã đăng nhập OpenAI
              </button>
            )}
            {deviceAuthStatus === "waiting" && deviceSession && (
              <div className="space-y-2">
                <p>1. Mở trang: <a href={deviceSession.verificationUrl} target="_blank" rel="noreferrer" className="text-blue-400 underline">{deviceSession.verificationUrl}</a></p>
                <p>2. Nhập mã hiển thị bên dưới:</p>
                <div className="text-xl font-mono tracking-widest text-center py-2 bg-[var(--bg-primary)] border border-dashed rounded font-bold text-[var(--interactive-accent, #3b82f6)]">
                  {deviceSession.userCode}
                </div>
                <p className="text-[var(--text-secondary)] animate-pulse">Đang chờ bạn xác nhận trên trình duyệt...</p>
              </div>
            )}
            {deviceAuthStatus === "success" && (
              <p className="text-green-500 font-medium">✓ Đã kết nối thành công với tài khoản ChatGPT Plus!</p>
            )}
            {deviceAuthStatus === "error" && (
              <p className="text-red-500 font-medium">✕ {authError}</p>
            )}
          </div>
        )}

        {/* BYOK API Key Section */}
        {selectedId !== "claude-sdk" && selectedId !== "codex-oauth" && selectedId !== "antigravity-cli" && selectedId !== "ollama" && (
          <div className="space-y-1.5">
            <label className="font-medium text-xs text-[var(--text-secondary)]">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Nhập API key của bạn..."
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-sm"
            />
          </div>
        )}

        {/* Local Relay URL (For Web/Mobile connection to Home Desktop) */}
        <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
          <label className="font-medium text-xs text-[var(--text-secondary)]">
            Địa chỉ Relay Cá nhân (Local Sidecar Relay URL)
          </label>
          <input
            type="text"
            name="noteriv-ai-relay-url"
            autoComplete="off"
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="Để trống = dùng máy chủ Noteriv. Hoặc ví dụ: http://192.168.1.5:4001"
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded px-3 py-1.5 text-sm font-mono text-xs"
          />
          <p className="text-[11px] text-[var(--text-secondary)]">
            Dành cho Web hoặc Điện thoại kết nối về máy tính ở nhà để dùng Antigravity hoặc Claude Code Subscription.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-[var(--bg-modifier-hover)] hover:bg-[var(--bg-modifier-active)]"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded font-medium bg-[var(--interactive-accent, #3b82f6)] text-white hover:opacity-90"
          >
            Lưu cài đặt
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiSettingsModal;
