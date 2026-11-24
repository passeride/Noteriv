import { describe, expect, it } from "vitest";
import { md5 } from "../src/importers/md5";
import { importEnex } from "../src/importers/enex";
import { toBase64, type InputFile } from "../src/importers/types";
import { readProperties } from "@noteriv/core/properties";

const enc = new TextEncoder();
const file = (path: string, text: string): InputFile => ({ path, text: async () => text, bytes: async () => enc.encode(text) });

describe("md5", () => {
  it("matches the RFC 1321 test vectors", () => {
    expect(md5(enc.encode(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5(enc.encode("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5(enc.encode("12345678901234567890123456789012345678901234567890123456789012345678901234567890"))).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });
});

// A sample written from Evernote's published export format (not a real person's notes).
const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const pdf = enc.encode("%PDF-1.4 sample");
const ENEX = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20261023T010000Z" application="Evernote" version="10.0">
  <note>
    <title>Trip: plan / ideas</title>
    <created>20261001T083000Z</created>
    <updated>20261002T090000Z</updated>
    <tag>travel</tag><tag>2026 plans</tag>
    <note-attributes><source-url>https://example.com/trip</source-url></note-attributes>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div><b>Pack</b> list:</div><div><en-todo checked="true"/>Passport</div><div><en-todo/>Charger</div><en-media hash="${md5(png)}" type="image/png"/><div><en-media hash="${md5(pdf)}" type="application/pdf"/></div></en-note>]]></content>
    <resource><data encoding="base64">${toBase64(png)}</data><mime>image/png</mime></resource>
    <resource><data encoding="base64">${toBase64(pdf)}</data><mime>application/pdf</mime><resource-attributes><file-name>Tickets (final).pdf</file-name></resource-attributes></resource>
  </note>
  <note><title>Trip: plan / ideas</title><content><![CDATA[<en-note><div>Second with the same title</div></en-note>]]></content></note>
</en-export>`;

describe("importEnex", () => {
  it("turns notes into Markdown with their properties, and resources into attachments linked where they were", async () => {
    const r = await importEnex([file("My Notebook.enex", ENEX)], "Evernote");
    expect(r.skipped).toEqual([]);
    expect(r.notes.map((n) => n.path)).toEqual(["Evernote/Trip plan ideas.md", "Evernote/Trip plan ideas 2.md"]);
    expect(r.attachments.map((a) => a.path)).toEqual(["Evernote/_resources/Trip-plan-ideas.png", "Evernote/_resources/Tickets-final.pdf"]);
    expect(r.attachments[0].data).toEqual(png);

    const note = r.notes[0].content;
    const props = Object.fromEntries(readProperties(note).properties.map((p) => [p.key, p.value]));
    expect(props).toEqual({ created: "2026-10-01T08:30:00Z", updated: "2026-10-02T09:00:00Z", tags: ["travel", "2026 plans"], source: "https://example.com/trip" });
    expect(note.slice(note.lastIndexOf("---\n") + 4)).toBe(
      "**Pack** list:\n- [x] Passport\n- [ ] Charger\n\n![Trip-plan-ideas.png](Evernote/_resources/Trip-plan-ideas.png)\n\n[Tickets (final).pdf](Evernote/_resources/Tickets-final.pdf)\n"
    );
  });

  it("puts each notebook in its own folder when several files are imported, and skips what it cannot read", async () => {
    const r = await importEnex([file("A.enex", ENEX), file("B.enex", "<not-enex/>"), file("notes.txt", "x")], "Evernote");
    expect(r.notes[0].path).toBe("Evernote/A/Trip plan ideas.md");
    expect(r.skipped).toEqual([
      { path: "B.enex", reason: "unreadable" },
      { path: "notes.txt", reason: "unsupported" },
    ]);
  });
});
