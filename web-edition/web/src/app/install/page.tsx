"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

/** Chrome's install prompt event (not in the DOM typings). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * How to put Noteriv on a phone's home screen. Chrome (Android, desktop) can install from a button here; iOS Safari
 * has no such API, so its steps are spelled out.
 */
export default function InstallPage() {
  useLocale();
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    setInstalled(standalone);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice.catch(() => undefined);
    setPrompt(null);
  }

  const section = "flex flex-col gap-2 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]";
  return (
    <div className="min-h-screen flex flex-col items-center px-4 pt-12 pb-12">
      <div className="w-full max-w-md flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t("web.install.title")}</h1>
        <p className="text-sm text-[var(--text-secondary)]">{t("web.install.intro")}</p>

        {installed && <p className="text-sm text-[var(--green)]">{t("web.install.already")}</p>}
        {prompt && !installed && (
          <button
            type="button"
            onClick={() => void install()}
            className="self-start px-5 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg-primary)] font-medium"
          >
            {t("web.install.button")}
          </button>
        )}

        <section className={section}>
          <h2 className="font-medium">{t("web.install.android.title")}</h2>
          <ol className="list-decimal pl-5 text-sm text-[var(--text-secondary)] flex flex-col gap-1">
            <li>{t("web.install.android.step1")}</li>
            <li>{t("web.install.android.step2")}</li>
            <li>{t("web.install.android.step3")}</li>
          </ol>
        </section>

        <section className={section}>
          <h2 className="font-medium">{t("web.install.ios.title")}</h2>
          <ol className="list-decimal pl-5 text-sm text-[var(--text-secondary)] flex flex-col gap-1">
            <li>{t("web.install.ios.step1")}</li>
            <li>{t("web.install.ios.step2")}</li>
            <li>{t("web.install.ios.step3")}</li>
          </ol>
        </section>

        <p className="text-sm text-[var(--text-secondary)]">{t("web.install.quick")}</p>
        <p className="text-sm text-[var(--text-muted)]">{t("web.install.offlineNote")}</p>

        <div className="flex gap-4 text-sm">
          <Link href="/vaults" className="text-[var(--accent)] hover:underline">
            {t("web.quick.allVaults")}
          </Link>
          <Link href="/quick" className="text-[var(--accent)] hover:underline">
            {t("web.quick.open")}
          </Link>
        </div>
      </div>
    </div>
  );
}
