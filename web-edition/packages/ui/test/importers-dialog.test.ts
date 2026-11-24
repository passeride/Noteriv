import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { ImportLimitError, readPicked } from "../src/importers/input";
import AppImport, { type AppImportReport } from "../src/panels/AppImport";
import type { ImportResult } from "../src/importers/types";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const wait = () => act(async () => new Promise((r) => setTimeout(r, 20)));

async function zipOf(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, data] of Object.entries(files)) zip.file(path, data);
  return zip.generateAsync({ type: "uint8array" });
}

describe("readPicked", () => {
  it("opens zips (and a zip inside one, as Notion splits big exports), dropping the shared top folder", async () => {
    const inner = await zipOf({ "Export/Part/B 0123456789abcdef0123456789abcdef.md": "# B" });
    const outer = await zipOf({ "Export/A.md": "# A", "Export/Part-2.zip": inner, "__MACOSX/._A.md": "x" });
    const files = await readPicked([new File([outer as BlobPart], "Export.zip")]);
    expect(files.map((f) => f.path)).toEqual(["A.md", "Part/B 0123456789abcdef0123456789abcdef.md"]);
    expect(await files[0].text()).toBe("# A");
  });

  it("strips a folder all picked files share", async () => {
    const pick = (path: string) => Object.assign(new File(["x"], path.split("/").pop()!), { webkitRelativePath: path });
    const files = await readPicked([pick("Takeout/Keep/a.html"), pick("Takeout/Keep/b.html")]);
    expect(files.map((f) => f.path)).toEqual(["a.html", "b.html"]);
  });

  it("stops past a limit: picked size, unpacked size (zips included) and number of files", async () => {
    const limits = { pickedBytes: 100, unpackedBytes: 50, files: 2 };
    const big = Object.defineProperty(new File(["x"], "a.html"), "size", { value: 101 });
    await expect(readPicked([big], { limits })).rejects.toMatchObject({ limit: "size", max: 100 });

    const packed = await zipOf({ "a.md": "y".repeat(60) });
    await expect(readPicked([new File([packed as BlobPart], "x.zip")], { limits: { ...limits, pickedBytes: 10_000 } })).rejects.toMatchObject({ limit: "size", found: 60 });

    // A zip inside a zip counts once: by what it holds, not also by its own size.
    const inner = await zipOf({ "b.md": "z".repeat(40) });
    const outer = await zipOf({ "a.md": "x", "Part-2.zip": inner });
    expect(await readPicked([new File([outer as BlobPart], "x.zip")], { limits: { ...limits, pickedBytes: 10_000 } })).toHaveLength(2);

    const three = ["a.md", "b.md", "c.md"].map((n) => new File(["x"], n));
    await expect(readPicked(three, { limits })).rejects.toBeInstanceOf(ImportLimitError);
    await expect(readPicked(three, { limits })).rejects.toMatchObject({ limit: "files" });
    expect(await readPicked(three.slice(0, 2), { limits })).toHaveLength(2);
  });

  it("stops once cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readPicked([new File(["x"], "a.md")], { signal: controller.signal })).rejects.toThrow();
  });
});

describe("AppImport", () => {
  it("reads the picked export, shows what it found, and writes it into the chosen folder", async () => {
    const write = vi.fn(async (r: ImportResult, progress: (d: number, t: number) => void) => {
      progress(r.notes.length, r.notes.length);
      return { written: r.notes.length, kept: 0, failed: [] };
    });
    const onOpen = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => root.render(createElement(AppImport, { write, onClose: () => {}, onOpen })));

    // Evernote, one .enex picked.
    await act(async () => host.querySelectorAll<HTMLInputElement>(".aimp-source input")[1].click());
    const enex = `<?xml version="1.0"?><en-export><note><title>Hello</title><content><![CDATA[<en-note><div>Hi</div></en-note>]]></content></note></en-export>`;
    const input = host.querySelector<HTMLInputElement>("[data-testid=aimp-file]")!;
    Object.defineProperty(input, "files", { value: [new File([enex], "Book.enex")], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await wait();
    expect(host.querySelector(".aimp-summary")?.textContent).toContain("Found 1 notes and 0 attachments.");

    const folder = host.querySelector<HTMLInputElement>(".aimp-folder input")!;
    expect(folder.value).toBe("Evernote");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(folder, "Old notes");
      folder.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => host.querySelector<HTMLButtonElement>(".aimp-primary")!.click());
    await wait();
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].notes.map((n) => n.path)).toEqual(["Old notes/Hello.md"]);
    expect(host.textContent).toContain("Imported 1 item.");

    await act(async () => host.querySelector<HTMLButtonElement>(".aimp-primary")!.click());
    expect(onOpen).toHaveBeenCalledWith("Old notes/Hello.md");
    act(() => root.unmount());
  });

  it("stops an import on Cancel and says how much was written before", async () => {
    const write = vi.fn(
      (_r: ImportResult, progress: (d: number, t: number) => void, signal: AbortSignal) =>
        new Promise<AppImportReport>((resolve) => {
          progress(1, 3);
          signal.addEventListener("abort", () => resolve({ written: 1, kept: 0, failed: [], cancelled: true }));
        })
    );
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => root.render(createElement(AppImport, { write, onClose: () => {} })));
    await act(async () => host.querySelectorAll<HTMLInputElement>(".aimp-source input")[1].click());
    const enex = `<?xml version="1.0"?><en-export><note><title>A</title><content><![CDATA[<en-note>a</en-note>]]></content></note></en-export>`;
    const input = host.querySelector<HTMLInputElement>("[data-testid=aimp-file]")!;
    Object.defineProperty(input, "files", { value: [new File([enex], "Book.enex")], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await wait();
    await act(async () => host.querySelector<HTMLButtonElement>(".aimp-primary")!.click());
    await wait();
    const cancel = [...host.querySelectorAll<HTMLButtonElement>(".aimp-actions button")].find((b) => b.textContent === "Cancel")!;
    await act(async () => cancel.click());
    await wait();
    expect(host.textContent).toContain("Stopped. 1 item was imported before that and stays in the vault.");
    // What was written is not known note by note: no Open button that could point at a note never written.
    expect(host.querySelector(".aimp-primary")).toBeNull();
    act(() => root.unmount());
  });

  it("says when the picked export is too large instead of reading it", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    await act(async () => root.render(createElement(AppImport, { write: vi.fn(), onClose: () => {} })));
    const input = host.querySelector<HTMLInputElement>("[data-testid=aimp-file]")!;
    const huge = Object.defineProperty(new File(["x"], "Export.zip"), "size", { value: 2 * 1024 ** 3 });
    Object.defineProperty(input, "files", { value: [huge], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await wait();
    expect(host.querySelector(".aimp-error")?.textContent).toBe("This export is too large to import at once (over 1 GB). Export it in parts, or a few folders at a time.");
    act(() => root.unmount());
  });
});
