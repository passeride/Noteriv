// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isSafeUrl, sanitizeHtml } from "../src/sanitize-html";

describe("isSafeUrl", () => {
  it("allows web, mail, phone and blob URLs", () => {
    for (const u of ["https://x.test/a", "http://x.test", "mailto:a@b.test", "tel:+84123", "blob:https://x.test/uuid", "HTTPS://X.TEST"]) {
      expect(isSafeUrl(u), u).toBe(true);
    }
  });
  it("allows media data: URLs only", () => {
    expect(isSafeUrl("data:image/png;base64,AAAA")).toBe(true);
    expect(isSafeUrl("data:audio/mp3;base64,AAAA")).toBe(true);
    expect(isSafeUrl("data:video/mp4;base64,AAAA")).toBe(true);
    expect(isSafeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
  });
  it("allows relative paths and fragments", () => {
    for (const u of ["/abs/path.png", "./rel.png", "../up.png", "#section", "img/pic.png", "pic.png", "?q=1"]) {
      expect(isSafeUrl(u), u).toBe(true);
    }
  });
  it("refuses javascript:, including ones split with characters a URL parser ignores", () => {
    for (const u of ["javascript:alert(1)", "JavaScript:alert(1)", "java\nscript:alert(1)", "java\tscript:alert(1)", " javascript:alert(1)", "\u0000javascript:alert(1)", "java​script:alert(1)"]) {
      expect(isSafeUrl(u), JSON.stringify(u)).toBe(false);
    }
  });
  it("refuses other unknown schemes", () => {
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });
});

describe("sanitizeHtml", () => {
  it("keeps ordinary markup", () => {
    const out = sanitizeHtml('<p>Hello <b>world</b> <a href="https://x.test/a">link</a></p>');
    expect(out).toContain("<b>world</b>");
    expect(out).toContain('href="https://x.test/a"');
  });
  it("drops scripts and event-handler attributes", () => {
    const out = sanitizeHtml('<img src="https://x.test/a.png" onerror="alert(1)"><script>alert(2)</script><p onclick="alert(3)">t</p>');
    expect(out).not.toMatch(/script/i);
    expect(out).not.toMatch(/onerror|onclick/i);
    expect(out).toContain('src="https://x.test/a.png"');
    expect(out).toContain("<p>t</p>");
  });
  it("removes elements that can embed or submit: iframe, object, embed, form, input, button, textarea, meta, link, base", () => {
    const dirty = ["<iframe src=https://x.test></iframe>", "<object data=x></object>", "<embed src=x>", "<form action=x></form>", "<input>", "<button>b</button>", "<textarea>t</textarea>", "<meta http-equiv=refresh content=0>", "<link rel=stylesheet href=x>", "<base href=x>", "<p>kept</p>"].join("");
    const out = sanitizeHtml(dirty);
    for (const tag of ["iframe", "object", "embed", "form", "input", "button", "textarea", "meta", "link", "base"]) {
      expect(out, tag).not.toMatch(new RegExp(`<${tag}`, "i"));
    }
    expect(out).toContain("<p>kept</p>");
  });
  it("drops javascript: hrefs but keeps the link text", () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/javascript/i);
    expect(out).toContain("click");
  });
  it("keeps image data: URLs, and drops html data: URLs from links", () => {
    expect(sanitizeHtml('<img src="data:image/png;base64,AAAA">')).toContain("data:image/png");
    const link = sanitizeHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>');
    expect(link).not.toContain("data:text/html");
    expect(link).toContain("x");
  });
  // DOMPurify has its own rule for image/audio/video elements: any data: URI is allowed there (it cannot
  // run as a script in those contexts), so the media-type narrowing above matters for href, not for img src.
  it("leaves data: URIs on <img> to DOMPurify's own element rule", () => {
    expect(sanitizeHtml('<img src="data:text/html;base64,AAAA">')).toContain("<img");
  });
  it("never returns a whole document", () => {
    const out = sanitizeHtml("<html><head><title>t</title></head><body><p>x</p></body></html>");
    expect(out).not.toMatch(/<html|<body|<head/i);
    expect(out).toContain("<p>x</p>");
  });
  it("unwraps table cells that arrive without their table (documented caveat)", () => {
    expect(sanitizeHtml("<td>cell</td>")).toBe("cell");
  });
});
