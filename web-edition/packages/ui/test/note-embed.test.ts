import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbedElement, isNoteEmbedTarget } from "../src/markdown/renderers/note-embed";
import { setEmbedSource } from "../src/markdown/vault-hooks";

const notes: Record<string, string> = {
  "Plan.md": "---\ntags: [x]\n---\n# Plan\nIntro.\n\n## Goals\nWin more. ^g1\n\n![[Steps]]\n\n## Later\nNot shown.",
  "Steps.md": "1. First\n2. Second",
  "Loop.md": "Before\n![[Loop]]",
};

function useVault(open = vi.fn()) {
  setEmbedSource({
    async load(note) {
      if (/\.png$/i.test(note)) return { image: `https://img.test/${note}` };
      const path = `${note.replace(/\.md$/i, "")}.md`;
      return notes[path] !== undefined ? { path, content: notes[path] } : null;
    },
    open,
  });
  return open;
}

/** Waits for the embed's async loads (nested ones included) to settle. */
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

afterEach(() => setEmbedSource(null));

describe("note embeds", () => {
  it("knows which targets it embeds", () => {
    expect(isNoteEmbedTarget("Plan")).toBe(true);
    expect(isNoteEmbedTarget("Plan#^g1")).toBe(true);
    expect(isNoteEmbedTarget("pic.png")).toBe(true);
    expect(isNoteEmbedTarget("sketch.drawing")).toBe(false);
    expect(isNoteEmbedTarget("doc.pdf")).toBe(false);
  });

  it("shows a heading's section, with embeds inside it embedded too, and opens the target from its title", async () => {
    const open = useVault();
    const el = createEmbedElement("Plan#Goals");
    document.body.appendChild(el);
    await settle();
    expect(text(el.querySelector(".md-note-embed-title"))).toBe("Plan › Goals");
    const body = text(el.querySelector(".md-note-embed-body"));
    expect(body).toContain("Win more.");
    expect(body).not.toContain("^g1");
    expect(body).not.toContain("Not shown");
    expect(text(el.querySelector(".md-note-embed .md-note-embed .md-note-embed-body"))).toContain("Second");

    el.querySelector(".md-note-embed-title")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(open).toHaveBeenCalledWith("Plan#Goals");
    el.remove();
  });

  it("stops a note that embeds itself, and says when a note or anchor is missing", async () => {
    useVault();
    const loop = createEmbedElement("Loop");
    const missing = createEmbedElement("Nowhere");
    const anchor = createEmbedElement("Plan#Nope");
    await settle();
    // The outer embed shows the note; the one inside it (the same note again) stops.
    expect(text(loop.querySelector(".md-note-embed-md"))).toBe("Before");
    expect(text(loop.querySelector(".md-note-embed-body .md-note-embed-message"))).toBe("This note is already shown above (it embeds itself)");
    expect(text(missing.querySelector(".md-note-embed-message"))).toBe("“Nowhere” is not in this vault yet");
    expect(text(anchor.querySelector(".md-note-embed-message"))).toBe("“Nope” is not in this note");
  });

  it("shows an image target as an image", async () => {
    useVault();
    const el = createEmbedElement("pic.png");
    await settle();
    expect(el.querySelector("img")?.getAttribute("src")).toBe("https://img.test/pic.png");
  });
});
