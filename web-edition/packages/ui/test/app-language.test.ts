import { afterEach, describe, expect, it } from "vitest";
// The apps' language choice (stage 4, session 4.5). Both modules only depend on this package's i18n.
import * as web from "../../../web/src/lib/i18n";

afterEach(() => localStorage.clear());

describe("web language choice", () => {
  it("prefers the developer override, then the saved choice, then the browser, then English", () => {
    expect(web.chooseLocale(undefined, ["fr-FR", "de"])).toBe("en");
    expect(web.chooseLocale(undefined, ["vi-VN", "en-US"])).toBe("vi");
    expect(web.chooseLocale("en", ["vi-VN"])).toBe("en");
    expect(web.chooseLocale("xx", ["vi"])).toBe("vi");
    localStorage.setItem(web.DEV_LOCALE_STORAGE_KEY, "en");
    expect(web.chooseLocale("vi", ["vi"])).toBe("en");
  });

  it("keeps the device's choice when the account has none, and forgets it for 'follow the browser'", () => {
    web.applyLanguage("vi");
    expect(web.storedLanguage()).toBe("vi");
    web.applyLanguage(undefined);
    expect(web.storedLanguage()).toBe("vi");
    web.applyAutomaticLanguage();
    expect(web.storedLanguage()).toBeUndefined();
  });

  it("boots with the same order as chooseLocale (the head script repeats it)", () => {
    expect(web.LOCALE_BOOT_SCRIPT).toContain(JSON.stringify(web.DEV_LOCALE_STORAGE_KEY));
    expect(web.LOCALE_BOOT_SCRIPT).toContain(JSON.stringify(web.LOCALE_STORAGE_KEY));
    expect(web.LOCALE_BOOT_SCRIPT).toContain(JSON.stringify(web.LOCALE_PENDING_CLASS));
    expect(() => new Function(web.LOCALE_BOOT_SCRIPT)).not.toThrow();
  });
});
