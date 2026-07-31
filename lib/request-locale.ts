import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, negotiateLocale } from "@/lib/locale";
import type { Locale } from "@/lib/messages";

export async function getRequestLocale(): Promise<Locale> {
  const [requestHeaders, requestCookies] = await Promise.all([
    headers(),
    cookies(),
  ]);
  const middlewareLocale = requestHeaders.get("x-shredit-locale") ?? undefined;
  if (isLocale(middlewareLocale)) return middlewareLocale;
  return negotiateLocale(
    requestCookies.get(LOCALE_COOKIE)?.value,
    requestHeaders.get("accept-language"),
  );
}
