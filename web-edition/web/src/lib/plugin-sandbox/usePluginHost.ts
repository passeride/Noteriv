"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { VaultAdapter } from "@noteriv/core/vault-adapter";
import { useSandboxPluginHost, type EditorBridge, type PluginPermission, type SandboxPluginRecord } from "@noteriv/ui/plugins/sandbox";
import { webApi, type ApiPlugin } from "@/lib/webApi";
import { kvGet, kvSet } from "@/lib/offline-store";

/**
 * Web side of the community-plugin tier: installed plugins (and their grants and settings) live in the DB behind
 * webApi.plugins; the sandbox host itself is shared with desktop (@noteriv/ui/plugins/sandbox).
 */
export function usePluginHost(
  vaultId: string,
  adapter: VaultAdapter,
  editorBridge: EditorBridge,
  onVaultMutated: () => void,
  openFile?: (path: string) => boolean | Promise<boolean>
) {
  const [installed, setInstalled] = useState<ApiPlugin[]>([]);

  // Kept on this device too, so the vault's community plugins still run when it is opened offline.
  const refreshInstalled = useCallback(() => {
    webApi.plugins
      .list(vaultId)
      .then((list) => {
        setInstalled(list);
        void kvSet(`plugins:${vaultId}`, list);
      })
      .catch(async () => {
        const kept = await kvGet<ApiPlugin[]>(`plugins:${vaultId}`);
        if (kept) setInstalled(kept);
      });
  }, [vaultId]);

  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  const records = useMemo<SandboxPluginRecord[]>(
    () =>
      installed.map((p) => ({
        id: p.id,
        pluginId: p.pluginId,
        enabled: p.enabled,
        permissions: (p.manifest.permissions ?? []) as PluginPermission[],
        mainJs: p.mainJs,
        settings: p.settings ?? {},
      })),
    [installed]
  );

  const host = useSandboxPluginHost({
    sandboxUrl: "/plugin-sandbox.html",
    platform: "web",
    appVersion: "web",
    installed: records,
    adapter,
    editor: editorBridge,
    onVaultMutated,
    openFile,
    saveSettings: async (id, settings) => {
      await webApi.plugins.update(vaultId, id, { settings });
      refreshInstalled();
    },
  });

  return { ...host, installed, refreshInstalled };
}
