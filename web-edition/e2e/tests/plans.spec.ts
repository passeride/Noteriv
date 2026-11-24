import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

// Plans and limits (web/server/src/lib/plans.ts). The account is moved to a tiny test plan by
// web/server/scripts/e2e-plan.ts (2 vaults, 1000 bytes of attachments, no sync connections, email verified), so every
// limit can be reached in a few steps. One account, deleted at the end.

test.describe.configure({ mode: "serial" });

const stamp = Date.now();
const email = `e2e-plan-${stamp}@example.test`;
// Throwaway account on the test database; never reused or printed.
const password = `E2e-${stamp}-${Math.random().toString(36).slice(2)}`;

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  if (!process.env.E2E_KEEP_ACCOUNT) await page.request.delete("/api/v1/users/me", { data: { password } }).catch(() => undefined);
  await context.close();
});

function moveToTightPlan() {
  const serverDir = path.resolve(__dirname, "..", "..", "web", "server");
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "scripts/e2e-plan.ts", email], {
    cwd: serverDir,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
}

async function firstVaultId(): Promise<string> {
  const vaults = (await (await page.request.get("/api/v1/vaults")).json()) as { id: string }[];
  return vaults[0].id;
}

test("sign up, then move to the tiny test plan", async () => {
  await page.goto("/register");
  await page.getByPlaceholder("Invite code").fill(process.env.E2E_INVITE_CODE!);
  await page.getByPlaceholder("Display name").fill("E2E Plan");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (at least 8 characters)").fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/vaults$/, { timeout: 60_000 });
  moveToTightPlan();
});

test("a vault past the plan's limit is refused, with a way to ask for more", async () => {
  // Getting started is vault 1 of 2.
  await page.getByPlaceholder("New vault name").fill("Second");
  await page.getByPlaceholder("New vault name").press("Enter");
  await expect(page).toHaveURL(/\/vaults\/[0-9a-f-]{36}$/);

  await page.goto("/vaults");
  await page.getByPlaceholder("New vault name").fill("Third");
  await page.getByPlaceholder("New vault name").press("Enter");
  await expect(page.getByText("Your plan allows 2 vaults.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Need more room? Contact us" })).toHaveAttribute("href", /^mailto:/);
  await expect(page).toHaveURL(/\/vaults$/);
});

test("attachments past the account's storage and sync connections past the plan are refused", async () => {
  const vaultId = await firstVaultId();
  const upload = await page.request.post(`/api/v1/vaults/${vaultId}/attachments`, {
    multipart: { file: { name: "big.txt", mimeType: "text/plain", buffer: Buffer.alloc(2000, "x") } },
  });
  expect(upload.status()).toBe(403);
  expect(await upload.json()).toMatchObject({ error: "plan_limit", limit: "attachmentBytes", max: 1000 });

  const sync = await page.request.post(`/api/v1/vaults/${vaultId}/sync-connections`, {
    data: { providerType: "gitea", remoteUrl: "https://example.test/me/notes.git", token: "not-used" },
  });
  expect(sync.status()).toBe(403);
  expect(await sync.json()).toMatchObject({ error: "plan_limit", limit: "syncConnections", max: 0 });
});

test("Settings → Plan and usage shows the plan and what is used", async () => {
  await page.goto(`/vaults/${await firstVaultId()}`);
  await page.getByTitle("Settings (Ctrl+,)", { exact: true }).click();
  await page.getByText("Plan and usage", { exact: true }).first().click();
  await expect(page.getByText("E2E tight", { exact: true })).toBeVisible();
  await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(page.getByText("0 / 0", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Need more room? Contact us" })).toBeVisible();
});
