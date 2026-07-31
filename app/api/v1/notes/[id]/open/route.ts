import {
  errorResponse,
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
} from "@/lib/api/errors";
import { readJsonBody, requestSurfaceOrResponse } from "@/lib/api/request";
import { encodeBase64Url, isValidNoteId } from "@/lib/crypto/base64url";
import { noteStore } from "@/lib/note-store";
import { openNoteSchema } from "@/lib/validation/schemas";
import { trustedClientIp } from "@/lib/anti-abuse/request-context";
import { consumeProtectedOpenLimit } from "@/lib/rate-limit/valkey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const ALLOWED_METHODS = ["POST", "OPTIONS"] as const;

export function GET() {
  return methodNotAllowedResponse(ALLOWED_METHODS);
}

export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;

export function OPTIONS() {
  return optionsResponse(ALLOWED_METHODS);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const surface = requestSurfaceOrResponse(request);
  if (surface instanceof Response) return surface;
  const { id } = await context.params;
  if (!isValidNoteId(id))
    return errorResponse("NOTE_UNAVAILABLE", { retryable: false });
  const body = await readJsonBody(request, 8_192);
  if (body instanceof Response) return body;
  const parsed = openNoteSchema.safeParse(body);
  if (!parsed.success)
    return errorResponse("BAD_REQUEST", { retryable: false });
  if (parsed.data.password !== undefined) {
    try {
      const limit = await consumeProtectedOpenLimit({
        noteId: id,
        clientIp: trustedClientIp(request),
        surface,
      });
      if (!limit.allowed) {
        return errorResponse("PASSWORD_THROTTLED", {
          retryable: true,
          retryAfter: limit.retryAfterSeconds,
        });
      }
    } catch {
      return errorResponse("DEPENDENCY_UNAVAILABLE");
    }
  }
  let result: Awaited<ReturnType<typeof noteStore.consume>>;
  try {
    result = await noteStore.consume(id, parsed.data.password);
  } catch {
    return errorResponse("DEPENDENCY_UNAVAILABLE");
  }
  if (result.kind === "unavailable")
    return errorResponse("NOTE_UNAVAILABLE", { retryable: false });
  return jsonResponse({
    protocolVersion: result.protocolVersion,
    id: result.id,
    iv: encodeBase64Url(result.iv),
    ciphertext: encodeBase64Url(result.ciphertext),
  });
}
