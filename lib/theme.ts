export const THEME_COOKIE = "shredit-theme";

export type Theme = "dark" | "light";

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

export function normalizeTheme(value: unknown): Theme {
  return isTheme(value) ? value : "dark";
}
