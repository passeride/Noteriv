import { describe, expect, it, vi } from "vitest";
import { platformI18n } from "./i18n";
import type { PluginApi, VaultEntry } from "@noteriv/plugin-api";
import flashcards, {
  VIEW_TYPE,
  extractCards,
  getDueCards,
  gradeCard,
  loadReviews,
  migrateLegacyReviews,
  scanVault,
  type Reviews,
} from "../src/flashcards";

const NOTE = "# Openings\n\nQ: What does 1. e4 open?  \nA: The king's diagonal\n\nThe {{Sicilian}} answers 1. e4 with c5.";

describe("extractCards", () => {
  it("finds Q:/A: pairs and cloze deletions with stable ids", () => {
    const cards = extractCards(NOTE, "Openings/e4.md");
    expect(cards.map((c) => [c.type, c.question, c.answer])).toEqual([
      ["qa", "What does 1. e4 open?", "The king's diagonal"],
      ["cloze", "The [...] answers 1. e4 with c5.", "Sicilian"],
    ]);
    // Ids hash path + text. These values come from the pre-plugin code (web/src/lib/flashcard-utils.ts at dc631cc):
    // a refactor that changes them would make every saved review point at nothing.
    expect(cards.map((c) => c.id)).toEqual(["fc-nscvh8", "fc-nu8go8"]);
    expect(extractCards(NOTE, "Other.md")[0].id).not.toBe(cards[0].id);
  });
});

describe("SM-2 scheduling (unchanged from the pre-plugin code)", () => {
  const now = new Date("2026-01-10T12:00:00Z");

  it("steps 1 day, 6 days, then interval × ease, and resets on a failed answer", () => {
    const first = gradeCard("c", 4, {}, now);
    expect(first).toEqual({ cardId: "c", ease: 2.5, interval: 1, repetitions: 1, nextReview: "2026-01-11", lastReview: "2026-01-10" });
    const second = gradeCard("c", 5, { c: first }, now);
    expect(second).toMatchObject({ ease: 2.6, interval: 6, repetitions: 2, nextReview: "2026-01-16" });
    const third = gradeCard("c", 3, { c: second }, now);
    expect(third.interval).toBe(16); // round(6 × 2.6)
    expect(third.ease).toBeCloseTo(2.46);
    const failed = gradeCard("c", 2, { c: third }, now);
    expect(failed).toMatchObject({ interval: 1, repetitions: 0, ease: third.ease });
  });

  it("never lets ease drop below 1.3, and treats unseen or past-due cards as due", () => {
    let r: Reviews = {};
    for (let i = 0; i < 10; i++) r = { c: gradeCard("c", 0, r, now) };
    expect(r.c.ease).toBeGreaterThanOrEqual(1.3);
    const cards = extractCards(NOTE, "a.md");
    const reviews: Reviews = { [cards[0].id]: { ...r.c, cardId: cards[0].id, nextReview: "2026-01-12" } };
    expect(getDueCards(cards, reviews, "2026-01-11").map((c) => c.type)).toEqual(["cloze"]);
    expect(getDueCards(cards, reviews, "2026-01-12")).toHaveLength(2);
  });
});

describe("pre-2.2 review data", () => {
  const review = { cardId: "", ease: 2.6, interval: 6, repetitions: 2, nextReview: "2026-02-01", lastReview: "2026-01-26" };

  it("web: ids were already vault-relative and are kept as they are", () => {
    const legacy = { "fc-a": review, "fc-gone": review };
    expect(migrateLegacyReviews(legacy, [], null)).toEqual(legacy);
  });

  it.each([
    ["Windows", "C:\\Users\\me\\Vault", "C:\\Users\\me\\Vault\\Openings\\e4.md"],
    // A vault path saved with `/` on Windows: Rust's Path::join still adds `\` for the folders below it.
    ["Windows, vault path with /", "C:/Users/me/Vault", "C:/Users/me/Vault\\Openings\\e4.md"],
    ["POSIX (trailing slash)", "/home/me/Vault/", "/home/me/Vault/Openings/e4.md"],
  ])("desktop (%s): ids hashed the absolute path; they move to the relative id", (_, vaultPath, absolute) => {
    const notes = [{ path: "Openings/e4.md", content: NOTE }];
    const oldIds = extractCards(NOTE, absolute).map((c) => c.id);
    const newIds = extractCards(NOTE, "Openings/e4.md").map((c) => c.id);
    const legacy: Reviews = { [oldIds[0]]: { ...review, cardId: oldIds[0] }, "fc-deleted-card": review };
    const out = migrateLegacyReviews(legacy, notes, vaultPath);
    // The Q: line has trailing spaces: the old id hashed them, so pairing by order (not re-hashing) is what works.
    expect(out).toEqual({ [newIds[0]]: { ...review, cardId: newIds[0] } });
  });

  it("imports once: saves straight away, then reads what it saved", async () => {
    let stored: Record<string, unknown> = { legacyReviews: { "fc-a": review } };
    const save = vi.fn(async (data: Record<string, unknown>) => void (stored = data));
    const api = { app: { vaultPath: null }, settings: { load: async () => stored, save } } as unknown as PluginApi;
    expect(await loadReviews(api, [])).toEqual({ "fc-a": review });
    expect(stored).toEqual({ version: 1, reviews: { "fc-a": review } });
    expect(await loadReviews(api, [])).toEqual({ "fc-a": review });
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("flashcards plugin", () => {
  it("scans every markdown note under the vault, including subfolders", async () => {
    const tree: Record<string, VaultEntry[]> = {
      "": [
        { path: "Openings", name: "Openings", isDir: true },
        { path: "a.md", name: "a.md", isDir: false },
      ],
      Openings: [{ path: "Openings/e4.md", name: "e4.md", isDir: false }],
    };
    const vault = {
      list: async (dir?: string) => tree[dir ?? ""] ?? [],
      read: async (p: string) => (p === "a.md" ? "Q: x\nA: y" : NOTE),
    } as unknown as PluginApi["vault"];
    const notes = await scanVault(vault, 1);
    expect(notes.map((n) => n.path).sort()).toEqual(["Openings/e4.md", "a.md"]);
  });

  it("scanVault uses readAll when available", async () => {
    const readAllFn = vi.fn(async () => [
      { path: "a.md", content: "AAA" },
      { path: "b.md", content: "BBB" },
    ]);
    const readFn = vi.fn();
    const vault = {
      readAll: readAllFn,
      read: readFn,
      list: vi.fn(),
    } as unknown as PluginApi["vault"];

    const notes = await scanVault(vault);
    expect(notes).toEqual([
      { path: "a.md", content: "AAA" },
      { path: "b.md", content: "BBB" },
    ]);
    expect(readAllFn).toHaveBeenCalledTimes(1);
    expect(readFn).not.toHaveBeenCalled();
  });

  it("scanVault uses readBatch when available", async () => {
    const tree: Record<string, { path: string; name: string; isDir: boolean }[]> = {
      "": [{ path: "x.md", name: "x.md", isDir: false }],
    };
    const readBatchFn = vi.fn(async (_paths: string[]) => ({ "x.md": "XXX" }));
    const readFn = vi.fn();
    const vault = {
      list: async (dir?: string) => tree[dir ?? ""] ?? [],
      readBatch: readBatchFn,
      read: readFn,
    } as unknown as PluginApi["vault"];

    const notes = await scanVault(vault);
    expect(notes).toEqual([{ path: "x.md", content: "XXX" }]);
    expect(readBatchFn).toHaveBeenCalledWith(["x.md"]);
    expect(readFn).not.toHaveBeenCalled();
  });

  it("registers the review view, a command and a ribbon button that open it", async () => {
    const api = {
      app: { platform: "web", vaultPath: null },
      i18n: platformI18n("web"),
      ui: { registerView: vi.fn(), addCommand: vi.fn(), addRibbonIcon: vi.fn() },
      workspace: { openView: vi.fn(async () => true) },
    };
    await flashcards.onload(api as unknown as PluginApi);
    expect(api.ui.registerView).toHaveBeenCalledWith(VIEW_TYPE, expect.any(Function));
    expect(api.ui.addCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "review", name: "Flashcards: ôn tập" }));
    const ribbon = api.ui.addRibbonIcon.mock.calls[0][0] as { onClick(): void };
    ribbon.onClick();
    expect(api.workspace.openView).toHaveBeenCalledWith(VIEW_TYPE);
  });
});
