"use client";

import { useEffect } from "react";

/**
 * Closes a dialog or panel on Escape. Ignored while `enabled` is false (e.g. a nested viewer or confirm step is
 * open and handles Escape itself) and while focus is in a text field, where Escape belongs to the field (cancelling a
 * rename, leaving a code editor).
 */
export function useEscapeClose(onClose: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, enabled]);
}
