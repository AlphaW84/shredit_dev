import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "METHOD_NOT_ALLOWED"
  | "ORIGIN_FORBIDDEN"
  | "ANTI_ABUSE_FAILED"
  | "NOTE_UNAVAILABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "NOTE_ID_CONFLICT"
  | "REQUEST_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "PASSWORD_THROTTLED"
  | "DEPENDENCY_UNAVAILABLE"
  | "STORAGE_FULL";

const messages: Record<ApiErrorCode, string> = {
  BAD_REQUEST: "The request is invalid.",
  METHOD_NOT_ALLOWED: "The request method is not allowed.",
  ORIGIN_FORBIDDEN: "The request origin is not allowed.",
  ANTI_ABUSE_FAILED: "The request could not be verified.",
  NOTE_UNAVAILABLE: "This note is unavailable.",
  IDEMPOTENCY_CONFLICT: "The request cannot be replayed.",
  NOTE_ID_CONFLICT: "The request cannot be completed.",
  REQUEST_TOO_LARGE: "The request is too large.",
  UNSUPPORTED_MEDIA_TYPE: "Content-Type must be application/json.",
  RATE_LIMITED: "Too many requests.",
  PASSWORD_THROTTLED: "Too many password attempts.",
  DEPENDENCY_UNAVAILABLE: "The service is temporarily unavailable.",
  STORAGE_FULL: "Storage is full.",
};

const statuses: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  METHOD_NOT_ALLOWED: 405,
  ORIGIN_FORBIDDEN: 403,
  ANTI_ABUSE_FAILED: 403,
  NOTE_UNAVAILABLE: 404,
  IDEMPOTENCY_CONFLICT: 409,
  NOTE_ID_CONFLICT: 409,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  RATE_LIMITED: 429,
  PASSWORD_THROTTLED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  STORAGE_FULL: 507,
};

export function noStoreHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex, noarchive, nosnippet");
  return headers;
}

export function errorResponse(
  code: ApiErrorCode,
  options?: { retryable?: boolean; retryAfter?: number; status?: number },
): NextResponse {
  const headers = noStoreHeaders({
    "Content-Type": "application/json; charset=utf-8",
  });
  if (options?.retryAfter !== undefined)
    headers.set(
      "Retry-After",
      String(Math.max(1, Math.floor(options.retryAfter))),
    );
  return NextResponse.json(
    {
      error: {
        code,
        message: messages[code],
        retryable:
          options?.retryable ?? [429, 503, 507].includes(statuses[code]),
      },
    },
    { status: options?.status ?? statuses[code], headers },
  );
}

export function jsonResponse<T>(
  body: T,
  status = 200,
  headers?: HeadersInit,
): NextResponse {
  return NextResponse.json(body, { status, headers: noStoreHeaders(headers) });
}

export function malformedBodyResponse(): NextResponse {
  return errorResponse("BAD_REQUEST", { retryable: false });
}

export function methodNotAllowedResponse(
  allowedMethods: readonly string[],
): NextResponse {
  const response = errorResponse("METHOD_NOT_ALLOWED", { retryable: false });
  response.headers.set("Allow", allowedMethods.join(", "));
  return response;
}

export function optionsResponse(
  allowedMethods: readonly string[],
): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: noStoreHeaders({ Allow: allowedMethods.join(", ") }),
  });
}
