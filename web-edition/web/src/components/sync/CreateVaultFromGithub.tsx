"use client";

import { useEffect, useRef, useState } from "react";
import { webApi } from "@/lib/webApi";
import { planLimitNotice } from "@/components/PlanLimitNotice";
import { GithubWizard } from "@/components/sync/SyncSection";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

/**
 * "New vault from a GitHub repo" — the web counterpart of the desktop setup
 * wizard's clone flow. The token/repo calls are vault-scoped (access control), so a
 * placeholder vault is created first, then renamed after the repo is chosen and
 * the first pull is queued. Closing the wizard early deletes the placeholder.
 */
export default function CreateVaultFromGithub({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (vaultId: string) => void;
}) {
  useLocale();
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [error, setError] = useState<React.ReactNode>("");
  const finishedRef = useRef(false);
  const vaultRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    webApi.vaults
      .create({ name: "GitHub vault" })
      .then((v) => {
        if (cancelled) {
          webApi.vaults.remove(v.id).catch(() => undefined);
          return;
        }
        vaultRef.current = v.id;
        setVaultId(v.id);
      })
      .catch((err) => setError(planLimitNotice(err) ?? t("web.newVaultGithub.createFailed")));
    return () => {
      cancelled = true;
      // Wizard abandoned before a repo was connected: don't leave an empty vault behind.
      if (!finishedRef.current && vaultRef.current) webApi.vaults.remove(vaultRef.current).catch(() => undefined);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-xl"
        style={{ width: 560, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto", padding: 20 }}
      >
        <h2 className="text-base font-semibold" style={{ marginBottom: 12 }}>
          {t("web.newVaultGithub.title")}
        </h2>
        {error && <div style={{ color: "var(--red)" }}>{error}</div>}
        {!vaultId && !error && <div className="text-sm text-[var(--text-muted)]">{t("web.newVaultGithub.preparing")}</div>}
        {vaultId && (
          <GithubWizard
            vaultId={vaultId}
            onCancel={onClose}
            onDone={async (conn, repo) => {
              finishedRef.current = true;
              try {
                await webApi.vaults.update(vaultId, { name: repo.name });
                // First sync pulls the repo's notes into the new vault.
                await webApi.sync.update(vaultId, conn.id, { pullOnOpen: true });
                await webApi.sync.trigger(vaultId, conn.id);
              } catch {
                // the vault and connection exist; the user can sync manually from Settings
              }
              onCreated(vaultId);
            }}
          />
        )}
      </div>
    </div>
  );
}
