import { decodeBase64Url } from "@/lib/crypto/base64url";
import { errorResponse } from "@/lib/api/errors";
import { surfaceForRequest } from "@/lib/config/env";
import { trustedIngressSurface } from "@/lib/anti-abuse/request-context";

export const MAX_CREATE_BODY_BYTES = 131_072;

function hasDuplicateJsonKeys(source: string): boolean {
  let index = 0;
  const length = source.length;
  let duplicate = false;
  const skipWhitespace = () => {
    while (index < length && /\s/u.test(source[index])) index += 1;
  };
  const parseString = (): string | null => {
    if (source[index] !== '"') return null;
    const start = index;
    index += 1;
    while (index < length) {
      const char = source[index];
      if (char === "\\") {
        index += 2;
        continue;
      }
      index += 1;
      if (char === '"') {
        try {
          return JSON.parse(source.slice(start, index)) as string;
        } catch {
          return null;
        }
      }
    }
    return null;
  };
  const parseValue = (): boolean => {
    skipWhitespace();
    const char = source[index];
    if (char === '"') return parseString() !== null;
    if (char === "{") {
      index += 1;
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return true;
      }
      const keys = new Set<string>();
      while (index < length) {
        skipWhitespace();
        const key = parseString();
        if (key === null) return false;
        if (keys.has(key)) {
          duplicate = true;
          return false;
        }
        keys.add(key);
        skipWhitespace();
        if (source[index] !== ":") return true;
        index += 1;
        if (!parseValue()) return true;
        skipWhitespace();
        if (source[index] === "}") {
          index += 1;
          return true;
        }
        if (source[index] !== ",") return true;
        index += 1;
      }
      return true;
    }
    if (char === "[") {
      index += 1;
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return true;
      }
      while (index < length) {
        if (!parseValue()) return true;
        skipWhitespace();
        if (source[index] === "]") {
          index += 1;
          return true;
        }
        if (source[index] !== ",") return true;
        index += 1;
      }
      return true;
    }
    // Primitive values cannot contain object keys. Advance to the next structural delimiter.
    while (index < length && !/[\s,\]}]/u.test(source[index])) index += 1;
    return true;
  };
  parseValue();
  return duplicate;
}

export function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  return (
    contentType === "application/json" ||
    contentType.startsWith("application/json;")
  );
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | Response> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return errorResponse("REQUEST_TOO_LARGE", { retryable: false });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readJsonBody(
  request: Request,
  maxBytes = MAX_CREATE_BODY_BYTES,
): Promise<unknown | Response> {
  if (!hasJsonContentType(request))
    return errorResponse("UNSUPPORTED_MEDIA_TYPE", { retryable: false });
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength))
      return errorResponse("BAD_REQUEST", { retryable: false });
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > maxBytes) {
      return errorResponse("REQUEST_TOO_LARGE", { retryable: false });
    }
  }
  const body = await readBoundedBody(request, maxBytes);
  if (body instanceof Response) return body;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (hasDuplicateJsonKeys(text))
      return errorResponse("BAD_REQUEST", { retryable: false });
    return JSON.parse(text) as unknown;
  } catch {
    return errorResponse("BAD_REQUEST", { retryable: false });
  }
}

export function requestSurfaceOrResponse(
  request: Request,
): "clearnet" | "onion" | Response {
  try {
    const surface = surfaceForRequest(request, trustedIngressSurface(request));
    return surface ?? errorResponse("ORIGIN_FORBIDDEN", { retryable: false });
  } catch {
    return errorResponse("ORIGIN_FORBIDDEN", { retryable: false });
  }
}

export function readIdempotencyKey(request: Request): Uint8Array | Response {
  const value = request.headers.get("idempotency-key");
  if (!value || !/^[A-Za-z0-9_-]{32}$/u.test(value))
    return errorResponse("BAD_REQUEST", { retryable: false });
  try {
    return decodeBase64Url(value, 24);
  } catch {
    return errorResponse("BAD_REQUEST", { retryable: false });
  }
}

export function noRequestBody(request: Request): boolean {
  return (
    !request.headers.get("content-length") ||
    request.headers.get("content-length") === "0"
  );
}
