import {
  errorResponse,
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
} from "@/lib/api/errors";
import { getEnv, surfaceForTarget } from "@/lib/config/env";
import {
  requiresTurnstile,
  trustedIngressSurface,
} from "@/lib/anti-abuse/request-context";

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

export function GET(request: Request) {
  const surface = surfaceForTarget(request, trustedIngressSurface(request));
  if (!surface) return errorResponse("ORIGIN_FORBIDDEN", { retryable: false });
  const turnstileRequired = requiresTurnstile(request, surface);
  return jsonResponse({
    surface,
    turnstileRequired,
    turnstileSiteKey: turnstileRequired
      ? getEnv().TURNSTILE_SITE_KEY
      : undefined,
    powRequired: surface === "onion",
  });
}
