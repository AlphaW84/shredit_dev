import {
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
} from "@/lib/api/errors";

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

export function GET() {
  return jsonResponse({ status: "ok" });
}
