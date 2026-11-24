"use client";

import { useEffect, useState } from "react";
import { t } from "@noteriv/ui/i18n";
import { useLocale } from "@noteriv/ui/i18n/react";
import { publicConfig } from "@/lib/public-config";

/**
 * " · Status" for the footer link rows, pointing at the public status page (STATUS_PAGE_URL on the server). Renders
 * nothing until the server says there is one.
 */
export default function StatusLink({ label, separator = true }: { label?: string; separator?: boolean }) {
  useLocale();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void publicConfig().then((c) => setUrl(c.statusPageUrl));
  }, []);
  if (!url) return null;
  return (
    <>
      {separator && " · "}
      <a href={url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text-primary)]">
        {label ?? t("web.footer.status")}
      </a>
    </>
  );
}
