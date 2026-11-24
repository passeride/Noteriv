# End-to-end tests

Playwright drives the real web UI: sign-up with an invite code, vault, notes, rename, wiki-link and backlink, search, a core plugin, trash and restore. Each run creates one account and deletes it at the end.

Run these checks against a local web build, API and fresh Postgres/Redis instance.

## Running locally

1. Start local Postgres and Redis as described in the [web edition README](../README.md).
2. API: `cd web/server && REGISTRATION_MODE=invite EMAIL_PROVIDER=file SENTRY_DSN=http://e2e@127.0.0.1:4010/1 npx tsx src/index.ts` (port 4001), and the Sentry stand-in `node e2e/sentry-stub.mjs` (port 4010; `ops.spec.ts` reads what it receives). Optionally `STATUS_PAGE_URL=https://status.example.test/` to cover the status link.
3. Web: `cd web && npx next dev -p 3457`.
4. Once: `npx playwright install chromium`.
5. `npm run e2e` from `web-edition/`.

`e2e/global-setup.ts` seeds the invite code (`web/server/scripts/e2e-invite.ts`, needs `DATABASE_URL` from `web/server/.env`). Set `E2E_KEEP_ACCOUNT=1` to keep the test account for debugging, `E2E_BASE_URL` to test another address. **Never point these tests at production.**
