import { describe, expect, it } from "vitest";
import { clickedLink } from "../src/editor/link-click";

function rendered(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.querySelector("[data-click]") ?? host.firstElementChild!;
}

describe("clickedLink", () => {
  it("opens the note a wiki-link names", () => {
    expect(clickedLink(rendered('<span class="md-wikilink" data-target="Second" data-click>Second</span>'))).toEqual({ note: "Second" });
  });

  it("finds the link from a child element", () => {
    expect(clickedLink(rendered('<span class="md-wikilink" data-target="Folder/Note"><b data-click>Note</b></span>'))).toEqual({ note: "Folder/Note" });
  });

  it("sends web and mail addresses out of the app", () => {
    expect(clickedLink(rendered('<a class="md-link" href="https://example.com/a" data-click>site</a>'))).toEqual({ url: "https://example.com/a" });
    expect(clickedLink(rendered('<a class="md-link" href="mailto:me@example.com" data-click>mail</a>'))).toEqual({ url: "mailto:me@example.com" });
  });

  it("treats a relative Markdown link as a note of the vault", () => {
    expect(clickedLink(rendered('<a class="md-link" href="./Daily/2026-10-19.md" data-click>today</a>'))).toEqual({ note: "Daily/2026-10-19.md" });
    expect(clickedLink(rendered('<a class="md-link" href="My%20note.md" data-click>x</a>'))).toEqual({ note: "My note.md" });
  });

  it("ignores everything else", () => {
    expect(clickedLink(rendered('<a class="md-link" href="javascript:alert(1)" data-click>x</a>'))).toBeNull();
    expect(clickedLink(rendered('<a class="md-link" href="#heading" data-click>x</a>'))).toBeNull();
    expect(clickedLink(rendered("<span data-click>plain</span>"))).toBeNull();
    expect(clickedLink(null)).toBeNull();
  });
});
