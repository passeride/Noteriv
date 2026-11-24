import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Account emails end to end: verify the sign-up address, reset a forgotten password, change the email. The API must
// run with EMAIL_PROVIDER=file; each email is then a JSON file in its outbox (E2E_EMAIL_OUTBOX, by default
// web/server/.email-outbox), and the tests follow the links in it like a user would. One account, deleted at the end.

test.describe.configure({ mode: "serial" });

const outbox = process.env.E2E_EMAIL_OUTBOX ?? path.resolve(__dirname, "..", "..", "web", "server", ".email-outbox");
const stamp = Date.now();
const firstEmail = `e2e-account-${stamp}@example.test`;
const secondEmail = `e2e-account-${stamp}-new@example.test`;
// Throwaway passwords on the test database; never reused or printed.
const firstPassword = `E2e-${stamp}-${Math.random().toString(36).slice(2)}`;
const secondPassword = `E2e-${stamp}-${Math.random().toString(36).slice(2)}-2`;

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  if (!process.env.E2E_KEEP_ACCOUNT) {
    await page.request.delete("/api/v1/users/me", { data: { password: secondPassword } })
      .catch(() => page.request.delete("/api/v1/users/me", { data: { password: firstPassword } }))
      .catch(() => undefined);
  }
  await context.close();
});

interface Mail {
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}

function mailsTo(to: string, subject: RegExp): Mail[] {
  let files: string[] = [];
  try {
    files = readdirSync(outbox).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => JSON.parse(readFileSync(path.join(outbox, f), "utf8")) as Mail)
    .filter((m) => m.to === to && subject.test(m.subject) && Date.parse(m.sentAt) >= stamp - 1000)
    .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
}

/** Waits for the newest email to `to` whose subject matches, and returns the path + token of its link. */
async function linkIn(to: string, subject: RegExp): Promise<{ href: string; token: string }> {
  await expect.poll(() => mailsTo(to, subject).length, { message: `email "${subject}" to ${to}`, timeout: 20_000 }).toBeGreaterThan(0);
  const mail = mailsTo(to, subject).pop()!;
  const url = new URL(mail.text.match(/https?:\/\/\S+#token=[\w-]+/)![0]);
  // Opened against the app under test, whatever origin the server writes into links.
  return { href: url.pathname + url.hash, token: new URLSearchParams(url.hash.slice(1)).get("token")! };
}

async function signIn(email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/vaults$/);
}

const apiLogin = (email: string, password: string) => page.request.post("/api/v1/auth/login", { data: { email, password } });

/** The account's first vault (Getting started), for the calls that need one. */
async function firstVaultId(): Promise<string> {
  const vaults = (await (await page.request.get("/api/v1/vaults")).json()) as { id: string }[];
  return vaults[0].id;
}

const sampleFile = { name: "e2e.txt", mimeType: "text/plain", buffer: Buffer.from("hello") };
const upload = (vaultId: string) => page.request.post(`/api/v1/vaults/${vaultId}/attachments`, { multipart: { file: sampleFile } });

const VERIFY_FIRST = "Verify your email first";
// Cloudflare's dummy Turnstile token, for API calls made without the page: passes when the server runs Turnstile's
// test keys, ignored when Turnstile is off.
const DUMMY_CAPTCHA = "XXXX.DUMMY.TOKEN.XXXX";

test("sign up: the account starts unverified and gets a verification email", async () => {
  const invite = process.env.E2E_INVITE_CODE;
  expect(invite, "global-setup seeds E2E_INVITE_CODE").toBeTruthy();
  await page.goto("/register");
  await page.getByPlaceholder("Invite code").fill(invite!);
  await page.getByPlaceholder("Display name").fill("E2E Account");
  await page.getByPlaceholder("Email").fill(firstEmail);
  await page.getByPlaceholder("Password (at least 8 characters)").fill(firstPassword);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/vaults$/, { timeout: 60_000 });
  await expect(page.getByText(`Signed in as ${firstEmail}`)).toBeVisible();
  await expect(page.getByText("Your email is not verified yet.", { exact: false })).toBeVisible();
});

test("an unverified account cannot upload, sync, clip or export a PDF until it verifies", async () => {
  const vaultId = await firstVaultId();
  const refused = async (res: Awaited<ReturnType<typeof upload>>) => {
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: "email_unverified" });
  };
  await refused(await upload(vaultId));
  await refused(await page.request.post(`/api/v1/vaults/${vaultId}/sync-connections`, { data: { providerType: "github", remoteUrl: "https://github.com/x/y.git" } }));
  await refused(await page.request.post(`/api/v1/vaults/${vaultId}/github/user`, { data: { token: "x" } }));
  await refused(await page.request.post("/api/v1/users/me/clip-tokens", { data: { name: "e2e", vaultId } }));
  await refused(await page.request.post(`/api/v1/vaults/${vaultId}/notes/${vaultId}/pdf`, { data: { html: "<p>x</p>" } }));

  // The page says why, in plain words.
  await page.goto(`/vaults/${vaultId}`);
  await page.getByTitle("More tools", { exact: true }).click();
  await page.getByText("Attachments", { exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles(sampleFile);
  await expect(page.getByText(VERIFY_FIRST, { exact: false })).toBeVisible();
  await page.goto("/vaults");
});

test("the verification link verifies the email, once", async () => {
  const { href, token } = await linkIn(firstEmail, /^Verify the email/);
  await page.goto(href);
  await expect(page.getByText("Your email is verified.", { exact: false })).toBeVisible();
  // The token left the address bar.
  expect(new URL(page.url()).hash).toBe("");

  const reused = await page.request.post("/api/v1/auth/verify-email", { data: { token } });
  expect(reused.status()).toBe(400);
  const madeUp = await page.request.post("/api/v1/auth/verify-email", { data: { token: "not-a-real-token" } });
  expect(madeUp.status()).toBe(400);

  await page.goto("/vaults");
  await expect(page.getByText(`Signed in as ${firstEmail}`)).toBeVisible();
  await expect(page.getByText("Your email is not verified yet.", { exact: false })).toHaveCount(0);

  // Verified, the same upload gets past the check (what storage then says depends on the server: CI has no S3).
  const after = await upload(await firstVaultId());
  expect(after.status()).not.toBe(403);
  expect(await after.text()).not.toContain("email_unverified");
});

test("the email is matched whatever its capitals", async () => {
  expect((await apiLogin(firstEmail.toUpperCase(), firstPassword)).status()).toBe(200);
  // Signing up again with the same address in other capitals is "email taken", not a second account.
  const again = await page.request.post("/api/v1/auth/register", {
    data: {
      email: `  ${firstEmail.toUpperCase()} `,
      password: firstPassword,
      displayName: "Dup",
      acceptTerms: true,
      inviteCode: process.env.E2E_INVITE_CODE,
      captchaToken: DUMMY_CAPTCHA,
    },
  });
  expect(again.status()).toBe(409);
});

test("forgot password answers the same whether or not the email has an account", async () => {
  const unknown = await page.request.post("/api/v1/auth/forgot-password", { data: { email: `nobody-${stamp}@example.test`, captchaToken: DUMMY_CAPTCHA } });
  expect(unknown.status()).toBe(200);
  expect(await unknown.json()).toEqual({ ok: true });
  // Nothing is sent for an address without an account.
  await page.waitForTimeout(1500);
  expect(mailsTo(`nobody-${stamp}@example.test`, /./)).toHaveLength(0);
});

test("reset a forgotten password from the sign-in page", async () => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByPlaceholder("Email").fill(firstEmail);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByText("If an account uses this email, a link is on its way.", { exact: false })).toBeVisible();

  const { href, token } = await linkIn(firstEmail, /^Reset your Noteriv password/);
  await page.goto(href);
  await page.getByPlaceholder("Password (at least 8 characters)").fill(secondPassword);
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByText("Your password was changed.", { exact: false })).toBeVisible();

  // The link works once; the old password no longer does, the new one does.
  expect((await page.request.post("/api/v1/auth/reset-password", { data: { token, password: firstPassword } })).status()).toBe(400);
  expect((await apiLogin(firstEmail, firstPassword)).status()).toBe(401);
  await signIn(firstEmail, secondPassword);
});

test("change the email: it changes only once the new address confirms it", async () => {
  await page.getByRole("button", { name: "Change email" }).click();
  await page.getByPlaceholder("New email").fill(secondEmail);
  await page.getByPlaceholder("Current password").fill("wrong-password");
  await page.getByRole("button", { name: "Send confirmation link" }).click();
  await expect(page.getByText("Wrong password.")).toBeVisible();

  await page.getByPlaceholder("Current password").fill(secondPassword);
  await page.getByRole("button", { name: "Send confirmation link" }).click();
  await expect(page.getByText(`We sent a link to ${secondEmail}.`, { exact: false })).toBeVisible();
  // Not changed yet.
  await page.reload();
  await expect(page.getByText(`Signed in as ${firstEmail}`)).toBeVisible();

  const { href } = await linkIn(secondEmail, /^Confirm the new email/);
  await page.goto(href);
  await expect(page.getByText("Your email was changed.", { exact: false })).toBeVisible();

  // The old address is told about it, and no longer signs in.
  await expect.poll(() => mailsTo(firstEmail, /email was changed/).length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect((await apiLogin(firstEmail, secondPassword)).status()).toBe(401);
  await signIn(secondEmail, secondPassword);
  await expect(page.getByText(`Signed in as ${secondEmail}`)).toBeVisible();
});
