/**
 * The token of an emailed link (`/reset-password#token=…`, `/verify-email#token=…`). It travels after "#" so it never
 * reaches a server log, a Referer header or the service worker's page cache (see web/server/src/lib/accountEmails.ts).
 */
export function readLinkToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  return token && token.length <= 200 ? token : null;
}

/** Takes the token out of the address bar, so it is not left in history or copied along with the address. */
export function forgetLinkToken(): void {
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
}
