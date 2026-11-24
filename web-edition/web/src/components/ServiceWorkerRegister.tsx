"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js (production builds only: in `next dev` a cached page would hide code changes). A new
 * version of the worker activates by itself and is used from the next page load on.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      /* not installable here (e.g. an insecure origin); the app works the same without it */
    });
  }, []);
  return null;
}

/** Drops the cached pages of the signed-in account (sign-out). */
export function clearCachedPages(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage("clear-pages");
}
