import {
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
} from "@/lib/api/errors";
import { getEnv } from "@/lib/config/env";
import { databaseReady } from "@/lib/database/client";
import { valkeyPing } from "@/lib/rate-limit/valkey";

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

export async function GET() {
  try {
    const env = getEnv();
    if (env.SHREDIT_LOCAL_EPHEMERAL) {
      return jsonResponse({
        status: "ready",
        valkey: "ok",
        localEphemeral: true,
      });
    }
    const postgresReady = Boolean(env.DATABASE_URL) && (await databaseReady());
    if (!postgresReady) return jsonResponse({ status: "not_ready" }, 503);
    const valkeyReady = await valkeyPing();
    return jsonResponse({
      status: "ready",
      valkey: valkeyReady ? "ok" : "degraded",
    });
  } catch {
    return jsonResponse({ status: "not_ready" }, 503);
  }
}
