import {
  errorResponse,
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
} from "@/lib/api/errors";
import { isValidNoteId } from "@/lib/crypto/base64url";
import { noteStore } from "@/lib/note-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const ALLOWED_METHODS = ["GET", "HEAD", "OPTIONS"] as const;

export function POST() {
  return methodNotAllowedResponse(ALLOWED_METHODS);
}

export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;

export function OPTIONS() {
  return optionsResponse(ALLOWED_METHODS);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!isValidNoteId(id))
    return errorResponse("NOTE_UNAVAILABLE", { retryable: false });
  let metadata: Awaited<ReturnType<typeof noteStore.metadata>>;
  try {
    metadata = await noteStore.metadata(id);
  } catch {
    return errorResponse("DEPENDENCY_UNAVAILABLE");
  }
  if (!metadata) return errorResponse("NOTE_UNAVAILABLE", { retryable: false });
  return jsonResponse(metadata);
}
