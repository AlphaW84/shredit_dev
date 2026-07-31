import { describe, expect, it } from "vitest";
import { isLocale, negotiateLocale } from "@/lib/locale";

describe("locale negotiation", () => {
  it("gives an explicit supported cookie priority over browser preferences", () => {
    expect(negotiateLocale("en", "zh-CN,zh;q=0.9")).toBe("en");
    expect(negotiateLocale("zh-CN", "en-US,en;q=0.9")).toBe("zh-CN");
  });

  it("negotiates Simplified Chinese and respects quality ordering", () => {
    expect(negotiateLocale(undefined, "zh-Hans-CN,zh;q=0.9,en;q=0.8")).toBe(
      "zh-CN",
    );
    expect(negotiateLocale(undefined, "zh-CN;q=0.4,en-US;q=0.9")).toBe("en");
  });

  it("falls back to English for invalid cookies and unsupported languages", () => {
    expect(isLocale("ru")).toBe(false);
    expect(negotiateLocale("ru", "de-DE,fr;q=0.8")).toBe("en");
    expect(negotiateLocale(undefined, null)).toBe("en");
  });
});
