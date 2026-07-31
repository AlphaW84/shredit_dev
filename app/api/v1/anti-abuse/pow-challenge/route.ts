import {
  errorResponse,
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
} from "@/lib/api/errors";
import { readJsonBody, requestSurfaceOrResponse } from "@/lib/api/request";
import { decodeBase64Url } from "@/lib/crypto/base64url";
import { issuePowChallenge } from "@/lib/anti-abuse/pow";
import { trustedClientIp } from "@/lib/anti-abuse/request-context";
import { consumePowChallengeIssuanceLimit } from "@/lib/rate-limit/valkey";
import { powChallengeSchema } from "@/lib/validation/schemas";

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

export async function POST(request: Request) {
  const surface = requestSurfaceOrResponse(request);
  if (surface instanceof Response) return surface;
  if (surface !== "onion")
    return errorResponse("ORIGIN_FORBIDDEN", { retryable: false });
  const body = await readJsonBody(request, 8_192);
  if (body instanceof Response) return body;
  const parsed = powChallengeSchema.safeParse(body);
  if (!parsed.success)
    return errorResponse("BAD_REQUEST", { retryable: false });
  let digest: Uint8Array;
  try {
    digest = decodeBase64Url(parsed.data.payloadDigest, 32);
  } catch {
    return errorResponse("BAD_REQUEST", { retryable: false });
  }
  try {
    const limit = await consumePowChallengeIssuanceLimit(
      trustedClientIp(request),
    );
    if (!limit.allowed) {
      return errorResponse("RATE_LIMITED", {
        retryable: true,
        retryAfter: limit.retryAfterSeconds,
      });
    }
    return jsonResponse(await issuePowChallenge(digest, "onion"));
  } catch {
    return errorResponse("DEPENDENCY_UNAVAILABLE");
  }
}
