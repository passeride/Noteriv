// Browser error reports to Sentry, only when the server has a DSN (lib/public-config.ts); otherwise the SDK is never
// even downloaded. Reports go through our own API (tunnel /api/v1/errors/browser), which checks the DSN and scrubs
// them again. Here: no console or click breadcrumbs (they can hold note text), URLs without query or hash, emails
// and tokens replaced in messages, and the user as the account id only.

import type { BrowserOptions, ErrorEvent } from "@sentry/browser";
import { publicConfig } from "./public-config";

type SentryModule = typeof import("@sentry/browser");

let sentry: SentryModule | null = null;
let started: Promise<void> | null = null;

const stripUrl = (url: string) => url.split(/[?#]/)[0];

export function scrubText(text: string): string {
  // Credentials in URLs first: "user:token@host" would otherwise read as an email address.
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1[credentials]@")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [token]")
    .slice(0, 2000);
}

function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (event.request.url) event.request.url = stripUrl(event.request.url);
  }
  event.user = event.user?.id ? { id: String(event.user.id) } : undefined;
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
  }
  return event;
}

const beforeBreadcrumb: BrowserOptions["beforeBreadcrumb"] = (crumb) => {
  if (crumb.category === "console" || crumb.category?.startsWith("ui.")) return null;
  if (crumb.data) {
    for (const key of ["url", "from", "to"]) {
      if (typeof crumb.data[key] === "string") crumb.data[key] = stripUrl(crumb.data[key]);
    }
  }
  if (crumb.message) crumb.message = scrubText(crumb.message);
  return crumb;
};

/** Starts error reporting once per page load, if the server turned it on. */
export function initErrorReporting(): Promise<void> {
  started ??= publicConfig().then(async ({ errorReporting }) => {
    if (!errorReporting) return;
    const mod = await import("@sentry/browser");
    mod.init({
      dsn: errorReporting.dsn,
      environment: errorReporting.environment,
      release: errorReporting.release ?? undefined,
      tunnel: "/api/v1/errors/browser",
      sendDefaultPii: false,
      // Errors only: no sessions, no performance tracing, no replays.
      integrations: (defaults) => defaults.filter((i) => i.name !== "BrowserSession"),
      beforeBreadcrumb,
      beforeSend: scrubEvent,
    });
    sentry = mod;
  });
  return started;
}

/** Reports an error caught by an error boundary (uncaught ones are picked up by the SDK itself). */
export function reportError(err: unknown): void {
  void initErrorReporting().then(() => sentry?.captureException(err));
}

/** The signed-in account's id on later reports (never the email); null on sign-out. */
export function setReportingUser(id: string | null): void {
  void initErrorReporting().then(() => sentry?.setUser(id ? { id } : null));
}
