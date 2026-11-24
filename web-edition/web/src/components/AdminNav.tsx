"use client";

import Link from "next/link";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import TermsGate from "@/components/TermsGate";

const TABS = [
  { href: "/admin", key: "users" },
  { href: "/admin/invites", key: "invites" },
  { href: "/admin/audit", key: "audit" },
  { href: "/admin/stats", key: "stats" },
] as const;

/** Title, way back and tabs shared by the admin pages (users, invite codes, audit log, usage stats). */
export default function AdminNav({ active }: { active: (typeof TABS)[number]["key"] }) {
  useLocale();
  return (
    <div className="w-full max-w-5xl flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("web.admin.title")}</h1>
        <Link href="/vaults" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          {t("web.invites.back")}
        </Link>
      </div>
      <nav className="flex gap-5 border-b border-[var(--border)] text-sm">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active === tab.key ? "page" : undefined}
            className={`pb-2 -mb-px border-b-2 ${
              active === tab.key ? "border-[var(--accent)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t(`web.admin.tabs.${tab.key}`)}
          </Link>
        ))}
      </nav>
      <TermsGate />
    </div>
  );
}
