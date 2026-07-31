import { NextRequest, NextResponse } from "next/server";
import { isLocale, LOCALE_COOKIE, negotiateLocale } from "@/lib/locale";

function isEnabled(value: string | undefined) {
  return value
    ? ["1", "true", "yes", "on"].includes(value.toLowerCase())
    : false;
}

function isOnionRequest(request: NextRequest) {
  const configured = process.env.ONION_URL;
  if (!configured) return false;
  try {
    return (
      request.headers.get("x-shredit-surface") === "onion" &&
      request.nextUrl.origin === new URL(configured).origin
    );
  } catch {
    return false;
  }
}

function clearnetUsesHsts() {
  try {
    const url = new URL(process.env.PUBLIC_BASE_URL ?? "");
    return url.protocol === "https:" && url.hostname.endsWith(".dev");
  } catch {
    return false;
  }
}

function contentSecurityPolicy(
  nonce: string,
  turnstile: boolean,
  onion: boolean,
) {
  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}'${turnstile ? " https://challenges.cloudflare.com" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${turnstile ? " https://challenges.cloudflare.com" : ""}`,
    `frame-src 'self'${turnstile ? " https://challenges.cloudflare.com" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'none'",
    "media-src 'none'",
    "child-src 'none'",
  ];
  if (!onion) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const onion = isOnionRequest(request);
  const turnstile = !onion && isEnabled(process.env.TURNSTILE_ENABLED);
  const csp = contentSecurityPolicy(nonce, turnstile, onion);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const localeRoute = !/^\/(?:api|health|\.well-known|_next)(?:\/|$)/u.test(
    request.nextUrl.pathname,
  );
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = negotiateLocale(
    cookieLocale,
    request.headers.get("accept-language"),
  );
  if (localeRoute) requestHeaders.set("x-shredit-locale", locale);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "no-store");
  if (!onion && clearnetUsesHsts()) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  if (localeRoute && !isLocale(cookieLocale)) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      httpOnly: false,
      maxAge: 31_536_000,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
