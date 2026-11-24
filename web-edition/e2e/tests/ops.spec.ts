import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Operations: error reports (Sentry), the admin usage stats and the status page link. The API must run with
// SENTRY_DSN pointing at the stub in e2e/sentry-stub.mjs (http://e2e@127.0.0.1:4010/1), which writes every envelope
// it gets to E2E_SENTRY_OUTBOX (default web/server/.sentry-outbox). Two accounts, deleted at the end.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const adminEmail = `e2e-ops-admin-${stamp}@example.test`;
const userEmail = `e2e-ops-user-${stamp}@example.test`;
// Throwaway passwords on the test database; never reused or printed.
const adminPassword = `E2e-${stamp}-${Math.random().toString(36).slice(2)}`;
const userPassword = `E2e-${stamp}-${Math.random().toString(36).slice(2)}-u`;
const outbox = process.env.E2E_SENTRY_OUTBOX ?? path.resolve(__dirname, "..", "..", "web", "server", ".sentry-outbox");
const serverDir = path.resolve(__dirname, "..", "..", "web", "server");

let adminContext: BrowserContext;
let admin: Page;
let userContext: BrowserContext;
let user: Page;
let dsn: string;

async function signUp(browser: Browser, email: string, password: string, name: string): Promise<[BrowserContext, Page]> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/register");
  await page.getByPlaceholder("Invite code").fill(process.env.E2E_INVITE_CODE!);
  await page.getByPlaceholder("Display name").fill(name);
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (at least 8 characters)").fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/vaults$/, { timeout: 60_000 });
  return [context, page];
}

const run = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", args, {
    cwd: serverDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    env,
  });

/** Waits for the stub to have received an envelope containing `needle`, and returns it. */
async function envelopeWith(needle: string): Promise<string> {
  let found = "";
  await expect
    .poll(
      () => {
        if (!existsSync(outbox)) return false;
        for (const f of readdirSync(outbox)) {
          const body = readFileSync(path.join(outbox, f), "utf8");
          if (body.includes(needle)) {
            found = body;
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000 }
    )
    .toBe(true);
  return found;
}

/** Monday (UTC) of the current week, as the stats table keys its rows. */
function thisWeek(): string {
  const d = new Date();
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(day - ((new Date(day).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

test.beforeAll(async ({ browser }) => {
  [adminContext, admin] = await signUp(browser, adminEmail, adminPassword, "E2E Ops Admin");
  [userContext, user] = await signUp(browser, userEmail, userPassword, "E2E Ops User");
  run(["tsx", "scripts/e2e-admin.ts", adminEmail]);
});

test.afterAll(async () => {
  if (!process.env.E2E_KEEP_ACCOUNT) {
    await admin.request.delete("/api/v1/users/me", { data: { password: adminPassword } }).catch(() => undefined);
    await user.request.delete("/api/v1/users/me", { data: { password: userPassword } }).catch(() => undefined);
  }
  await adminContext.close();
  await userContext.close();
});

test("the public config turns error reporting on with the server's DSN", async () => {
  const res = await user.request.get("/api/v1/config");
  expect(res.ok()).toBe(true);
  const config = (await res.json()) as { errorReporting: { dsn: string } | null };
  expect(config.errorReporting, "start the API with SENTRY_DSN pointing at e2e/sentry-stub.mjs").not.toBeNull();
  dsn = config.errorReporting!.dsn;
});

test("an uncaught error in the page reaches Sentry through the tunnel, scrubbed", async () => {
  const me = (await (await user.request.get("/api/v1/auth/me")).json()) as { id: string };
  // The page names the account on its reports once it knows who is signed in (GET /auth/me).
  const meLoaded = user.waitForResponse((r) => r.url().endsWith("/api/v1/auth/me") && r.ok());
  await user.goto("/vaults");
  await meLoaded;
  await expect(user.getByRole("heading", { name: "Your vaults" })).toBeVisible();
  // The SDK loads after the page does; until it has, an error goes unseen, so throw again until one is sent.
  for (let attempt = 0; ; attempt++) {
    const tunnelled = user.waitForRequest((r) => r.url().endsWith("/api/v1/errors/browser") && r.method() === "POST", { timeout: 3000 });
    await user.evaluate(
      ([probe, email]) => {
        setTimeout(() => {
          throw new Error(`e2e-sentry-probe ${probe} for ${email}`);
        });
      },
      [String(stamp), userEmail]
    );
    const sent = await tunnelled.then(() => true).catch(() => false);
    if (sent) break;
    if (attempt >= 4) throw new Error("the page sent no error report");
  }
  const body = await envelopeWith(`e2e-sentry-probe ${stamp}`);
  expect(body).not.toContain(userEmail);
  expect(body).toContain("[email]");
  expect(body).toContain(`"id":"${me.id}"`);
});

test("the tunnel only forwards envelopes for the server's own DSN", async () => {
  const other = dsn.replace(/\/\d+$/, "/999");
  const envelope = (d: string) => `${JSON.stringify({ dsn: d })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify({ message: "x" })}\n`;
  const post = (data: string) => user.request.post("/api/v1/errors/browser", { data, headers: { "Content-Type": "text/plain;charset=UTF-8" } });
  expect((await post(envelope(other))).status()).toBe(400);
  expect((await post("not an envelope")).status()).toBe(400);
});

test("server-side reports are scrubbed of emails, tokens and URL credentials", async () => {
  const probe = `srv-${stamp}`;
  expect(run(["tsx", "scripts/e2e-sentry.ts", probe], { ...process.env, SENTRY_DSN: dsn })).toContain("sent");
  const body = await envelopeWith(`e2e-sentry-server ${probe}`);
  for (const secret of ["alice@example.test", "abc.def", "u:tok@"]) expect(body).not.toContain(secret);
  expect(body).toContain("Bearer [token]");
  expect(body).toContain("https://[credentials]@github.com");
  expect(body).toContain('"service":"api"');
});

test("the admin sees usage stats; an ordinary user cannot", async () => {
  expect((await user.request.get("/api/v1/admin/stats")).status()).toBe(403);
  await admin.goto("/admin");
  await admin.getByRole("link", { name: "Stats" }).click();
  await expect(admin).toHaveURL(/\/admin\/stats$/);
  await expect(admin.getByText("Accounts", { exact: true })).toBeVisible();
  const row = admin.locator(`tr[data-week="${thisWeek()}"]`);
  await expect(row).toBeVisible();
  // Both test accounts signed up and signed in this week.
  expect(Number(await row.locator('[data-col="signups"]').innerText())).toBeGreaterThanOrEqual(2);
  expect(Number(await row.locator('[data-col="active"]').innerText())).toBeGreaterThanOrEqual(2);
});

test("the sign-in page links the status page only when the server has one", async ({ browser }) => {
  const { statusPageUrl } = (await (await user.request.get("/api/v1/config")).json()) as { statusPageUrl: string | null };
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
  const link = page.getByRole("link", { name: "Status", exact: true });
  if (statusPageUrl) {
    await expect(link).toHaveAttribute("href", statusPageUrl);
  } else {
    await expect(link).toHaveCount(0);
  }
  await context.close();
});
