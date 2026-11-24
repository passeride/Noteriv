import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../src/importers/html-to-markdown";
import { attachmentName, PathAllocator, resolvePath, safeName, wikiLink, withProperties } from "../src/importers/types";
import { readProperties } from "@noteriv/core/properties";

describe("htmlToMarkdown", () => {
  it("converts headings, paragraphs, inline marks, links and images", () => {
    const md = htmlToMarkdown(
      `<h1>Title</h1><p>Some <b>bold</b>, <i>italic</i>, <s>gone</s>, <mark>lit</mark> and <code>x()</code>.</p>
       <p><a href="https://e.com/a b">a link</a> <img src="pic.png" alt="Pic"></p>`
    );
    expect(md).toBe("# Title\n\nSome **bold**, *italic*, ~~gone~~, ==lit== and `x()`.\n\n[a link](https://e.com/a%20b) ![Pic](pic.png)");
  });

  it("converts nested and numbered lists, tasks, quotes, code blocks, rules and tables", () => {
    const md = htmlToMarkdown(
      `<ul><li>One<ul><li>Inner</li></ul></li><li><input type="checkbox" checked> Done</li></ul>
       <ol start="3"><li>Third</li><li>Fourth</li></ol>
       <blockquote><p>Quoted</p><p>Again</p></blockquote>
       <pre><code class="language-js">let a = 1;\nlet b = 2;</code></pre><hr>
       <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>x|y</td></tr></table>`
    );
    expect(md).toBe(
      [
        "- One",
        "  - Inner",
        "- [x] Done",
        "",
        "3. Third",
        "4. Fourth",
        "",
        "> Quoted",
        ">",
        "> Again",
        "",
        "```js",
        "let a = 1;",
        "let b = 2;",
        "```",
        "",
        "---",
        "",
        "| A | B |",
        "| --- | --- |",
        "| 1 | x\\|y |",
      ].join("\n")
    );
  });

  it("reads Evernote's one-div-per-line notes, checkboxes and media", () => {
    const md = htmlToMarkdown(
      `<en-note><div>First line</div><div>Second line</div><div><en-todo checked="true"/>Bought</div><div><en-todo/>To buy</div><div><br/></div><en-media hash="abc" type="image/png"/></en-note>`,
      { media: (hash, type) => `![](${hash}.${type.split("/")[1]})` }
    );
    // The picture is apart from the task lines (else it would continue the last task).
    expect(md).toBe("First line\nSecond line\n- [x] Bought\n- [ ] To buy\n\n![](abc.png)");
  });

  it("review findings: rules after lines, nested lists under numbers, blocks in items, nested tables, Evernote code and blank lines", () => {
    // A rule right under a line would make the line a heading.
    expect(htmlToMarkdown("<div>Title line</div><hr/><div>b</div>")).toBe("Title line\n\n---\n\nb");
    expect(htmlToMarkdown("<ol><li>one<ul><li>child</li></ul></li></ol>")).toBe("1. one\n   - child");
    expect(htmlToMarkdown("<ul><li>x<pre>a\nb</pre></li><li><p>p1</p><p>p2</p></li></ul>")).toBe("- x\n\n  ```\n  a\n  b\n  ```\n- p1\n\n  p2");
    expect(htmlToMarkdown("<table><tr><td>o<table><tr><td>i1</td></tr><tr><td>i2</td></tr></table></td></tr></table>")).toBe("| o i1 i2 |\n| --- |");
    expect(htmlToMarkdown('<en-note><div style="-en-codeblock:true"><div>let a = *b*;</div><div>x</div></div><div>p1</div><div><br/></div><div>p2</div><en-crypt>QUJD</en-crypt></en-note>')).toBe(
      "```\nlet a = *b*;\nx\n```\n\np1\n\np2"
    );
  });

  it("escapes $, line starts, and keeps only web and mail links", () => {
    expect(htmlToMarkdown("<p>costs $5</p><div># not a heading</div><div>1. not a list</div>")).toBe("costs \\$5\n\n\\# not a heading\n\\1. not a list");
    expect(htmlToMarkdown('<a href="java&#9;script:alert(1)">x</a> <a href="mailto:a@b.c">m</a> <a href="a b.html">rel</a>')).toBe("x [m](mailto:a@b.c) [rel](a%20b.html)");
  });

  it("escapes characters that would become markup, and drops scripts", () => {
    expect(htmlToMarkdown("<p>2 * 3 = [six] <script>x()</script>a_b</p>")).toBe("2 \\* 3 = \\[six\\] a\\_b");
  });

  it("lets the importer rewrite links and images", () => {
    const md = htmlToMarkdown(`<p><a href="Other.html">Other</a> <img src="img/a.png" alt=""></p>`, {
      link: (href, text) => (href.endsWith(".html") ? `[[${text}]]` : null),
      image: (src) => `![](${src.toUpperCase()})`,
    });
    expect(md).toBe("[[Other]] ![](IMG/A.PNG)");
  });
});

describe("import helpers", () => {
  it("makes safe names and attachment names", () => {
    expect(safeName(' a/b: "c"? ')).toBe("a b c");
    expect(safeName("con")).toBe("con_");
    expect(safeName("...")).toBe("Untitled");
    expect(attachmentName("My Photo (1).JPG")).toBe("My-Photo-1.jpg");
  });

  it("hands out free paths and resolves relative ones", () => {
    const paths = new PathAllocator();
    expect([paths.claim("A/n.md"), paths.claim("A/N.md"), paths.claim("A/n.md")]).toEqual(["A/n.md", "A/N 2.md", "A/n 3.md"]);
    expect(resolvePath("a/b", "../c%20d/e.png")).toBe("a/c d/e.png");
  });

  it("writes wiki-links and front matter that reads back", () => {
    expect(wikiLink("Notion/Plan.md")).toBe("[[Notion/Plan]]");
    expect(wikiLink("Notion/Plan.md", "the plan")).toBe("[[Notion/Plan|the plan]]");
    const note = withProperties("Body", { Status: "Done: yes", "Due #date": "2026-10-23", tags: ["a b", "c"], empty: "", n: 3 });
    expect(note.endsWith("---\nBody")).toBe(true);
    const props = Object.fromEntries(readProperties(note).properties.map((p) => [p.key, p.value]));
    expect(props).toEqual({ Status: "Done: yes", "Due date": "2026-10-23", tags: ["a b", "c"], n: 3 });
  });
});
