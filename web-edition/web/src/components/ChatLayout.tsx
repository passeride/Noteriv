"use client";

import { AiChatPanel, type AiChatPanelProps } from "@noteriv/ui/panels";
import { useUsageTracking } from "@/hooks/useUsageTracking";
import { usageLevel } from "@/lib/usage";
import { UsageCounter } from "./UsageCounter";

/**
 * The AI chat with its usage counter on top. Polls usage while mounted (the vault page mounts it only while the
 * chat panel is open), refreshes right after each reply, and disables model selection once the limit is exceeded.
 */
export function ChatLayout(props: AiChatPanelProps) {
  const { usage, refresh } = useUsageTracking();
  const exceeded = usage !== null && usageLevel(usage) === "exceeded";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <UsageCounter usage={usage} model={props.provider.model} />
      <div className="min-h-0 flex-1">
        <AiChatPanel {...props} modelSelectionDisabled={exceeded} onGenerationEnd={() => void refresh()} />
      </div>
    </div>
  );
}

export default ChatLayout;
