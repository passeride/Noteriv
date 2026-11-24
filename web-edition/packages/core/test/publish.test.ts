// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { generatePublishHTML } from "../src/publish";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.head.querySelectorAll("style[data-test]").forEach((s) => s.remove());
});

describe("generatePublishHTML", () => {
  it("builds a complete standalone page around the converted markdown", () => {
    const html = generatePublishHTML("# Hi\n\ntext", "My note");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>My note</title>");
    expect(html).toContain("<h1>Hi</h1>");
    expect(html).toContain("<p>text</p>");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });
  it("escapes the title", () => {
    expect(generatePublishHTML("x", 'A & <B> "c"')).toContain("<title>A &amp; &lt;B&gt; &quot;c&quot;</title>");
  });
  it("uses the built-in dark palette when the document defines no theme variables", () => {
    const html = generatePublishHTML("x", "t");
    expect(html).toContain("--bg: #1e1e2e;");
    expect(html).toContain("--text: #cdd6f4;");
    expect(html).toContain("--blue: #89b4fa;");
  });
  it("takes colours from the current theme's CSS variables", () => {
    const style = document.createElement("style");
    style.dataset.test = "1";
    style.textContent = ":root { --bg-primary: #000001; --text-primary: #fffffe; --accent: #123456; }";
    document.head.appendChild(style);
    const html = generatePublishHTML("x", "t");
    expect(html).toContain("--bg: #000001;");
    expect(html).toContain("--text: #fffffe;");
    expect(html).toContain("--blue: #123456;"); // no --blue defined, so the accent is used
  });
  it("credits the project in the footer", () => {
    expect(generatePublishHTML("x", "t")).toContain('Published with <a href="https://github.com/covuaduongsinh/Noteriv">Noteriv</a>');
  });
});
