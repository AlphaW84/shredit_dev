import { getEnv, type RequestSurface } from "@/lib/config/env";
import {
  isUnknownClientIp,
  requiresTurnstile,
  trustedClientIp,
} from "@/lib/anti-abuse/request-context";

export async function verifyTurnstile(
  token: string | undefined,
  request: Request,
  surface: RequestSurface,
): Promise<boolean> {
  const env = getEnv();
  if (!requiresTurnstile(request, surface)) return true;
  if (!token || !env.TURNSTILE_SECRET_KEY) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const form = new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
    });
    const clientIp = trustedClientIp(request);
    if (!isUnknownClientIp(clientIp)) form.set("remoteip", clientIp);
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
        signal: controller.signal,
        cache: "no-store",
      },
    );
    if (!response.ok) return false;
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    const hostname = new URL(env.PUBLIC_BASE_URL).hostname;
    return (
      result.success === true &&
      result.hostname === hostname &&
      result.action === env.TURNSTILE_EXPECTED_ACTION
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
