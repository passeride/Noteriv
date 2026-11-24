// Sends one server-side error report through lib/sentry.ts, for e2e/tests/ops.spec.ts: the error text carries an
// email, a bearer token and a URL with credentials, which must all arrive scrubbed.
// Run: SENTRY_DSN=... npx tsx scripts/e2e-sentry.ts <probe-id>
// The api image has no scripts/ or tsx; to check a real DSN there, see docs/ops/giam-sat.md ("Sentry").

import { captureError, flushSentry, initSentry, sentryDsn } from "../src/lib/sentry.js";

const probe = process.argv[2]?.trim() || `probe-${Date.now()}`;
if (!sentryDsn()) {
  console.error("SENTRY_DSN is not set");
  process.exit(2);
}

initSentry("api");
captureError(
  new Error(`e2e-sentry-server ${probe}: alice@example.test Bearer abc.def https://u:tok@github.com/x/y.git`),
  { tags: { probe }, userId: "e2e-user-id" }
);
await flushSentry(5000);
console.log("sent");
