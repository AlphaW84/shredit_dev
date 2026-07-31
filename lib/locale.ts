import type { Locale } from "@/lib/messages";

export const LOCALE_COOKIE = "shredit-locale";

export function isLocale(value: string | undefined): value is Locale {
  return value === "en" || value === "zh-CN";
}

export function negotiateLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (isLocale(cookieValue)) return cookieValue;
  if (!acceptLanguage) return "en";

  const candidates = acceptLanguage
    .split(",")
    .map((entry, index) => {
      const [tag = "", ...parameters] = entry.trim().split(";");
      const qualityParameter = parameters.find((parameter) =>
        parameter.trim().startsWith("q="),
      );
      const quality = qualityParameter
        ? Number(qualityParameter.trim().slice(2))
        : 1;
      return {
        tag: tag.toLowerCase(),
        quality: Number.isFinite(quality) ? quality : 0,
        index,
      };
    })
    .sort(
      (left, right) => right.quality - left.quality || left.index - right.index,
    );

  for (const candidate of candidates) {
    if (candidate.quality <= 0) continue;
    if (candidate.tag === "zh" || candidate.tag.startsWith("zh-"))
      return "zh-CN";
    if (candidate.tag === "en" || candidate.tag.startsWith("en-")) return "en";
  }
  return "en";
}
