"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { VaultChevronIcon, PlusIcon, RenameIcon, TrashIcon } from "@/components/icons";
import { webApi, type ApiVault } from "@/lib/webApi";
import { planLimitNotice } from "@/components/PlanLimitNotice";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

interface VaultSwitcherProps {
  vaults: ApiVault[];
  activeVault: ApiVault | null;
  onVaultsChanged?: () => void;
  onImportNewVault?: () => void;
  onNewFromGithub?: () => void;
}

export default function VaultSwitcher({ vaults, activeVault, onVaultsChanged, onImportNewVault, onNewFromGithub }: VaultSwitcherProps) {
  useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Two-click delete (no window.confirm — project rule): first click arms, second deletes.
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<React.ReactNode>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const displayName = activeVault?.name || t("web.vaults.noVault");

  async function submitCreateVault(e: React.FormEvent) {
    e.preventDefault();
    const name = newVaultName.trim();
    if (!name) return;
    let vault: ApiVault;
    try {
      vault = await webApi.vaults.create({ name });
    } catch (err) {
      setActionError(planLimitNotice(err) ?? t("web.newVaultGithub.createFailed"));
      return;
    }
    setCreating(false);
    setNewVaultName("");
    setOpen(false);
    router.push(`/vaults/${vault.id}`);
  }

  async function submitRename(vault: ApiVault) {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name || name === vault.name) return;
    try {
      await webApi.vaults.update(vault.id, { name });
      onVaultsChanged?.();
    } catch {
      setActionError(t("web.vaults.renameFailed"));
    }
  }

  async function deleteVault(vault: ApiVault) {
    if (armedDeleteId !== vault.id) {
      setArmedDeleteId(vault.id);
      return;
    }
    setArmedDeleteId(null);
    try {
      await webApi.vaults.remove(vault.id);
      onVaultsChanged?.();
      if (vault.id === activeVault?.id) router.push("/vaults");
    } catch {
      setActionError(t("web.vaults.deleteFailed"));
    }
  }

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      <button onClick={() => setOpen(!open)} className="vault-trigger">
        <span className="vault-name">{displayName}</span>
        <VaultChevronIcon className={`vault-chevron${open ? " vault-chevron-open" : ""}`} />
      </button>

      {open && (
        <div className="vault-dropdown">
          <div className="vault-dropdown-header">{t("web.vaults.title")}</div>

          <div className="vault-list">
            {vaults.map((vault) => {
              const isActive = vault.id === activeVault?.id;
              return (
                <div
                  key={vault.id}
                  className={`vault-item${isActive ? " vault-item-active" : ""}`}
                  onClick={() => {
                    if (renamingId === vault.id) return;
                    setOpen(false);
                    router.push(`/vaults/${vault.id}`);
                  }}
                >
                  <div className="vault-item-info">
                    {renamingId === vault.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => submitRename(vault)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename(vault);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="w-full text-sm px-1 py-0.5 rounded bg-[var(--bg-tertiary)] outline-none ring-1 ring-[var(--accent)]"
                      />
                    ) : (
                      <span className="vault-item-name">{vault.name}</span>
                    )}
                  </div>
                  <div className="vault-item-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="vault-action-btn"
                      title={t("web.vaults.rename")}
                      onClick={() => {
                        setRenameValue(vault.name);
                        setRenamingId(vault.id);
                      }}
                    >
                      <RenameIcon size={12} />
                    </button>
                    <button
                      className="vault-action-btn vault-delete"
                      title={armedDeleteId === vault.id ? t("web.vaults.confirmDelete") : t("web.vaults.delete")}
                      onClick={() => deleteVault(vault)}
                      onBlur={() => setArmedDeleteId((id) => (id === vault.id ? null : id))}
                      style={armedDeleteId === vault.id ? { color: "var(--red)", opacity: 1 } : undefined}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {actionError && <div className="px-3 py-1 text-xs text-[var(--red)]">{actionError}</div>}
          <div className="vault-dropdown-footer">
            {creating ? (
              <form onSubmit={submitCreateVault} className="flex gap-1">
                <input
                  autoFocus
                  value={newVaultName}
                  onChange={(e) => setNewVaultName(e.target.value)}
                  onBlur={() => { if (!newVaultName.trim()) setCreating(false); }}
                  onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
                  placeholder={t("web.vaults.newPlaceholder")}
                  className="w-full text-sm px-2 py-1 rounded-md bg-[var(--bg-tertiary)] outline-none ring-1 ring-[var(--accent)]"
                />
              </form>
            ) : (
              <>
                <button onClick={() => setCreating(true)} className="vault-create-btn">
                  <PlusIcon size={12} />
                  {t("web.vaults.new")}
                </button>
                {onNewFromGithub && (
                  <button
                    onClick={() => {
                      setOpen(false);
                      onNewFromGithub();
                    }}
                    className="vault-create-btn"
                  >
                    <PlusIcon size={12} />
                    {t("web.vaults.newFromGithub")}
                  </button>
                )}
                {onImportNewVault && (
                  <button
                    onClick={() => {
                      setOpen(false);
                      onImportNewVault();
                    }}
                    className="vault-create-btn"
                  >
                    <PlusIcon size={12} />
                    {t("web.vaults.importZip")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
