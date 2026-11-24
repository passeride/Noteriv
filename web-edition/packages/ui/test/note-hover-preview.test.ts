import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import NoteHoverPreview from "../src/panels/NoteHoverPreview";
import { setEmbedSource } from "../src/markdown/vault-hooks";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => setEmbedSource(null));

const NOTES: Record<string, string> = {
  Plan: "---\ntags: [x]\n---\n# Plan\nIntro.\n## Steps\nFirst step ^s1\n## Later\nNot now.",
};

async function show(target: string) {
  setEmbedSource({
    load: async (note) => (note === "logo.png" ? { image: "data:image/png;base64,AA" } : NOTES[note] ? { path: `${note}.md`, content: NOTES[note] } : null),
    open: () => {},
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(createElement(NoteHoverPreview, { target, position: { x: 10, y: 10 }, onDismiss: () => {} })));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  const text = host.querySelector(".hp-body")?.textContent;
  const title = host.querySelector(".hp-title")?.textContent;
  const img = host.querySelector("img")?.getAttribute("src");
  act(() => root.unmount());
  return { text, title, img };
}

describe("NoteHoverPreview", () => {
  it("shows the note without its front matter, or just the heading's section or the block", async () => {
    expect((await show("Plan")).text).toBe("# Plan\nIntro.\n## Steps\nFirst step\n## Later\nNot now.");
    const section = await show("Plan#Steps|the steps");
    expect(section.text).toBe("## Steps\nFirst step");
    expect(section.title).toBe("Plan › # Steps");
    expect((await show("Plan#^s1")).text).toBe("First step");
  });

  it("says when the note, or the heading in it, is not there, and shows an image target", async () => {
    expect((await show("Gone")).text).toBe("Note not found");
    expect((await show("Plan#Nowhere")).text).toBe("This heading or block is not in the note");
    expect((await show("logo.png")).img).toBe("data:image/png;base64,AA");
  });
});
