// Error reports to Sentry (EU region) for the API, the sync worker and the collab server. Off unless SENTRY_DSN is
// set. Only errors, no tracing: the SDK's OpenTelemetry setup is skipped, so nothing is instrumented and the API
// reports what its own onError hook hands over (index.ts). Every event goes through scrubEvent first: no cookies,
// headers, bodies or query strings, the user as an id only, and emails, bearer tokens and credentials in URLs (git
// errors can carry a GitHub token in the remote URL) replaced in every text that leaves.

import * as Sentry from "@sentry/node";
import type { ErrorEvent } from "@sentry/node";

export type SentryService = "api" | "worker" | "collab";

const MAX_TEXT = 2000;
let enabled = false;

/** The DSN errors go to, or null when error reporting is off. */
export function sentryDsn(): string | null {
  return process.env.SENTRY_DSN?.trim() || null;
}

export const sentryEnvironment = (): string => process.env.SENTRY_ENVIRONMENT?.trim() || "production";
export const sentryRelease = (): string | undefined => {
  const r = process.env.SENTRY_RELEASE?.trim();
  return r && r !== "unknown" ? r : undefined;
};

/** Replaces personal data and secrets in a free text. Exported for the browser tunnel and the test script. */
export function scrubText(text: string): string {
  // Credentials in URLs first: "user:token@host" would otherwise read as an email address.
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1[credentials]@")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [token]")
    .slice(0, MAX_TEXT);
}

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
    if (event.request.url) event.request.url = event.request.url.split(/[?#]/)[0];
  }
  event.user = event.user?.id ? { id: String(event.user.id) } : undefined;
  if (event.message) event.message = scrubText(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubText(ex.value);
    // Source lines around each frame are our own code, but a literal in them can still hold text worth hiding;
    // local variables (off by default) could hold note content and never leave.
    for (const frame of ex.stacktrace?.frames ?? []) {
      delete frame.vars;
      if (frame.context_line) frame.context_line = scrubText(frame.context_line);
      frame.pre_context = frame.pre_context?.map(scrubText);
      frame.post_context = frame.post_context?.map(scrubText);
    }
  }
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = scrubText(b.message);
    delete b.data;
  }
  delete event.extra;
  return event;
}

export function initSentry(service: SentryService): void {
  const dsn = sentryDsn();
  if (!dsn || enabled) return;
  Sentry.init({
    dsn,
    environment: sentryEnvironment(),
    release: sentryRelease(),
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
    initialScope: { tags: { service } },
    beforeSend: scrubEvent,
    beforeBreadcrumb: (b) => (b.category === "console" ? null : b),
  });
  enabled = true;
}

/** Sends one error (when reporting is on). `userId` is the opaque account id, never the email. */
export function captureError(err: unknown, opts: { tags?: Record<string, string>; userId?: string } = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (opts.tags) scope.setTags(opts.tags);
    if (opts.userId) scope.setUser({ id: opts.userId });
    Sentry.captureException(err);
  });
}

/** Waits (up to `timeoutMs`) until queued events are sent; used before a process exits. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
