import { expect, test } from "@playwright/test";

// The installable app: manifest, icons, and the service worker that keeps the app shell available offline.
// No account needed: the sign-in page is enough to check the worker.

test.use({ serviceWorkers: "allow" });

test("the manifest describes an installable app with a Quick note shortcut", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Noteriv", display: "standalone", start_url: "/vaults" });
  expect(manifest.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  expect(manifest.shortcuts?.[0]?.url).toBe("/quick");
  for (const icon of [...manifest.icons, { src: "/icons/apple-touch-icon.png" }]) {
    const img = await request.get(icon.src);
    expect(img.ok(), icon.src).toBe(true);
    expect(img.headers()["content-type"]).toContain("image/png");
  }
  const sw = await request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toContain("no-store");
});

test("the service worker serves visited pages offline and a fallback page for the rest", async ({ page, context }) => {
  await page.goto("/login");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload(); // now controlled, so this load goes through the worker and is cached
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole("heading", { name: "Sign in to Noteriv" })).toBeVisible();

  // Offline for the page and the worker alike (the worker part needs PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS,
  // set in playwright.config.ts).
  await context.setOffline(true);
  try {
    await page.goto("/terms"); // never visited: the offline page
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await page.goto("/login"); // visited: served from the cache
    await expect(page.getByRole("heading", { name: "Sign in to Noteriv" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
