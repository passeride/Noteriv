"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, webApi, type ApiVault } from "@/lib/webApi";
import { isNetworkError } from "@/lib/offline";
import { formatDate, t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import TermsGate from "@/components/TermsGate";

// Quick note: a page that opens fast on a phone (no editor, no vault page) — type, save, done. The text is kept on
// the device while typing, so nothing is lost when the network drops or the save fails; it is cleared once saved.

const DRAFT_KEY = "noteriv.quick.draft";
const VAULT_KEY = "noteriv.quick.vault";
const FOLDER_KEY = "noteriv.quick.folder";
const DEFAULT_FOLDER = "Inbox";

function load(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function store(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode: the draft just isn't kept */
  }
}

/** "Quick note 2026-10-18 1530", in the interface language. */
function fallbackName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return t("web.quick.fallbackName", {
    stamp: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`,
  });
}

export default function QuickNotePage() {
  useLocale();
  const router = useRouter();
  const [vaults, setVaults] = useState<ApiVault[] | null>(null);
  const [vaultId, setVaultId] = useState("");
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ path: string; vaultId: string; at: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The last save found no network: it is tried again as soon as the browser is back online. */
  const [waitingForNetwork, setWaitingForNetwork] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText(load(DRAFT_KEY));
    setFolder(load(FOLDER_KEY) || DEFAULT_FOLDER);
    area.current?.focus();
    webApi.vaults
      .list()
      .then((list) => {
        setVaults(list);
        const remembered = load(VAULT_KEY);
        setVaultId(list.some((v) => v.id === remembered) ? remembered : (list[0]?.id ?? ""));
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login?next=/quick");
        else {
          setVaults([]);
          setError(t("web.quick.offline"));
        }
      });
  }, [router]);

  // Saved by itself once the network is back (the text never left this device meanwhile).
  const saveRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!waitingForNetwork) return;
    const onOnline = () => void saveRef.current();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [waitingForNetwork]);

  function edit(value: string) {
    setText(value);
    store(DRAFT_KEY, value);
    if (saved) setSaved(null);
  }

  async function save() {
    if (!text.trim() || !vaultId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const note = await webApi.notes.quick(vaultId, { content: text, folder: folder.trim() || DEFAULT_FOLDER, fallbackName: fallbackName() });
      store(VAULT_KEY, vaultId);
      store(FOLDER_KEY, folder.trim() === DEFAULT_FOLDER ? "" : folder.trim());
      edit("");
      // After edit(""), which clears the previous confirmation.
      setSaved({ path: note.path, vaultId, at: Date.now() });
      area.current?.focus();
      setWaitingForNetwork(false);
    } catch (err) {
      const offline = isNetworkError(err);
      setWaitingForNetwork(offline);
      setError(offline ? t("web.quick.offline") : t("web.quick.failed"));
    } finally {
      setSaving(false);
    }
  }

  saveRef.current = save;

  return (
    <div className="min-h-screen flex flex-col items-center px-4 pt-6 pb-10">
      <TermsGate />
      <div className="w-full max-w-xl flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{t("web.quick.title")}</h1>
          <Link href="/vaults" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            {t("web.quick.allVaults")}
          </Link>
        </div>

        <div className="flex gap-2">
          <select
            aria-label={t("web.quick.vault")}
            value={vaultId}
            onChange={(e) => setVaultId(e.target.value)}
            disabled={!vaults?.length}
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
          >
            {vaults === null && <option value="">{t("web.vaultList.loading")}</option>}
            {vaults?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <input
            aria-label={t("web.quick.folder")}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={DEFAULT_FOLDER}
            className="w-32 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>

        <textarea
          ref={area}
          aria-label={t("web.quick.text")}
          value={text}
          onChange={(e) => edit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder={t("web.quick.placeholder")}
          rows={10}
          className="w-full px-3 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] outline-none focus:ring-1 focus:ring-[var(--accent)] resize-y"
          style={{ fontSize: 16 /* 16px or iOS zooms in on focus */, minHeight: "40vh" }}
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm min-w-0" aria-live="polite">
            {error && <span className="text-[var(--red)]">{error}</span>}
            {!error && saved && (
              <span className="text-[var(--green)]">
                {t("web.quick.saved", { path: saved.path, time: formatDate(saved.at, { hour: "2-digit", minute: "2-digit" }) })}{" "}
                <Link href={`/vaults/${saved.vaultId}`} className="text-[var(--accent)] hover:underline">
                  {t("web.quick.openVault")}
                </Link>
              </span>
            )}
            {!error && !saved && vaults?.length === 0 && <span className="text-[var(--text-muted)]">{t("web.quick.noVault")}</span>}
          </p>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !text.trim() || !vaultId}
            className="shrink-0 px-5 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] font-medium disabled:opacity-50"
          >
            {saving ? t("web.quick.saving") : t("web.quick.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
