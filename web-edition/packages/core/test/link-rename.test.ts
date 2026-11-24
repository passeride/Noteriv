import { describe, expect, it } from "vitest";
import { MemoryVaultAdapter } from "../src/memory-vault-adapter";
import type { NoteRef } from "../src/vault-adapter";
import { expandFolderMove, linkResolver, linkSearchTerms, notesMovedByRename, resolveLinkTarget, rewriteLinksForMoves, updateLinksAfterMove } from "../src/link-rename";

const before = ["Index.md", "projects/Plan.md", "projects/Notes.md", "archive/Notes.md", "img/photo.png"];

function rewrite(content: string, moves: { from: string; to: string }[], source = "Index.md", sourceAfter = source, all = before) {
  return rewriteLinksForMoves(content, { sourceBefore: source, sourceAfter, moves, before: all });
}

describe("rewriteLinksForMoves – wiki links", () => {
  const rename = [{ from: "projects/Plan.md", to: "projects/Roadmap.md" }];

  it("rewrites a bare-name link to the new name", () => {
    expect(rewrite("See [[Plan]].", rename)).toBe("See [[Roadmap]].");
  });

  it("keeps alias, heading, block and embed parts", () => {
    expect(rewrite("[[Plan|the plan]] [[Plan#Goals]] [[Plan#^abc|x]] ![[Plan]]", rename)).toBe(
      "[[Roadmap|the plan]] [[Roadmap#Goals]] [[Roadmap#^abc|x]] ![[Roadmap]]"
    );
  });

  it("is case-insensitive and keeps an explicit .md", () => {
    expect(rewrite("[[plan]] [[Plan.md]]", rename)).toBe("[[Roadmap]] [[Roadmap.md]]");
  });

  it("keeps the path form when the link used a path", () => {
    expect(rewrite("[[projects/Plan]]", [{ from: "projects/Plan.md", to: "work/Plan.md" }])).toBe("[[work/Plan]]");
  });

  it("leaves a bare-name link alone on a move that keeps the name unique", () => {
    expect(rewrite("[[Plan]]", [{ from: "projects/Plan.md", to: "work/Plan.md" }])).toBe("[[Plan]]");
  });

  it("switches to a path when the new name would be ambiguous", () => {
    const all = [...before, "other/Roadmap.md"];
    expect(rewrite("[[Plan]]", rename, "Index.md", "Index.md", all)).toBe("[[projects/Roadmap]]");
  });

  it("does not touch links to other notes, unresolved links or links inside code", () => {
    const text = "[[Index]] [[Missing]] `[[Plan]]`\n```\n[[Plan]]\n```\n~~~md\n[[Plan]]\n~~~\n[[Plan]]";
    expect(rewrite(text, rename)).toBe("[[Index]] [[Missing]] `[[Plan]]`\n```\n[[Plan]]\n```\n~~~md\n[[Plan]]\n~~~\n[[Roadmap]]");
  });

  it("resolves a duplicated bare name to the note in the source's own folder first", () => {
    const moves = [{ from: "archive/Notes.md", to: "archive/Old notes.md" }];
    expect(rewrite("[[Notes]]", moves, "archive/Index.md", "archive/Index.md", [...before, "archive/Index.md"])).toBe("[[Old notes]]");
    expect(rewrite("[[Notes]]", moves, "projects/Plan.md")).toBe("[[Notes]]");
  });

  it("rewrites attachment embeds by full file name", () => {
    expect(rewrite("![[photo.png]] ![[img/photo.png|200]]", [{ from: "img/photo.png", to: "img/beach.png" }])).toBe(
      "![[beach.png]] ![[img/beach.png|200]]"
    );
  });

  it("returns the same string when nothing changes", () => {
    const text = "Nothing to see [[Index]]";
    expect(rewrite(text, rename)).toBe(text);
  });
});

describe("rewriteLinksForMoves – markdown links", () => {
  it("rewrites a relative link and keeps the fragment", () => {
    expect(rewrite("[p](projects/Plan.md#Goals)", [{ from: "projects/Plan.md", to: "projects/Road map.md" }])).toBe(
      "[p](projects/Road%20map.md#Goals)"
    );
  });

  it("keeps angle brackets and spaces when the link used them", () => {
    expect(rewrite("[p](<projects/Plan.md>)", [{ from: "projects/Plan.md", to: "projects/Road map.md" }])).toBe("[p](<projects/Road map.md>)");
  });

  it("recomputes a moved note's own relative links", () => {
    const moves = [{ from: "projects/Notes.md", to: "archive/2026/Notes.md" }];
    expect(rewrite("[plan](Plan.md) [[Plan]]", moves, "projects/Notes.md", "archive/2026/Notes.md")).toBe(
      "[plan](../../projects/Plan.md) [[Plan]]"
    );
  });

  it("re-encodes characters that would break the link, in the style the link used", () => {
    const moves = [{ from: "projects/Notes.md", to: "archive/Notes.md" }];
    const all = [...before, "projects/a(b).md", "projects/C# notes.md", "projects/Café.md"];
    expect(rewrite("[x](a%28b%29.md) [y](C%23%20notes.md) [z](Caf%C3%A9.md)", moves, "projects/Notes.md", "archive/Notes.md", all)).toBe(
      "[x](../projects/a%28b%29.md) [y](../projects/C%23%20notes.md) [z](../projects/Caf%C3%A9.md)"
    );
  });

  it("rewrites a link whose label is an image", () => {
    expect(rewrite("[![i](a.png)](projects/Plan.md)", [{ from: "projects/Plan.md", to: "projects/R.md" }])).toBe("[![i](a.png)](projects/R.md)");
  });

  it("leaves links inside an indented fence alone", () => {
    const text = "- item\n    ```\n    [[Plan]]\n    ```";
    expect(rewrite(text, [{ from: "projects/Plan.md", to: "projects/R.md" }])).toBe(text);
  });

  it("ignores web links and pure fragments", () => {
    const text = "[a](https://x.org/Plan.md) [b](#Plan) [c](mailto:a@b.c)";
    expect(rewrite(text, [{ from: "projects/Plan.md", to: "projects/R.md" }])).toBe(text);
  });
});

describe("expandFolderMove", () => {
  it("moves every file under the folder and nothing else", () => {
    expect(expandFolderMove("projects", "work", [...before, "projectsX/a.md"])).toEqual([
      { from: "projects/Plan.md", to: "work/Plan.md" },
      { from: "projects/Notes.md", to: "work/Notes.md" },
    ]);
  });
});

describe("notesMovedByRename", () => {
  const vault = "C:\\Vault";

  it("plans a single note rename with Windows paths", () => {
    expect(notesMovedByRename(vault, "C:\\Vault\\a\\Old.md", "C:/Vault/a/New.md", ["C:\\Vault\\a\\New.md", "C:\\Vault\\b.md"])).toEqual({
      moves: [{ from: "a/Old.md", to: "a/New.md" }],
      before: ["a/Old.md", "b.md"],
    });
  });

  it("plans a folder rename as moves of the notes inside it", () => {
    expect(notesMovedByRename(vault, "C:\\Vault\\a", "C:\\Vault\\z", ["C:\\Vault\\z\\x.md", "C:\\Vault\\z\\s\\y.md", "C:\\Vault\\b.md"])).toEqual({
      moves: [
        { from: "a/x.md", to: "z/x.md" },
        { from: "a/s/y.md", to: "z/s/y.md" },
      ],
      before: ["a/x.md", "a/s/y.md", "b.md"],
    });
  });

  it("returns null when no note moved", () => {
    expect(notesMovedByRename(vault, "C:\\Vault\\empty", "C:\\Vault\\still-empty", ["C:\\Vault\\b.md"])).toBeNull();
  });

  it("plans an attachment rename even if notesAfter only lists markdown files", () => {
    expect(
      notesMovedByRename(vault, "C:\\Vault\\img\\old-photo.png", "C:\\Vault\\img\\new-photo.png", ["C:\\Vault\\Note.md"])
    ).toEqual({
      moves: [{ from: "img/old-photo.png", to: "img/new-photo.png" }],
      before: ["Note.md", "img/old-photo.png"],
    });
  });

  it("plans an attachment rename when attachments are included in files list", () => {
    expect(
      notesMovedByRename(vault, "C:\\Vault\\img\\old-photo.png", "C:\\Vault\\img\\new-photo.png", [
        "C:\\Vault\\Note.md",
        "C:\\Vault\\img\\new-photo.png",
      ])
    ).toEqual({
      moves: [{ from: "img/old-photo.png", to: "img/new-photo.png" }],
      before: ["Note.md", "img/old-photo.png"],
    });
  });
});

describe("linkSearchTerms", () => {
  it("covers the bare name and its percent-encoded spellings", () => {
    expect(linkSearchTerms([{ from: "projects/Road map.md", to: "x.md" }])).toEqual(["Road map", "Road%20map"]);
    expect(linkSearchTerms([{ from: "Café.md", to: "x.md" }])).toEqual(["Café", "Caf%C3%A9"]);
  });
});

describe("updateLinksAfterMove", () => {
  it("rewrites the notes that link to a renamed note and reports them", async () => {
    const adapter = new MemoryVaultAdapter({
      "Index.md": "Go to [[Plan]] and [[Other]].",
      "projects/Roadmap.md": "Self: [[Plan#Top]]",
      "Other.md": "no links",
    });
    const result = await updateLinksAfterMove(adapter, [{ from: "projects/Plan.md", to: "projects/Roadmap.md" }], [
      "Index.md",
      "projects/Plan.md",
      "Other.md",
    ]);
    expect(result.changed.map((c) => c.path).sort()).toEqual(["Index.md", "projects/Roadmap.md"]);
    expect(await adapter.readNote(result.changed.find((c) => c.path === "Index.md")!.id)).toBe("Go to [[Roadmap]] and [[Other]].");
    expect(result.failed).toEqual([]);
  });

  it("never writes over a note changed meanwhile: it rewrites the fresh text instead", async () => {
    const memory = new MemoryVaultAdapter({ "Index.md": "[[Plan]]", "Roadmap.md": "" });
    let typedElsewhere = false;
    const adapter = Object.assign(memory, {
      async writeNoteIfUnchanged(id: string, content: string, expected: string) {
        if (!typedElsewhere) {
          typedElsewhere = true; // someone saves the note between the read and the write
          await memory.writeNote(id, "[[Plan]] and more");
        }
        if ((await memory.readNote(id)) !== expected) return false;
        await memory.writeNote(id, content);
        return true;
      },
    });
    const result = await updateLinksAfterMove(adapter, [{ from: "Plan.md", to: "Roadmap.md" }], ["Index.md", "Plan.md"]);
    expect(await adapter.readNote("Index.md")).toBe("[[Roadmap]] and more");
    expect(result.changed).toEqual([{ id: "Index.md", path: "Index.md", name: "Index.md", content: "[[Roadmap]] and more" }]);
  });

  it("reads every note when the narrowed search says its answer is incomplete", async () => {
    const adapter = Object.assign(new MemoryVaultAdapter({ "Index.md": "[[Plan]]", "Roadmap.md": "" }), {
      async notesContaining(): Promise<{ ref: NoteRef; content: string }[] | null> {
        return null;
      },
    });
    const result = await updateLinksAfterMove(adapter, [{ from: "Plan.md", to: "Roadmap.md" }], ["Index.md", "Plan.md"]);
    expect(result.changed.map((c) => c.path)).toEqual(["Index.md"]);
  });

  it("leaves notes the caller skips untouched", async () => {
    const adapter = new MemoryVaultAdapter({ "Index.md": "[[Plan]]", "B.md": "[[Plan]]", "Roadmap.md": "" });
    const result = await updateLinksAfterMove(adapter, [{ from: "Plan.md", to: "Roadmap.md" }], ["Index.md", "B.md", "Plan.md"], (ref) => ref.path === "B.md");
    expect(result.changed.map((c) => c.path)).toEqual(["Index.md"]);
    expect(await adapter.readNote("B.md")).toBe("[[Plan]]");
  });
});

describe("linkResolver", () => {
  it("resolves every target the way resolveLinkTarget does", () => {
    const files = ["A.md", "dir/B.md", "dir/a.md", "x/y/B.md", "img/a.png", "Notes/C# tips.md", "C.MD", "deep/dir/B.md", "dir/b"];
    const targets = ["a", "A.md", "b", "B", "dir/b", "dir/B.md", "y/b", "dir/B", "a.png", "img/a.png", "c# tips", "c", "nope", "", " b ", "x/nope"];
    const resolve = linkResolver(files);
    for (const source of ["A.md", "dir/z.md", "x/y/z.md", "other/z.md"]) {
      for (const t of targets) expect([t, source, resolve(t, source)]).toEqual([t, source, resolveLinkTarget(t, source, files)]);
    }
  });
});
