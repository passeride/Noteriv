import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Reading and editing without a network (stage 4, session 4.8): a vault opened before opens from what the device
// kept, edits wait on the device and are sent once the server is back. "Offline" here means every API request fails
// (context.route); the page itself still loads from the test server, so this checks the app's own offline store, not
// the service worker (pwa.spec.ts does that).

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const stamp = Date.now();
const password = `Off-${stamp}-${Math.random().toString(36).slice(2)}`;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.unroute("**/api/**").catch(() => undefined);
  await page.request.delete("/api/v1/users/me", { data: { password } }).catch(() => undefined);
  await context.close();
});

const sidebarItem = (name: string) => page.locator(".sidebar-root .sb-label").getByText(name, { exact: true }).first();
const editor = () => page.locator(".cm-content").first();
const goOffline = () => context.route("**/api/**", (route) => route.abort("internetdisconnected"));

test("open a vault and two notes while online", async () => {
  await page.goto("/register");
  await page.getByPlaceholder("Invite code").fill(process.env.E2E_INVITE_CODE!);
  await page.getByPlaceholder("Display name").fill("Offline Tester");
  await page.getByPlaceholder("Email").fill(`offline-${stamp}@example.test`);
  await page.getByPlaceholder("Password (at least 8 characters)").fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/vaults$/, { timeout: 60_000 });
  await page.getByRole("button", { name: /^Getting started/ }).click();
  await sidebarItem("Tags").click();
  await expect(editor()).toContainText("followed by a word anywhere in a note");
  await sidebarItem("Welcome").click();
  await expect(editor()).toContainText("Welcome to Noteriv");
  // The open tabs reach this device's store a moment after they change.
  await page.waitForTimeout(1500);
});

test("offline, the vault and the notes opened before still open", async () => {
  await goOffline();
  await page.reload();
  await expect(page.getByText(/^Offline — showing what this device kept/)).toBeVisible();
  await expect(sidebarItem("Welcome")).toBeVisible();
  await sidebarItem("Welcome").click();
  await expect(editor()).toContainText("Welcome to Noteriv");
  // A note never opened on this device needs the network.
  await sidebarItem("Plugins").click();
  await expect(page.getByText(/isn't kept on this device yet/)).toBeVisible();
});

test("an offline edit survives a reload and is sent when the network is back", async () => {
  await sidebarItem("Welcome").click();
  await editor().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" typed offline");
  await expect(page.getByText("Kept on this device", { exact: true })).toBeVisible();

  await page.reload();
  await sidebarItem("Welcome").click();
  await expect(editor()).toContainText("typed offline");

  await context.unroute("**/api/**");
  const sent = page.waitForResponse((r) => /\/notes\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH" && r.ok());
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await sent;
  await expect(page.getByText(/^Offline — showing/)).toHaveCount(0);

  const vaultId = new URL(page.url()).pathname.split("/")[2];
  const index = await (await page.request.get(`/api/v1/vaults/${vaultId}/index`)).json();
  const welcome = index.notes.find((n: { name: string }) => n.name === "Welcome.md");
  const note = await (await page.request.get(`/api/v1/vaults/${vaultId}/notes/${welcome.id}`)).json();
  expect(note.content).toContain("typed offline");
});

test("Quick note saves by itself once the network is back", async () => {
  await page.goto("/quick");
  await expect(page.getByLabel("Vault")).not.toHaveValue("");
  await context.route("**/api/**/quick-note", (route) => route.abort("internetdisconnected"));
  await page.getByLabel("Note text").fill("Written on the train");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await context.unroute("**/api/**/quick-note");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/Saved to Inbox\/Written on the train\.md/)).toBeVisible();
});
