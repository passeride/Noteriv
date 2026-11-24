import { describe, expect, it } from "vitest";
import { intoFolder, scanFiles } from "@/lib/vault-import";

const file = (name: string, body = "x") => new File([body], name);

describe("scanFiles", () => {
  it("takes single picked files by name, notes and attachments apart", () => {
    const scan = scanFiles([file("Bài 1.md", "# Bài 1"), file("hinh.png"), file("Ghi chú.MD")]);
    expect(scan.notes.map((n) => n.path)).toEqual(["Bài 1.md", "Ghi chú.MD"]);
    expect(scan.attachments.map((a) => a.path)).toEqual(["hinh.png"]);
    expect(scan.skipped).toEqual([]);
  });

  it("names the scan after the only note, or a generic name for several", () => {
    expect(scanFiles([file("Bài 1.md")]).rootName).toBe("Bài 1");
    expect(scanFiles([file("a.md"), file("b.md")]).rootName).toBe("Imported notes");
  });

  it("skips hidden files and attachments over 25MB", () => {
    const big = file("video.mp4");
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    const scan = scanFiles([file(".secret.md"), big, file("ok.md")]);
    expect(scan.notes.map((n) => n.path)).toEqual(["ok.md"]);
    expect(scan.attachments).toEqual([]);
    expect(scan.skipped.map((s) => s.path)).toEqual([".secret.md", "video.mp4"]);
  });

  it("reads back the picked file", async () => {
    const scan = scanFiles([file("a.md", "hello")]);
    expect(await (await scan.notes[0].read()).text()).toBe("hello");
  });
});

describe("intoFolder", () => {
  const scan = scanFiles([file("a.md"), file("img/x.png")]);

  it("puts every note and attachment under the folder", () => {
    const moved = intoFolder(scan, "Cờ vua/Khai cuộc");
    expect(moved.notes.map((n) => n.path)).toEqual(["Cờ vua/Khai cuộc/a.md"]);
    expect(moved.attachments[0].path).toMatch(/^Cờ vua\/Khai cuộc\//);
  });

  it("leaves the scan alone for the vault root and trims slashes", () => {
    expect(intoFolder(scan, "")).toBe(scan);
    expect(intoFolder(scan, "/Docs/").notes[0].path).toBe("Docs/a.md");
  });
});
