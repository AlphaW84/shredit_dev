import { describe, expect, it } from "vitest";
import { isTheme, normalizeTheme, THEME_COOKIE } from "@/lib/theme";

describe("theme preference", () => {
  it("accepts only the two supported themes", () => {
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("light")).toBe(true);
    expect(isTheme("system")).toBe(false);
  });

  it("keeps dark as the deterministic fallback", () => {
    expect(normalizeTheme("light")).toBe("light");
    expect(normalizeTheme(undefined)).toBe("dark");
    expect(normalizeTheme("invalid")).toBe("dark");
    expect(THEME_COOKIE).toBe("shredit-theme");
  });
});
