import { cookies } from "next/headers";
import { normalizeTheme, THEME_COOKIE, type Theme } from "@/lib/theme";

export async function getRequestTheme(): Promise<Theme> {
  const requestCookies = await cookies();
  return normalizeTheme(requestCookies.get(THEME_COOKIE)?.value);
}
