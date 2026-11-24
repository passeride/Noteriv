import { describe, expect, it, vi } from "vitest";
import type { PluginApi } from "@noteriv/plugin-api";
import wordCount, { countText } from "../src/word-count";
import { testI18n } from "./i18n";

describe("countText", () => {
  it("counts Vietnamese words and skips frontmatter and markdown punctuation", () => {
    const note = "---\ntags: [chess]\n---\n# Khai cuộc Sicilian\n\n- **1. e4 c5** là nước đi phổ biến";
    // Khai cuộc Sicilian (3) + 1 e4 c5 (3) + là nước đi phổ biến (5); "tags: [chess]" is frontmatter.
    expect(countText(note).words).toBe(11);
  });

  it("skips fenced blocks such as FEN diagrams, including an unclosed one", () => {
    const note = "These are five words.\n\n```chessboard\nfen: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1\n```\n\nTwo more.";
    expect(countText(note).words).toBe(6);
    expect(countText("one two\n```\nnever closed code").words).toBe(2);
  });

  it("keeps joined words together and reports zero for an empty note", () => {
    expect(countText("don't re-enter").words).toBe(2);
    expect(countText("")).toEqual({ words: 0, characters: 0, readingMinutes: 0 });
    expect(countText("a b").readingMinutes).toBe(1);
  });
});

describe("word-count plugin", () => {
  function fakeApi(content: string | null, locale: "en" | "vi" = "en") {
    const status = new Map<string, { text: string }>();
    const handlers = new Map<string, (...a: unknown[]) => void>();
    const api = {
      app: { platform: "web" },
      i18n: testI18n(locale),
      editor: { getContent: () => content },
      events: { on: (e: string, h: (...a: unknown[]) => void) => handlers.set(e, h) },
      ui: {
        addStatusBarItem: (i: { id: string; text: string }) => status.set(i.id, i),
        removeStatusBarItem: (id: string) => status.delete(id),
        addCommand: vi.fn(),
        addRibbonIcon: vi.fn(),
        showNotice: vi.fn(),
      },
    };
    return { api: api as unknown as PluginApi, status, handlers, ui: api.ui };
  }

  it("shows the count of the open note and follows editor changes", async () => {
    const { api, status, handlers, ui } = fakeApi("one two three");
    await wordCount.onload(api);
    expect(status.get("count")?.text).toBe("3 words");
    handlers.get("editor-change")!("just one");
    expect(status.get("count")?.text).toBe("2 words");
    handlers.get("editor-change")!("one");
    expect(status.get("count")?.text).toBe("1 word");
    expect(ui.addCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "show", hotkey: "Mod+Alt+W" }));
    expect(ui.addRibbonIcon).toHaveBeenCalledOnce();
  });

  it("has no status item without an open note, and words its text in the app's language", async () => {
    const none = fakeApi(null);
    await wordCount.onload(none.api);
    expect(none.status.size).toBe(0);
    const vi = fakeApi("một hai", "vi");
    await wordCount.onload(vi.api);
    expect(vi.status.get("count")?.text).toBe("2 từ");
    expect(vi.ui.addCommand).toHaveBeenCalledWith(expect.objectContaining({ name: "Đếm từ: thống kê ghi chú" }));
  });
});
