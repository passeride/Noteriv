import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// The main path a new user takes, end to end through the real UI: sign up with an invite code,
// create a vault, write and link notes, rename, search, switch a core plugin on, delete a note
// and restore it from the trash. One account per run, deleted at the end.

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
const stamp = Date.now();
const email = `e2e-${stamp}@example.test`;
// Throwaway account on the test database; never reused or printed.
const password = `E2e-${stamp}-${Math.random().toString(36).slice(2)}`;

test.beforeAll(async ({ browser }) => {
  // One context for the whole run, so a second tab (same session) can be opened.
  context = await browser.newContext();
  page = await context.newPage();
});

test.afterAll(async () => {
  // Remove the account and everything it owns, whatever happened above (E2E_KEEP_ACCOUNT=1 keeps it to debug).
  if (!process.env.E2E_KEEP_ACCOUNT) await page.request.delete("/api/v1/users/me", { data: { password } }).catch(() => undefined);
  await context.close();
});

const sidebarItem = (name: string) => page.locator(".sidebar-root .sb-label").getByText(name, { exact: true }).first();
const editor = () => page.locator(".cm-content").first();

/** Waits until the page has saved a note whose content contains `text`. */
const noteSaved = (text: string) =>
  page.waitForResponse(
    (r) =>
      /\/api\/v1\/vaults\/[^/]+\/notes\/[^/]+$/.test(r.url()) &&
      ["PATCH", "PUT"].includes(r.request().method()) &&
      (r.request().postData() ?? "").includes(text) &&
      r.ok()
  );

async function renameViaContextMenu(from: string, to: string) {
  await sidebarItem(from).click({ button: "right" });
  await page.getByText("Rename", { exact: true }).click();
  const input = page.locator(".sidebar-root input.sb-rename").first();
  await input.fill(to);
  await input.press("Enter");
  await expect(sidebarItem(to)).toBeVisible();
}

test("sign up with an invite code", async () => {
  const invite = process.env.E2E_INVITE_CODE;
  expect(invite, "global-setup seeds E2E_INVITE_CODE").toBeTruthy();
  await page.goto("/register");
  await page.getByPlaceholder("Invite code").fill(invite!);
  await page.getByPlaceholder("Display name").fill("E2E Tester");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password (at least 8 characters)").fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Sign up" }).click();
  // Sign-up also writes the Getting started vault before moving on, which takes a few requests more: well under a
  // second next to the database (CI, production), up to ~40 s through the SSH tunnel to the dev database.
  await expect(page).toHaveURL(/\/vaults$/, { timeout: 60_000 });
});

test("a new account starts with the Getting started vault, its notes linked", async () => {
  await page.getByRole("button", { name: /^Getting started/ }).click();
  await expect(page).toHaveURL(/\/vaults\/[0-9a-f-]{36}$/);
  await expect(sidebarItem("Links and backlinks")).toBeVisible();
  await sidebarItem("Welcome").click();
  await page.getByTitle("Backlinks", { exact: true }).click();
  // The links between sample notes resolve: every other note links back to Welcome.
  await expect(page.locator(".bl-panel .bl-list")).toContainText("Links and backlinks");
  await page.getByTitle("Backlinks", { exact: true }).click();
  await page.goto("/vaults");
});

test("create a vault and open it", async () => {
  await page.getByPlaceholder("New vault name").fill("E2E vault");
  await page.getByPlaceholder("New vault name").press("Enter");
  // A new vault opens straight away.
  await expect(page).toHaveURL(/\/vaults\/[0-9a-f-]{36}$/);
  await expect(page.getByTitle("New note", { exact: true })).toBeVisible();
});

/** A new note starts in rename mode: type its name right away. */
async function nameNewNote(name: string) {
  const input = page.locator(".sidebar-root input.sb-rename").first();
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press("Enter");
  await expect(sidebarItem(name)).toBeVisible();
}

test("write two linked notes, rename them, see the backlink", async () => {
  await page.getByTitle("New note", { exact: true }).click();
  await expect(editor()).toBeVisible();
  await nameNewNote("Draft");
  await renameViaContextMenu("Draft", "First");

  await page.getByTitle("New file", { exact: true }).click(); // the sidebar's own "+" button
  await nameNewNote("Second");
  await editor().click();
  const secondSaved = noteSaved("The second note");
  await page.keyboard.type("# Second\n\nThe second note.");
  await secondSaved;

  await sidebarItem("First").click();
  await editor().click();
  const firstSaved = noteSaved("Hello e2e world");
  // The editor closes brackets itself, so typing "[[Second" yields "[[Second]]".
  await page.keyboard.type("# First\n\nHello e2e world, see [[Second");
  await page.keyboard.press("Escape"); // dismiss the link suggestions
  await firstSaved;

  await sidebarItem("Second").click();
  await page.getByTitle("Backlinks", { exact: true }).click();
  await expect(page.locator(".bl-panel .bl-list")).toContainText("First");
});

test("clicking a wiki-link opens the note, or creates it when it does not exist yet", async () => {
  await sidebarItem("First").click();
  await editor().click();
  await page.keyboard.press("Control+Home"); // off the link's line, so the link renders
  await page.locator(".cm-content .md-wikilink", { hasText: "Second" }).first().click();
  await expect(page.locator(".tab-active")).toContainText("Second");
  await expect(editor()).toContainText("The second note");

  await editor().click();
  await page.keyboard.press("Control+End");
  const saved = noteSaved("[[Third idea]]");
  await page.keyboard.type("\n\nSee [[Third idea");
  await page.keyboard.press("Escape");
  await saved;
  await page.keyboard.press("Control+Home");
  await page.locator(".cm-content .md-wikilink", { hasText: "Third idea" }).first().click();
  await expect(sidebarItem("Third idea")).toBeVisible();
  await expect(page.locator(".tab-active")).toContainText("Third idea");
});

test("renaming a note rewrites the links that point to it", async () => {
  // "Second" (open in a tab, saved) links to [[Third idea]].
  const rewritten = noteSaved("[[Third thought]]");
  await renameViaContextMenu("Third idea", "Third thought");
  await rewritten;
  await expect(page.getByText("Updated links in 1 note")).toBeVisible();
  await sidebarItem("Second").click();
  await expect(editor()).toContainText("Third thought");
  await expect(editor()).not.toContainText("Third idea");
  // The link still resolves: Third thought lists Second as a backlink (the panel may still be open from above).
  await sidebarItem("Third thought").click();
  const backlinks = page.locator(".bl-panel .bl-list");
  if (!(await page.locator(".bl-panel").isVisible())) await page.getByTitle("Backlinks", { exact: true }).click();
  await expect(backlinks).toContainText("Second");
});

test("unlinked mentions can be turned into links; Outgoing links lists what a note links to", async () => {
  // "Third thought" names "Second" without a link.
  await sidebarItem("Third thought").click();
  await editor().click();
  await page.keyboard.press("Control+End");
  const typed = noteSaved("Back to second.");
  await page.keyboard.type("\n\nBack to second.");
  await typed;

  await sidebarItem("Second").click();
  if (!(await page.locator(".bl-panel").isVisible())) await page.getByTitle("Backlinks", { exact: true }).click();
  const unlinked = page.locator(".bl-unlinked");
  await expect(unlinked).toContainText("Third thought");
  // The mention is in a note open in a tab: it is changed there and saved by the tab itself.
  const linked = noteSaved("Back to [[second]].");
  await unlinked.locator(".bl-link-btn").first().click();
  await linked;
  await expect(unlinked).toContainText("No other note names this one without a link.");

  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("Outgoing links");
  await page.keyboard.press("Enter");
  await expect(page.locator(".ol-panel")).toContainText("Third thought");
  await page.locator(".ol-panel .bl-close").click();
});

test("embedding a note shows its content; the embed's title opens it", async () => {
  await sidebarItem("Third thought").click();
  await editor().click();
  await page.keyboard.press("Control+End");
  const saved = noteSaved("![[Second#Second]]");
  await page.keyboard.type("\n\n![[Second#Second");
  await page.keyboard.press("Escape");
  await saved;
  await page.keyboard.press("Control+Home"); // off the embed's line, so it renders
  const embed = page.locator(".cm-content .md-note-embed").first();
  await expect(embed).toContainText("The second note.");
  await expect(embed.locator(".md-note-embed-title")).toHaveText("Second › Second");
  await embed.locator(".md-note-embed-title").click();
  await expect(page.locator(".tab-active")).toContainText("Second");
});

test("a ```view block shows notes by their properties, and a cell edits the note", async () => {
  // Second gets a status; First holds the view.
  await sidebarItem("Second").click();
  const props = page.locator(".fm-editor").first();
  const created = noteSaved("tags: []");
  await props.getByRole("button", { name: "Add properties" }).click();
  await created;
  if (!(await props.locator(".fm-body").isVisible())) await props.locator(".fm-header").click();
  await props.getByRole("button", { name: "Add property" }).click();
  await page.getByPlaceholder("Property name...").fill("status");
  await page.getByPlaceholder("Property name...").press("Enter");
  const statusSaved = noteSaved("status: active");
  const status = props.locator(".fm-property", { has: page.locator(".fm-property-key", { hasText: "status" }) }).locator("input.fm-property-input");
  await status.fill("active");
  await status.press("Enter");
  await statusSaved;

  await page.keyboard.press("Control+Comma");
  await page.getByText("Core plugins", { exact: true }).click();
  const toggle = page.locator('[data-core-plugin="views"]').getByRole("switch");
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await sidebarItem("First").click();
  await editor().click();
  await page.keyboard.press("Control+End");
  const viewSaved = noteSaved("where: status exists");
  // insertText: typed backticks would be paired by the editor.
  await page.keyboard.insertText("\n\n```view\nwhere: status exists\ncolumns: [file, status]\n```\n");
  await viewSaved;
  await page.keyboard.press("Control+Home"); // off the block, so it renders
  const view = page.locator(".cm-content .nv-view").first();
  await expect(view.locator("tbody tr")).toHaveCount(1);
  await expect(view).toContainText("Second");
  await expect(view).toContainText("active");

  const edited = noteSaved("status: done");
  await view.locator(".nv-editable").first().click();
  await view.locator(".nv-input").fill("done");
  await view.locator(".nv-input").press("Enter");
  await edited;
  await expect(view).toContainText("done");
});

test("New view creates a view file that shows notes; its layout buttons rewrite the file", async () => {
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("New view");
  await page.keyboard.press("Enter");
  const file = page.locator(".nv-file");
  await expect(file.locator(".nv-view tbody tr").first()).toBeVisible();
  await expect(file.locator(".nv-view")).toContainText("Second");
  await expect(file.locator(".nv-layout.nv-active")).toHaveText("Table");

  const saved = noteSaved("layout: cards");
  await file.getByRole("button", { name: "Cards" }).click();
  await saved;
  await expect(file.locator(".nv-card").first()).toBeVisible();
  await expect(file.locator(".nv-layout.nv-active")).toHaveText("Cards");
});

test("typing / opens the command menu; picking an item formats the line", async () => {
  await sidebarItem("Third thought").click();
  await editor().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n/h2");
  const menu = page.locator(".cm-tooltip-autocomplete");
  await expect(menu).toContainText("Heading 2");
  // CodeMirror ignores Enter for 75 ms after a menu first opens (so a key meant for the line is not taken).
  await page.waitForTimeout(100);
  const saved = noteSaved("## Slash heading");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Slash heading");
  await saved;
  await expect(menu).toBeHidden();
});

test("the local graph shows the open note's links, and All notes the whole vault", async () => {
  await sidebarItem("Second").click();
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("Open local graph");
  await page.keyboard.press("Enter");
  const graph = page.locator(".graph-container");
  await expect(graph.locator(".graph-scope-btn.active")).toHaveText("This note");
  const notes = graph.locator(".graph-stat-value").first();
  await expect(notes).not.toHaveText("0");
  const local = Number(await notes.textContent());
  await graph.getByRole("button", { name: "All notes" }).click();
  await expect.poll(async () => Number(await notes.textContent())).toBeGreaterThan(local);
  await graph.locator(".graph-close-btn").click();
  await expect(graph).toBeHidden();
});

test("resting on a link previews the note it names", async () => {
  await sidebarItem("Third thought").click();
  await page.keyboard.press("Control+Home");
  const link = page.locator(".cm-content .md-wikilink", { hasText: "second" }).first();
  await link.hover();
  const preview = page.locator(".hp-container");
  await expect(preview).toContainText("The second note.");
  // Leaving the link closes it.
  await page.mouse.move(0, 0);
  await expect(preview).toBeHidden();
});

test("Footnotes lists the open note's footnotes; Unique note creator makes a note named by the time", async () => {
  await page.keyboard.press("Control+Comma");
  await page.getByText("Core plugins", { exact: true }).click();
  for (const id of ["footnotes", "unique-note"]) {
    const toggle = page.locator(`[data-core-plugin="${id}"]`).getByRole("switch");
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }
  await page.keyboard.press("Escape");

  await sidebarItem("Third thought").click();
  await editor().click();
  await page.keyboard.press("Control+End");
  const saved = noteSaved("[^1]: A footnote for e2e");
  await page.keyboard.insertText("\nWith a note[^1].\n\n[^1]: A footnote for e2e\n");
  await saved;
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("Toggle Footnotes panel");
  await page.keyboard.press("Enter");
  const panel = page.locator(".fn-panel");
  await expect(panel).toContainText("A footnote for e2e");
  await expect(panel.locator(".fn-count")).toHaveText("1 footnote");

  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("Create unique note");
  await page.keyboard.press("Enter");
  await expect(page.locator(".tab-active")).toContainText(/\d{12}/);
});

test("Import from another app brings in a Notion export and an Evernote notebook", async () => {
  const JSZip = (await import("jszip")).default;
  const id1 = "0123456789abcdef0123456789abcdef";
  const id2 = "fedcba9876543210fedcba9876543210";
  const zip = new JSZip();
  zip.file(`Export/Wiki home ${id1}.md`, `# Wiki home\n\nSee [Roadmap](Wiki%20home%20${id1}/Roadmap%20${id2}.md) for e2e.\n`);
  zip.file(`Export/Wiki home ${id1}/Roadmap ${id2}.md`, "# Roadmap\n\nQ4 e2e plans.\n");
  const notion = await zip.generateAsync({ type: "nodebuffer" });

  const openDialog = async () => {
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("Import from Notion");
    await page.keyboard.press("Enter");
    await expect(page.locator(".aimp-dialog")).toBeVisible();
  };
  await openDialog();
  const dialog = page.locator(".aimp-dialog");
  await dialog.locator("[data-testid=aimp-file]").setInputFiles({ name: "Export.zip", mimeType: "application/zip", buffer: notion });
  await expect(dialog.locator(".aimp-summary")).toContainText("Found 2 notes");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog).toContainText("Imported 2 items.");
  await dialog.getByRole("button", { name: "Open the first note" }).click();
  await expect(page.locator(".tab-active")).toContainText("Wiki home");
  await expect(editor()).toContainText("for e2e");
  await expect(page.locator(".cm-content .md-wikilink", { hasText: "Roadmap" })).toBeVisible();

  const enex = `<?xml version="1.0" encoding="UTF-8"?><en-export><note><title>Evernote e2e</title><created>20261001T083000Z</created><tag>imported</tag><content><![CDATA[<en-note><div>From <b>Evernote</b></div></en-note>]]></content></note></en-export>`;
  await openDialog();
  await dialog.locator(".aimp-source", { hasText: "Evernote" }).click();
  await dialog.locator("[data-testid=aimp-file]").setInputFiles({ name: "Book.enex", mimeType: "application/xml", buffer: Buffer.from(enex) });
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await dialog.getByRole("button", { name: "Open the first note" }).click();
  await expect(page.locator(".tab-active")).toContainText("Evernote e2e");
  await expect(editor()).toContainText("From Evernote");
});

test("single .md files are imported into the folder chosen in the sidebar, their links working", async () => {
  // A folder to import into, made from the sidebar like a person would: right-click the empty
  // space below the file list.
  const list = page.locator(".sidebar-root .overflow-y-auto.py-1").first();
  const box = await list.boundingBox();
  await list.click({ button: "right", position: { x: 40, y: box!.height - 10 } });
  await page.getByText("New Folder", { exact: true }).click();
  const rename = page.locator(".sidebar-root input.sb-rename").first();
  await expect(rename).toBeFocused();
  await rename.fill("Picked e2e");
  await rename.press("Enter");
  await expect(sidebarItem("Picked e2e")).toBeVisible();

  await sidebarItem("Picked e2e").click({ button: "right" });
  await page.getByText("Import .md files here…", { exact: true }).click();
  await expect(page.locator("[data-testid=import-folder]")).toHaveValue("Picked e2e");
  await page.locator("[data-testid=import-files]").setInputFiles([
    { name: "Single one.md", mimeType: "text/markdown", buffer: Buffer.from("# Single one\n\nPoints to [[Single two]].\n") },
    { name: "Single two.md", mimeType: "text/markdown", buffer: Buffer.from("# Single two\n\nPicked file e2e.\n") },
  ]);
  await expect(page.getByText("2 notes · 0 attachments")).toBeVisible();
  await page.getByRole("button", { name: "Start import" }).click();
  await expect(page.getByText("Import finished")).toBeVisible();
  await page.getByRole("button", { name: "Open the vault" }).click();

  await sidebarItem("Picked e2e").click(); // expands the folder
  await sidebarItem("Single one").click();
  await expect(page.locator(".tab-active")).toContainText("Single one");
  await page.locator(".cm-content .md-wikilink", { hasText: "Single two" }).click();
  await expect(editor()).toContainText("Picked file e2e.");
});

test("typed properties: a number property is set and listed in All properties", async () => {
  await sidebarItem("Third thought").click();
  const props = page.locator(".fm-editor").first();
  const created = noteSaved("tags: []");
  await props.getByRole("button", { name: "Add properties" }).click();
  await created;
  if (!(await props.locator(".fm-body").isVisible())) await props.locator(".fm-header").click();
  await props.getByRole("button", { name: "Add property" }).click();
  await page.getByPlaceholder("Property name...").fill("rating");
  await page.getByPlaceholder("Property name...").press("Enter");
  const row = props.locator(".fm-property", { has: page.locator(".fm-property-key", { hasText: "rating" }) });
  await row.locator(".fm-type-select").selectOption("number");
  await expect(row).toHaveAttribute("data-type", "number");
  const saved = noteSaved("rating: 5");
  await row.locator("input.fm-property-input").fill("5");
  await row.locator("input.fm-property-input").press("Enter");
  await saved;

  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("All properties");
  await page.keyboard.press("Enter");
  const view = page.locator(".pv-panel");
  await expect(view).toContainText("rating");
  await expect(view.locator(".pv-row", { hasText: "rating" }).locator(".fm-type-select")).toHaveValue("number");
  await view.locator(".bl-close").click();
});

test("search finds the matching line as you type and opens the note there", async () => {
  await sidebarItem("Second").click();
  await page.getByTitle("Search in vault").click();
  const box = page.getByPlaceholder("Search across all notes…");
  await box.fill("e2e world"); // no Enter needed to search
  const result = page.getByRole("option").filter({ hasText: "First" });
  await expect(result).toContainText("Hello e2e world");
  await expect(result).toContainText(":3"); // the line it is on
  await box.press("Enter");
  await expect(box).toHaveCount(0);
  await expect(page.locator(".cm-content").first()).toContainText("Hello e2e world");
  // The cursor is at the start of that line: a typed character lands there.
  await page.keyboard.type("Z");
  await expect(page.locator(".cm-content").first()).toContainText("ZHello e2e world");
  await page.keyboard.press("Backspace");
  await expect(page.locator(".cm-content").first()).not.toContainText("ZHello");
});

test("search operators narrow results, and replace changes the text in every matching note", async () => {
  await page.getByTitle("Search in vault").click();
  const box = page.getByPlaceholder("Search across all notes…");
  await box.fill('"e2e world" file:first');
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option").first()).toContainText("First");

  // Replace there and back (later tests read the original words).
  const replaceAll = async (from: string, to: string) => {
    await box.fill(from);
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.locator(".search-replace-input").fill(to);
    const saved = noteSaved(to);
    await page.locator(".search-replace-btn").click();
    await expect(page.locator(".search-replace-btn")).toHaveText(/again/);
    await page.locator(".search-replace-btn").click();
    await expect(page.getByText(/Replaced in 1 note/)).toBeVisible();
    await saved;
  };
  await page.locator(".search-replace-toggle").click();
  await replaceAll('"e2e world"', "e2e planet");
  await replaceAll('"e2e planet"', "e2e world");
  await box.press("Escape");
  await sidebarItem("First").click();
  await expect(editor()).toContainText("Hello e2e world");
});

test("switching a core plugin on adds its feature", async () => {
  await sidebarItem("First").click();
  await page.keyboard.press("Control+Comma"); // Settings (the ribbon button can sit under the dev-mode badge)
  await page.getByText("Core plugins", { exact: true }).click();
  const row = page.locator('[data-core-plugin="word-count"]');
  const toggle = row.getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.getByText(/^\d+ words?$/).first()).toBeVisible();
});

test("the Language setting switches the interface to Vietnamese and back to the browser's language", async () => {
  const other = await context.newPage();
  await other.goto(page.url());
  const prefsSaved = (check: (body: string) => boolean) =>
    other.waitForResponse((r) => r.url().endsWith("/users/me/preferences") && r.request().method() === "PUT" && check(r.request().postData() ?? "") && r.ok());
  try {
    await other.locator(".sidebar-root .sb-label").getByText("First", { exact: true }).click();
    await expect(other.locator("html")).toHaveAttribute("lang", "en");
    await other.keyboard.press("Control+Comma");
    const toVi = prefsSaved((b) => b.includes('"language":"vi"'));
    await other.getByLabel("Language", { exact: true }).selectOption("vi");
    await expect(other.locator("html")).toHaveAttribute("lang", "vi");
    await expect(other.getByText("Ngôn ngữ", { exact: true }).first()).toBeVisible(); // Settings re-rendered
    await toVi;
    await other.keyboard.press("Escape");
    await expect(other.getByText(/^\d+ từ$/).first()).toBeVisible(); // core plugin text
    await expect(other.getByTitle("Tìm trong vault")).toBeVisible(); // ribbon
    // The choice is the account's: a reload keeps it.
    await other.reload();
    await other.locator(".sidebar-root .sb-label").getByText("First", { exact: true }).click();
    await expect(other.locator("html")).toHaveAttribute("lang", "vi");
    await expect(other.getByTitle("Thêm công cụ")).toBeVisible();
    // Back to "follow the browser" (English here).
    await other.keyboard.press("Control+Comma");
    const toAuto = prefsSaved((b) => !b.includes('"language"'));
    await other.getByLabel("Ngôn ngữ", { exact: true }).selectOption("auto");
    await expect(other.locator("html")).toHaveAttribute("lang", "en");
    await toAuto;
    await other.keyboard.press("Escape");
  } finally {
    await other.close();
  }
});

test("a browser set to Vietnamese gets the Vietnamese interface before signing in", async ({ browser }) => {
  const vi = await browser.newContext({ locale: "vi-VN" });
  try {
    const p = await vi.newPage();
    await p.goto("/login");
    await expect(p.getByRole("heading", { name: "Đăng nhập Noteriv" })).toBeVisible();
    await expect(p.locator("html")).toHaveAttribute("lang", "vi");
    // The language links switch it right there, and the choice stays on this device.
    await p.getByRole("button", { name: "English" }).click();
    await expect(p.getByRole("heading", { name: "Sign in to Noteriv" })).toBeVisible();
    await p.reload();
    await expect(p.getByRole("heading", { name: "Sign in to Noteriv" })).toBeVisible();
  } finally {
    await vi.close();
  }
});

test("another open tab follows a core plugin switch without reloading", async () => {
  const other = await context.newPage();
  await other.goto(page.url());
  // Open a note there explicitly: the restored tabs may not have reached the server yet.
  await other.locator(".sidebar-root .sb-label").getByText("First", { exact: true }).click();
  await expect(other.getByText(/^\d+ words?$/).first()).toBeVisible();

  await page.keyboard.press("Control+Comma");
  await page.getByText("Core plugins", { exact: true }).click();
  const toggle = page.locator('[data-core-plugin="word-count"]').getByRole("switch");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");

  await expect(other.getByText(/^\d+ words?$/)).toHaveCount(0);
  await other.close();
});

test("reloading restores the open tabs without a request per note", async () => {
  // workspace-state now carries the open notes, so no per-note GET is needed to restore them.
  // Other tabs opened earlier in this run (one note each) may have saved the workspace last: switching between the
  // two open notes here makes this page save its own state again.
  await sidebarItem("Second").click();
  await sidebarItem("First").click();
  const noteGets: string[] = [];
  const onRequest = (r: { url: () => string; method: () => string }) => {
    if (r.method() === "GET" && /\/api\/v1\/vaults\/[^/]+\/notes\/[^/?]+$/.test(r.url())) noteGets.push(r.url());
  };
  page.on("request", onRequest);
  const syncLists: string[] = [];
  const onSync = (r: { url: () => string; method: () => string }) => {
    if (r.method() === "GET" && r.url().endsWith("/sync-connections")) syncLists.push(r.url());
  };
  page.on("request", onSync);
  // The open tabs are saved to the server a moment after they change; reload only once they are there.
  const vaultId = new URL(page.url()).pathname.split("/")[2];
  await expect
    .poll(async () => ((await (await page.request.get(`/api/v1/vaults/${vaultId}/workspace-state`)).json()).openTabs ?? []).length)
    .toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(page.locator(".cm-content").first()).toContainText(/Hello e2e world|The second note/);
  await expect(page.getByText("First.md", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Second.md", { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(1500);
  page.off("request", onRequest);
  page.off("request", onSync);
  expect(noteGets, "restored tabs come from workspace-state").toHaveLength(0);
  expect(syncLists.length, "sync connections are fetched once on open").toBeLessThanOrEqual(1);
});

test("a deleted note goes to the trash and can be restored", async () => {
  await sidebarItem("Second").click({ button: "right" });
  await page.getByText("Delete", { exact: true }).click();
  await expect(sidebarItem("Second")).toHaveCount(0);

  await page.getByTitle("More tools").click();
  await page.getByRole("menuitem", { name: "Trash" }).click();
  await page.getByTitle("Restore file", { exact: true }).first().click();
  await page.keyboard.press("Escape"); // closes the trash panel
  await expect(sidebarItem("Second")).toBeVisible();
});

test("a save without network is kept on the device and sent once the network is back", async () => {
  await sidebarItem("First").click();
  const notePatch = /\/api\/v1\/vaults\/[^/]+\/notes\/[^/]+$/;
  await page.route(notePatch, (route) => (route.request().method() === "PATCH" ? route.abort("internetdisconnected") : route.fallback()));
  await editor().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" offline edit");
  // No network: the edit is kept on this device (and would survive a reload) until it can be sent.
  await expect(page.getByText("Kept on this device", { exact: true })).toBeVisible();
  await page.unroute(notePatch);
  const resent = noteSaved("offline edit");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await resent;
  await expect(page.getByText("saved", { exact: true })).toBeVisible();
});

test("Quick note files the text into Inbox/ of the chosen vault", async () => {
  const vaultUrl = page.url();
  await page.goto("/quick");
  await page.getByLabel("Vault").selectOption({ label: "E2E vault" });
  await page.getByLabel("Note text").fill("Call the bank\nabout the card");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved to Inbox\/Call the bank\.md/)).toBeVisible();
  await expect(page.getByLabel("Note text")).toHaveValue("");
  await page.goto(vaultUrl);
  await sidebarItem("Inbox").click();
  await expect(sidebarItem("Call the bank")).toBeVisible();
});

test("on a phone the ribbon is a bottom bar and the file list a drawer", async () => {
  const phone = await context.newPage();
  try {
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(page.url());
    const ribbon = phone.locator(".ribbon");
    await expect(ribbon).toBeVisible();
    const bar = (await ribbon.boundingBox())!;
    expect(bar.y + bar.height).toBeGreaterThan(844 - 2);
    expect(bar.width).toBeGreaterThan(380);
    // The sidebar starts closed; the header button opens it as a drawer, opening a note closes it again.
    const drawer = phone.locator(".sidebar-root");
    await expect(drawer).toHaveCount(0);
    await phone.getByTitle("Collapse sidebar", { exact: true }).click();
    await expect(drawer).toBeVisible();
    await drawer.locator(".sb-label").getByText("First", { exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await expect(phone.locator(".cm-content").first()).toContainText("Hello e2e world");
    // The note's own buttons scroll into view instead of being cut off.
    const last = phone.getByTitle("File Recovery", { exact: true });
    await last.scrollIntoViewIfNeeded();
    const box = (await last.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    // "More tools" opens above the bottom bar.
    await phone.getByTitle("More tools", { exact: true }).click();
    const menu = (await phone.getByRole("menu").boundingBox())!;
    expect(menu.y + menu.height).toBeLessThanOrEqual(bar.y + 1);
  } finally {
    await phone.close();
  }
});

test("a note changed elsewhere meanwhile is not overwritten: the edit becomes a conflict copy", async () => {
  await sidebarItem("First").click();
  await expect(editor()).toContainText("Hello e2e world");
  const vaultId = new URL(page.url()).pathname.split("/")[2];
  const index = await (await page.request.get(`/api/v1/vaults/${vaultId}/index`)).json();
  const first = index.notes.find((n: { name: string }) => n.name === "First.md");
  // Another device saves the note (no base version: an unconditional write).
  const other = await page.request.patch(`/api/v1/vaults/${vaultId}/notes/${first.id}`, { data: { content: "# First\n\nChanged on another device." } });
  expect(other.ok()).toBe(true);

  await editor().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" local words");
  await expect(page.getByText(/was changed elsewhere meanwhile/)).toBeVisible();
  await expect(page.locator(".sidebar-root .sb-label").getByText(/^First \(conflict \d{4}-\d{2}-\d{2} \d{4}\)$/)).toBeVisible();
  await expect(page.locator("[data-testid=conflict-banner]")).toBeVisible();
  await expect(editor()).toContainText("local words"); // the copy, opened beside the note
  await sidebarItem("First").click();
  await expect(editor()).toContainText("Changed on another device.");
});
