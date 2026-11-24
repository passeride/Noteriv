import { afterEach, describe, expect, it } from "vitest";
import {
  registerInlineRenderer,
  setLocalImageLoader,
  unregisterRenderer,
  type InlineRenderer,
} from "../src/markdown";
import { getBlockRenderers, getInlineRenderers } from "../src/markdown/registry";
import { getLocalImageLoader } from "../src/markdown/vault-hooks";
import { getKatex, loadKatex } from "../src/markdown/katex-loader";

// Characterisation of the live-preview renderers: the built-in set registers on import and each inline renderer
// maps a line of text to HTML replacements with absolute positions. These run the real renderers (jsdom), so a
// dependency bump (katex, mermaid) or a refactor that changes the output shows up here.

function find(name: string, text: string, offset = 0) {
  const renderer = getInlineRenderers().find((r) => r.name === name);
  if (!renderer) throw new Error(`renderer not registered: ${name}`);
  return renderer.find(text, offset);
}

describe("registry", () => {
  afterEach(() => {
    unregisterRenderer("test-inline");
  });

  it("registers the built-in block and inline renderers on import", () => {
    expect(getBlockRenderers().length).toBeGreaterThan(5);
    const names = getInlineRenderers().map((r) => r.name);
    for (const expected of ["images", "wikilinks", "tags", "inline-math", "autolinks"]) expect(names).toContain(expected);
  });

  it("keeps inline renderers sorted by priority and replaces one registered under the same name", () => {
    const make = (priority: number, html: string): InlineRenderer => ({
      name: "test-inline",
      priority,
      find: () => [{ from: 0, to: 1, html, className: "t" }],
    });
    registerInlineRenderer(make(1, "a"));
    registerInlineRenderer(make(2, "b"));
    const found = getInlineRenderers().filter((r) => r.name === "test-inline");
    expect(found).toHaveLength(1);
    expect(found[0].find("x", 0)[0].html).toBe("b");

    const priorities = getInlineRenderers().map((r) => r.priority ?? 100);
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
  });

  it("removes a renderer by name", () => {
    registerInlineRenderer({ name: "test-inline", find: () => [] });
    unregisterRenderer("test-inline");
    expect(getInlineRenderers().some((r) => r.name === "test-inline")).toBe(false);
  });
});

describe("inline renderers", () => {
  it("tags: finds #tags with absolute positions and ignores a mid-word hash", () => {
    const r = find("tags", "see #chess/endgame and a#b", 10);
    expect(r).toHaveLength(1);
    expect(r[0].from).toBe(14);
    expect(r[0].to).toBe(14 + "#chess/endgame".length);
    expect(r[0].html).toContain("chess/endgame");
  });

  it("wikilinks: target and alias", () => {
    const r = find("wikilinks", "go [[Note A|alias]] now");
    expect(r).toHaveLength(1);
    expect(r[0].html).toContain('data-target="Note A"');
    expect(r[0].html).toContain("alias");
  });

  it("images: a recorder clip or an audio file renders a player, other images stay images", () => {
    const clip = find("images", "rec ![Audio](/api/v1/vaults/v/attachments/a/download)");
    expect(clip).toHaveLength(1);
    expect(clip[0].className).toBe("md-audio");
    expect(clip[0].html).toContain("<audio controls");
    expect(clip[0].html).toContain('src="/api/v1/vaults/v/attachments/a/download"');

    const file = find("images", "![talk](https://example.com/talk.mp3)");
    expect(file[0].html).toContain("<audio controls");

    const pic = find("images", "![cat](https://example.com/cat.png)");
    expect(pic[0].className).toBe("md-image");
    expect(pic[0].html).toContain("<img");
  });

  it("highlight: ==text==", () => {
    const r = find("inline-highlight", "a ==mark== b");
    expect(r).toHaveLength(1);
    expect(r[0].html).toContain("mark");
  });

  it("inline math: shows the source until katex loads, then renders through it, and skips $$", async () => {
    // KaTeX is not in the first load any more (katex-loader): the first render starts loading it.
    expect(getKatex()).toBeNull();
    const before = find("inline-math", "x $a<2$ y");
    expect(before).toHaveLength(1);
    expect(before[0].html).toBe('<code class="math-pending">a&lt;2</code>');
    await loadKatex();
    const r = find("inline-math", "x $a^2$ y");
    expect(r).toHaveLength(1);
    expect(r[0].html).toContain("katex");
    expect(find("inline-math", "$$a^2$$")).toEqual([]);
  });

  it("autolinks: links a bare URL and drops trailing punctuation", () => {
    const r = find("autolinks", "see https://example.com/a.");
    expect(r).toHaveLength(1);
    expect(r[0].html).toContain('href="https://example.com/a"');
  });

  it("images: size suffix becomes a style, remote sources are used as written", () => {
    const r = find("images", "![alt|300x200](https://example.com/p.png)");
    expect(r).toHaveLength(1);
    expect(r[0].html).toContain('src="https://example.com/p.png"');
    expect(r[0].html).toContain("width:300px;height:200px");
    expect(r[0].html).toContain("md-img-resize-handle");
  });

  it("images: a relative source resolves through the local image loader, and without one stays as written", () => {
    expect(getLocalImageLoader()).toBeNull();
    const plain = find("images", "![](pics/a.png)");
    expect(plain[0].html).toContain('src="pics/a.png"');
    expect(plain[0].html).not.toContain("data-local-src");

    setLocalImageLoader({ resolve: (src) => `/vault/${src}`, load: async () => null });
    try {
      const local = find("images", "![](pics/a.png)");
      expect(local[0].html).toContain('data-local-src="/vault/pics/a.png"');
    } finally {
      setLocalImageLoader(null);
    }
  });
});

describe("vault hooks", () => {
  it("runs the post-processor runner over each rendered widget, and survives a failing one", async () => {
    const { RenderedMarkdownWidget } = await import("../src/markdown/widget");
    const { setPostProcessorRunner } = await import("../src/markdown/vault-hooks");
    const seen: string[] = [];
    setPostProcessorRunner((el) => {
      seen.push(el.textContent ?? "");
      el.setAttribute("data-processed", "yes");
    });
    const dom = new RenderedMarkdownWidget("<b>hello</b>", "md-x").toDOM();
    expect(seen).toEqual(["hello"]);
    expect(dom.getAttribute("data-processed")).toBe("yes");

    setPostProcessorRunner(() => {
      throw new Error("boom");
    });
    expect(new RenderedMarkdownWidget("<i>still</i>", "md-x").toDOM().textContent).toBe("still");
    setPostProcessorRunner(null);
  });

  it("stores and clears the local image loader", () => {
    const loader = { resolve: () => null, load: async () => null };
    setLocalImageLoader(loader);
    expect(getLocalImageLoader()).toBe(loader);
    setLocalImageLoader(null);
    expect(getLocalImageLoader()).toBeNull();
  });
});
