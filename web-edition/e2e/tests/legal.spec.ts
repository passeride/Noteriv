import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

// The legal pages and accepting the Terms again after they changed (web/src/components/TermsGate.tsx). One account,
// put back on an older Terms version by web/server/scripts/e2e-terms.ts, deleted at the end.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const email = `e2e-legal-${stamp}@example.test`;
// Throwaway password on the test database; never reused or printed.
const password = `E2e-${stamp}-${Math.random().toString(36).slice(2)}`;
const serverDir = path.resolve(__dirname, "..", "..", "web", "server");
const gateTitle = "We updated our Terms and Privacy Policy";

let context: BrowserContext;
let page: Page;

const resetTerms = () =>
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/e2e-terms.ts", email], {
    cwd: serverDir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

async function me(): Promise<{ termsAccepted?: boolean }> {
  const res = await page.request.get("/api/v1/auth/me");
  expect(res.ok()).toBe(true);
  return res.json();
}

/** Opens `url` and waits until the page has asked the server about the account (the gate decides from that answer). */
async function openApp(url: string) {
  const asked = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/me"));
  await page.goto(url);
  await asked;
}

/** The page asks /auth/me twice (the list and the gate): let both answers land before saying the gate stayed away. */
async function expectNoGate() {
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("dialog", { name: gateTitle })).toHaveCount(0);
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await page.goto("/register");
  await page.getByPlaceholder("Invite code").fill(process.env.E2E_INVITE_CODE!);
  await page.getByPlaceholder("Display name").fill("E2E Legal");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (at least 8 characters)").fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/vaults$/, { timeout: 60_000 });
});

test.afterAll(async () => {
  if (!process.env.E2E_KEEP_ACCOUNT) {
    // The last test signs out: sign in again to delete the account.
    await page.request.post("/api/v1/auth/login", { data: { email, password } }).catch(() => undefined);
    await page.request.delete("/api/v1/users/me", { data: { password } }).catch(() => undefined);
  }
  await context.close();
});

test("the legal pages have both languages, the legal bases and the service providers", async () => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "English", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tiếng Việt", exact: true })).toBeVisible();
  for (const heading of ["3. Why we use it (legal basis)", "4. How long we keep it", "5. Who handles data for us", "6. Transfers outside your country"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const text = await page.locator("main").innerText();
  for (const provider of ["Resend", "Sentry", "Cloudflare Turnstile", "GitHub", "Singapore"]) expect(text).toContain(provider);
  // Not used by the app, so not listed.
  expect(text).not.toContain("Plausible");

  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "7. Plans and payment" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "7. Gói và thanh toán" })).toBeVisible();
});

test("a new account has accepted the current terms and is not asked again", async () => {
  expect((await me()).termsAccepted).toBe(true);
  await openApp("/vaults");
  await expect(page.getByRole("button", { name: "Getting started" })).toBeVisible({ timeout: 30_000 });
  await expectNoGate();
});

test("after the terms change the app asks once, and accepting is remembered", async () => {
  resetTerms();
  expect((await me()).termsAccepted).toBe(false);

  await openApp("/vaults");
  const dialog = page.getByRole("dialog", { name: gateTitle });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
  await expect(dialog.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  await expect(dialog.getByRole("button", { name: "Download all my data (JSON)" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete account" })).toBeVisible();

  await dialog.getByRole("button", { name: "I accept" }).click();
  await expect(dialog).toHaveCount(0);
  expect((await me()).termsAccepted).toBe(true);

  await openApp("/vaults");
  await expect(page.getByRole("button", { name: "Getting started" })).toBeVisible({ timeout: 30_000 });
  await expectNoGate();
});

test("accepting a version the server does not have is refused", async () => {
  const stale = await page.request.post("/api/v1/users/me/terms", { data: { version: "1999-01-01" } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).error).toBe("terms_outdated");
  const empty = await page.request.post("/api/v1/users/me/terms", { data: {} });
  expect(empty.status()).toBe(400);
});

test("the data export carries the accepted terms version", async () => {
  const res = await page.request.get("/api/v1/users/me/export");
  expect(res.ok()).toBe(true);
  const data = (await res.json()) as { user: { termsVersion: string | null; termsAcceptedAt: string | null } };
  expect(data.user.termsVersion).toBeTruthy();
  expect(data.user.termsAcceptedAt).toBeTruthy();
});

test("the gate also covers Quick note, and signing out from it works", async () => {
  resetTerms();
  await openApp("/quick");
  const dialog = page.getByRole("dialog", { name: gateTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });
});
