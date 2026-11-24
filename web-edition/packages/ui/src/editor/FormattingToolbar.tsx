"use client";

import type { FormattingAction } from "./editor-commands";

// The action type and runFormattingAction live in editor-commands.ts (no CodeMirror at runtime), so a host can run an
// action without loading the editor; they are re-exported here as before.
export { runFormattingAction, type FormattingAction } from "./editor-commands";
import { useT } from "../i18n/react";

// `label` and `short` are i18n keys under editor.toolbar; `content` is a symbol that needs no translation.
const actions: { action: FormattingAction; label: string; shortcut?: string; content?: string; short?: string; className?: string }[] = [
  { action: "inlineAiEdit", label: "aiEdit", shortcut: "Ctrl+K", content: "✨ AI", className: "formatting-toolbar-ai font-semibold text-[var(--interactive-accent,#3b82f6)]" },
  { action: "toggleBold", label: "bold", content: "B", className: "formatting-toolbar-bold" },
  { action: "toggleItalic", label: "italic", shortcut: "Ctrl+I", content: "I", className: "formatting-toolbar-italic" },
  { action: "toggleStrikethrough", label: "strikethrough", content: "S", className: "formatting-toolbar-strike" },
  { action: "toggleCode", label: "code", shortcut: "Ctrl+`", content: "<>" },
  { action: "insertLink", label: "link", short: "link" },
  { action: "insertImage", label: "image", short: "image" },
  { action: "insertBlockquote", label: "blockquote", short: "blockquote" },
  { action: "insertCodeBlock", label: "codeBlock", short: "codeBlock" },
  { action: "insertTaskList", label: "taskList", short: "taskList" },
  { action: "insertTable", label: "table", short: "table" },
  { action: "insertHorizontalRule", label: "rule", short: "rule" },
];

/**
 * The toolbar only reports which button was pressed. What an action does is the host's call: the web app runs the
 * editor commands directly (runFormattingAction), the desktop app routes through its hotkey dispatcher, which
 * knows about more commands than these.
 */
export default function FormattingToolbar({ onAction }: { onAction: (action: FormattingAction) => void }) {
  const t = useT();
  return (
    <div className="formatting-toolbar" aria-label={t("editor.toolbar.label")}>
      {actions.map(({ action, label: labelKey, shortcut, content, short, className }) => {
        const label = labelKey === "aiEdit" ? "Sửa bằng AI" : t(`editor.toolbar.${labelKey}`);
        return (
          <button
            key={action}
            type="button"
            className={`formatting-toolbar-button ${className || ""}`}
            title={shortcut ? `${label} (${shortcut})` : label}
            aria-label={label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAction(action)}
          >
            {content ?? t(`editor.toolbar.short.${short}`)}
          </button>
        );
      })}
    </div>
  );
}
