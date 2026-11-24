import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The admin page (/admin), end to end with two accounts: an admin (made one by web/server/scripts/e2e-admin.ts) and
// an ordinary user. Both are deleted at the end. The API must run with EMAIL_PROVIDER=file for "Send reset link".

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const adminEmail = `e2e-admin-${stamp}@example.test`;
const userEmail = `e2e-member-${stamp}@example.test`;
// Throwaway passwords on the test database; never reused or printed.
const adminPassword = `E2e-${stamp}-${Math.random().toString(36).slice(2)}`;
const userPassword = `E2e-${stamp}-${Math.random().toString(36).slice(2)}-u`;
const outbox = process.env.E2E_EMAIL_OUTBOX ?? path.resolve(__dirname, "..", "..", "web", "server", ".email-outbox");

let adminContext: BrowserContext;
let admin: Page;
let userContext: BrowserContext;
let user: Page;

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

/** The user's row on /admin, found with the search box. */
async function userRow() {
  await admin.getByLabel("Search by email or name, then press Enter").fill(userEmail);
  await admin.getByLabel("Search by email or name, then press Enter").press("Enter");
  const row = admin.locator(`tr[data-user-email="${userEmail}"]`);
  await expect(row).toBeVisible();
  return row;
}

test.beforeAll(async ({ browser }) => {
  [adminContext, admin] = await signUp(browser, adminEmail, adminPassword, "E2E Admin");
  [userContext, user] = await signUp(browser, userEmail, userPassword, "E2E Member");
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/e2e-admin.ts", adminEmail], {
    cwd: path.resolve(__dirname, "..", "..", "web", "server"),
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
});

test.afterAll(async () => {
  if (!process.env.E2E_KEEP_ACCOUNT) {
    // The member may already be deleted by the last test; the admin deletes itself through the normal page API.
    await admin.request.delete("/api/v1/users/me", { data: { password: adminPassword } }).catch(() => undefined);
    await user.request.delete("/api/v1/users/me", { data: { password: userPassword } }).catch(() => undefined);
  }
  await adminContext.close();
  await userContext.close();
});

test("an ordinary user cannot open the admin page or its API", async () => {
  expect((await user.request.get("/api/v1/admin/users")).status()).toBe(403);
  await user.goto("/admin");
  await expect(user).toHaveURL(/\/vaults$/);
});

test("the admin finds the user, changes the plan and marks the email verified", async () => {
  await admin.goto("/vaults");
  await admin.getByRole("link", { name: "Administration (admin)" }).click();
  await expect(admin).toHaveURL(/\/admin$/);
  const row = await userRow();
  await expect(row.getByText("unverified", { exact: true })).toBeVisible();

  await row.getByLabel("Plan").selectOption("unlimited");
  await expect.poll(async () => (await (await user.request.get("/api/v1/users/me/plan")).json()).plan.id).toBe("unlimited");

  await row.getByRole("button", { name: "Mark verified" }).click();
  await expect(row.getByText("unverified", { exact: true })).toHaveCount(0);
});

test("locking signs the user out everywhere and stops sign-in; unlocking lets them back", async () => {
  const row = await userRow();
  await row.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(row.getByText("locked", { exact: true })).toBeVisible();

  // The session the user already had is refused at once, not when its token runs out.
  expect((await user.request.get("/api/v1/vaults")).status()).toBe(401);
  await user.goto("/login");
  await user.getByPlaceholder("Email").fill(userEmail);
  await user.getByPlaceholder("Password", { exact: true }).fill(userPassword);
  await user.getByRole("button", { name: "Sign in" }).click();
  await expect(user.getByText("This account is locked.", { exact: false })).toBeVisible();

  await row.getByRole("button", { name: "Unlock" }).click();
  await expect(row.getByText("locked", { exact: true })).toHaveCount(0);
  await user.getByRole("button", { name: "Sign in" }).click();
  await expect(user).toHaveURL(/\/vaults$/);
});

test("send a reset link, and give then take the admin role", async () => {
  const row = await userRow();
  await row.getByRole("button", { name: "Send reset link" }).click();
  await expect(admin.getByText("Password reset link sent.")).toBeVisible();
  await expect
    .poll(() => {
      try {
        return readdirSync(outbox)
          .map((f) => JSON.parse(readFileSync(path.join(outbox, f), "utf8")) as { to: string; subject: string })
          .filter((m) => m.to === userEmail && /Reset your Noteriv password/.test(m.subject)).length;
      } catch {
        return 0;
      }
    })
    .toBeGreaterThan(0);

  await row.getByRole("button", { name: "Make admin" }).click();
  await expect(row.getByText("admin", { exact: true })).toBeVisible();
  expect((await user.request.get("/api/v1/admin/users")).status()).toBe(200);
  await row.getByRole("button", { name: "Remove admin" }).click();
  await expect(row.getByText("admin", { exact: true })).toHaveCount(0);
  expect((await user.request.get("/api/v1/admin/users")).status()).toBe(403);
});

test("the admin cannot lock or demote themselves", async () => {
  const me = (await (await admin.request.get("/api/v1/auth/me")).json()) as { id: string };
  expect((await admin.request.patch(`/api/v1/admin/users/${me.id}`, { data: { locked: true } })).status()).toBe(400);
  expect((await admin.request.patch(`/api/v1/admin/users/${me.id}`, { data: { role: "user" } })).status()).toBe(400);
  await admin.getByLabel("Search by email or name, then press Enter").fill(adminEmail);
  await admin.getByLabel("Search by email or name, then press Enter").press("Enter");
  const own = admin.locator(`tr[data-user-email="${adminEmail}"]`);
  await expect(own.getByRole("button", { name: "Lock", exact: true })).toBeDisabled();
});

test("the audit log shows what the admin did", async () => {
  await admin.getByRole("link", { name: "Audit log" }).click();
  await admin.getByLabel("Action contains…").fill("admin_user_locked");
  await admin.getByRole("button", { name: "Filter" }).click();
  await expect(admin.locator("td", { hasText: "admin_user_locked" }).first()).toBeVisible();
  await expect(admin.locator("td", { hasText: adminEmail }).first()).toBeVisible();
});

test("deleting takes two clicks and removes the account", async () => {
  await admin.getByRole("link", { name: "Users", exact: true }).click();
  const row = await userRow();
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: "Click again to delete the account and all its data" }).click();
  await expect(admin.getByText("Account deleted.")).toBeVisible();
  await expect(admin.locator(`tr[data-user-email="${userEmail}"]`)).toHaveCount(0);
  expect((await user.request.get("/api/v1/vaults")).status()).toBe(401);
});
