import { describe, expect, it } from "vitest";
import { importHtml } from "../src/importers/html-folder";
import type { InputFile } from "../src/importers/types";
import { readProperties } from "@noteriv/core/properties";

const enc = new TextEncoder();
const file = (path: string, text: string): InputFile => ({ path, text: async () => text, bytes: async () => enc.encode(text) });

describe("importHtml", () => {
  it("turns pages into notes named by their title, with pictures, links between pages and Markdown files kept", async () => {
    const r = await importHtml(
      [
        file("Export/index.html", `<html><head><title>Start here</title><style>p{}</style></head><body><h1>Start here</h1><p>Go to <a href="sub/Other%20page.html">the other page</a>.</p><img src="img/cat photo.jpg" alt="Cat"><img src="data:image/png;base64,iVBO"></body></html>`),
        file("Export/sub/Other page.html", `<body><h1>Other</h1><p>Back <a href="../index.html">home</a>, <a href="https://example.com">web</a></p></body>`),
        file("Export/img/cat photo.jpg", "JPG"),
        file("Export/notes.md", "# Plain\n\n![x](img/cat%20photo.jpg)"),
        file("Export/style.css", "p{}"),
      ],
      "HTML"
    );
    expect(r.notes.map((n) => n.path)).toEqual(["HTML/Export/Start here.md", "HTML/Export/sub/Other.md", "HTML/Export/notes.md"]);
    expect(r.attachments.map((a) => a.path)).toEqual(["HTML/_resources/cat-photo.jpg", "HTML/_resources/Start-here-1.png"]);
    expect(r.skipped).toEqual([{ path: "Export/style.css", reason: "unsupported" }]);
    expect(r.notes[0].content).toBe("Go to [[HTML/Export/sub/Other|the other page]].\n\n![Cat](HTML/_resources/cat-photo.jpg)![](HTML/_resources/Start-here-1.png)\n");
    expect(r.notes[1].content).toBe("Back [[HTML/Export/Start here|home]], [web](https://example.com)\n");
    expect(r.notes[2].content).toBe("# Plain\n\n![x](HTML/_resources/cat-photo.jpg)");
  });

  it("reads Google Keep notes: title, content and labels as tags", async () => {
    const r = await importHtml(
      [file("Keep/Shopping.html", `<body><div class="note"><div class="title">Shopping</div><div class="content">Milk<br>Eggs</div><div class="labels"><span class="label-name">home</span></div></div></body>`)],
      "Keep"
    );
    const note = r.notes[0];
    expect(note.path).toBe("Keep/Keep/Shopping.md");
    expect(readProperties(note.content).properties.map((p) => [p.key, p.value])).toEqual([["tags", ["home"]]]);
    expect(note.content.endsWith("---\nMilk\nEggs\n")).toBe(true);
  });
});

describe("review findings", () => {
  it("keeps a damaged embedded picture as its text, and does not list Keep's .json files", async () => {
    const r = await importHtml(
      [file("a.html", '<body><p>x <img src="data:image/png;base64,@@@" alt="pic"></p></body>'), file("a.json", "{}")],
      "H"
    );
    expect(r.notes[0].content).toBe("x pic\n");
    expect(r.skipped).toEqual([]);
  });
});
