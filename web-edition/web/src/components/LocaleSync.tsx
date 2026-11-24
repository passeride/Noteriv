"use client";

import { useEffect } from "react";
import { applyStoredLanguage } from "@/lib/i18n";

/** Switches to this device's language once the page is mounted (the server rendered English). */
export default function LocaleSync() {
  useEffect(() => {
    applyStoredLanguage();
  }, []);
  return null;
}
