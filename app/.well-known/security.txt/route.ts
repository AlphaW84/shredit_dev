import { noStoreHeaders } from "@/lib/api/errors";
import { getEnv } from "@/lib/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const EXPIRY_DAYS = 180;

export function GET(): Response {
  const env = getEnv();
  const canonical = new URL(
    "/.well-known/security.txt",
    env.PUBLIC_BASE_URL,
  ).toString();
  const expires = new Date(Date.now() + EXPIRY_DAYS * 86_400_000).toISOString();
  const body = [
    `Contact: ${env.SECURITY_CONTACT}`,
    `Policy: ${env.SECURITY_POLICY_URL}`,
    `Canonical: ${canonical}`,
    `Expires: ${expires}`,
    "",
  ].join("\r\n");

  return new Response(body, {
    status: 200,
    headers: noStoreHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
  });
}
