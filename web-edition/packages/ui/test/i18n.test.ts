import { afterEach, describe, expect, it, vi } from "vitest";
import { createTranslator, flattenMessages, getLocale, onLocaleChange, registerCatalog, resolveLocale, setLocale, t } from "../src/i18n";

const catalog = flattenMessages({
  greet: "Hello {name}",
  files: { one: "{count} file", other: "{count} files" },
  nested: { deep: { key: "Deep" } },
});

describe("createTranslator", () => {
  it("fills params, leaves unknown placeholders and picks plural forms by count", () => {
    const tr = createTranslator("en", catalog);
    expect(tr("greet", { name: "Ann" })).toBe("Hello Ann");
    expect(tr("greet")).toBe("Hello {name}");
    expect(tr("files", { count: 1 })).toBe("1 file");
    expect(tr("files", { count: 3 })).toBe("3 files");
    expect(tr("nested.deep.key")).toBe("Deep");
  });

  it("falls back to English, then to the key itself (reported once per call)", () => {
    const missing = vi.fn();
    const vi_ = flattenMessages({ files: { other: "{count} tệp" } });
    const tr = createTranslator("vi", vi_, catalog, missing);
    expect(tr("files", { count: 1 })).toBe("1 tệp");
    expect(tr("greet", { name: "An" })).toBe("Hello An");
    expect(tr("nope")).toBe("nope");
    expect(missing).toHaveBeenCalledWith("nope");
  });
});

describe("plural forms without Intl.PluralRules (the Android app's engine may lack it)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("still picks English one/other, and Vietnamese other", async () => {
    vi.stubGlobal("Intl", { ...Intl, PluralRules: undefined });
    vi.resetModules();
    const fresh = await import("../src/i18n/translate");
    const en = fresh.createTranslator("en", catalog);
    expect(en("files", { count: 1 })).toBe("1 file");
    expect(en("files", { count: 0 })).toBe("0 files");
    expect(fresh.createTranslator("vi", fresh.flattenMessages({ files: { one: "x", other: "{count} tệp" } }))("files", { count: 1 })).toBe("1 tệp");
  });
});

describe("resolveLocale", () => {
  it("prefers a supported saved choice, then the browser's languages, then the fallback", () => {
    expect(resolveLocale({ saved: "vi", preferred: ["en-US"] })).toBe("vi");
    expect(resolveLocale({ saved: "fr", preferred: ["fr-FR", "vi-VN", "en"] })).toBe("vi");
    expect(resolveLocale({ preferred: ["de-DE"] })).toBe("en");
    expect(resolveLocale({ preferred: ["de-DE"], fallback: "vi" })).toBe("vi");
  });
});

describe("app-wide locale", () => {
  afterEach(async () => {
    await setLocale("en");
  });

  it("starts in English with the bundled catalog", () => {
    expect(getLocale()).toBe("en");
    expect(t("panels.vaultSearch.noResults")).toBe("No results found");
  });

  it("loads Vietnamese on demand, tells listeners and sets <html lang>", async () => {
    const listener = vi.fn();
    const stop = onLocaleChange(listener);
    await setLocale("vi");
    stop();
    expect(getLocale()).toBe("vi");
    expect(listener).toHaveBeenCalledOnce();
    expect(document.documentElement.lang).toBe("vi");
    expect(t("panels.vaultSearch.noResults")).toBe("Không có kết quả");
    expect(t("plugins.wordCount.words", { count: 2 })).toBe("2 từ");
  });

  it("switches synchronously to a registered catalog, and the last of quick calls wins", async () => {
    registerCatalog("vi", { panels: { quickOpen: { empty: "Trống" } } });
    void setLocale("vi");
    expect(getLocale()).toBe("vi");
    expect(t("panels.quickOpen.empty")).toBe("Trống");
    // Not in the registered catalog: English.
    expect(t("panels.quickOpen.placeholder")).toBe("Type to search notes...");
    await setLocale("en");
    expect(t("panels.quickOpen.empty")).toBe("No notes found");
  });
});
