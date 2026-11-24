"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { webApi } from "@/lib/webApi";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";

export default function HomePage() {
  useLocale();
  const router = useRouter();

  useEffect(() => {
    webApi.auth
      .me()
      .then(() => router.replace("/vaults"))
      .catch(() => router.replace("/login"));
  }, [router]);

  return (
    <div className="h-screen flex items-center justify-center text-[var(--text-secondary)]">
      {t("common.loadingShort")}
    </div>
  );
}
