// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseSlides, slideToHTML } from "../src/slide-utils";

describe("parseSlides", () => {
  it("splits on --- , *** and ___ lines and numbers the slides", () => {
    const s = parseSlides("# One\n---\n# Two\n***\n# Three\n___\n# Four");
    expect(s.map((x) => x.content)).toEqual(["# One", "# Two", "# Three", "# Four"]);
    expect(s.map((x) => x.index)).toEqual([0, 1, 2, 3]);
  });
  it("gives a single slide when there is no separator, even for empty content", () => {
    expect(parseSlides("just text")).toHaveLength(1);
    expect(parseSlides("")).toHaveLength(1);
  });
  it("does not split on --- inside fenced code blocks", () => {
    const md = "# A\n```yaml\na: 1\n---\nb: 2\n```\n---\n# B";
    const s = parseSlides(md);
    expect(s).toHaveLength(2);
    expect(s[0].content).toContain("b: 2");
  });
  it("handles ~~~ fences and longer fences", () => {
    const s = parseSlides("~~~\n---\n~~~\n---\n````\n---\n````");
    expect(s).toHaveLength(2);
  });
  it("accepts CRLF and CR line endings", () => {
    expect(parseSlides("a\r\n---\r\nb\rc").map((x) => x.content)).toEqual(["a", "b\nc"]);
  });
  it("extracts speaker notes after 'Note:' or '???'", () => {
    const [a, b] = parseSlides("# A\nbody\nNote: say hello\nsecond line\n---\n# B\n???\nonly notes");
    expect(a.content).toBe("# A\nbody");
    expect(a.notes).toBe("say hello\nsecond line");
    expect(b.content).toBe("# B");
    expect(b.notes).toBe("only notes");
  });
  it("renders each slide to HTML", () => {
    expect(parseSlides("# Title")[0].html).toBe("<h1>Title</h1>");
  });
});

describe("slideToHTML", () => {
  it("renders headings with inline formatting", () => {
    expect(slideToHTML("## **Bold** and *it*")).toBe("<h2><strong>Bold</strong> and <em>it</em></h2>");
  });
  it("renders paragraphs, joining their lines with <br>", () => {
    expect(slideToHTML("one\ntwo\n\nthree")).toBe("<p>one<br>two</p>\n<p>three</p>");
  });
  it("renders inline code, strikethrough and bold-italic", () => {
    const html = slideToHTML("`x` ~~gone~~ ***both***");
    expect(html).toContain('<code class="slide-inline-code">x</code>');
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain("<strong><em>both</em></strong>");
  });
  it("renders unordered, ordered and task lists", () => {
    expect(slideToHTML("- a\n- b")).toBe("<ul><li>a</li>\n<li>b</li></ul>");
    expect(slideToHTML("1. a\n2. b")).toBe("<ol><li>a</li>\n<li>b</li></ol>");
    const tasks = slideToHTML("- [x] done\n- [ ] todo");
    expect(tasks).toContain('<li class="task-item"><span class="task-checkbox checked">✓</span> done</li>');
    expect(tasks).toContain('<span class="task-checkbox"></span> todo'); // the parser drops the trailing space in class
  });
  it("renders blockquotes", () => {
    expect(slideToHTML("> quoted\n> more")).toBe("<blockquote>quoted<br>more</blockquote>");
  });
  it("renders fenced code with an escaped language class and escaped content", () => {
    const html = slideToHTML("```js\nif (a < b) {}\n```");
    expect(html).toContain('<pre class="slide-code-block"><code class="language-js">if (a &lt; b) {}</code></pre>');
  });
  it("renders tables with column alignment", () => {
    const html = slideToHTML("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |");
    expect(html).toContain('<th style="text-align:left">a</th>');
    expect(html).toContain('<th style="text-align:center">b</th>');
    expect(html).toContain('<td style="text-align:right">3</td>');
  });
  it("escapes raw HTML written in the note", () => {
    const html = slideToHTML("<script>alert(1)</script> <b>x</b>");
    expect(html).not.toMatch(/<script|<b>/);
    expect(html).toContain("&lt;script&gt;");
  });
  it("renders safe links and images", () => {
    const html = slideToHTML("[site](https://x.test) ![pic](https://x.test/a.png)");
    expect(html).toContain('<a href="https://x.test" class="slide-link">site</a>');
    expect(html).toContain('<img src="https://x.test/a.png" alt="pic" class="slide-image">');
  });
  it("leaves javascript: links and images as literal text instead of markup", () => {
    const html = slideToHTML("[evil](javascript:alert(1)) ![x](javascript:alert(2))");
    expect(html).not.toMatch(/<a |<img /);
    expect(html).toContain("[evil](javascript:alert(1))");
  });
  it("returns an empty string for empty input", () => {
    expect(slideToHTML("")).toBe("");
  });
});
