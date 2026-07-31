"use client";

import { useCallback, useEffect, useState } from "react";
import { LOCALE_COOKIE } from "@/lib/locale";
import type { Locale } from "@/lib/messages";

export function useLocale(
  initialLocale: Locale,
): [Locale, (locale: Locale) => void] {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const changeLocale = useCallback((nextLocale: Locale) => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LOCALE_COOKIE}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.documentElement.lang = nextLocale;
    setLocale(nextLocale);
  }, []);

  return [locale, changeLocale];
}
