import { noStoreHeaders } from "@/lib/api/errors";
import { getEnv } from "@/lib/config/env";
import { getPublicRuntimeConfig, isGitHostedUrl } from "@/lib/public-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const EXPIRY_DAYS = 180;

export function GET(): Response {
  const env = getEnv();
  const publicConfig = getPublicRuntimeConfig();
  const canonical = new URL(
    "/.well-known/security.txt",
    env.PUBLIC_BASE_URL,
  ).toString();
  const sameSiteSecurity = new URL("/security", env.PUBLIC_BASE_URL).toString();
  const contact = publicConfig.securityContact || sameSiteSecurity;
  const policy =
    !env.PUBLIC_REPOSITORY_LINKS_ENABLED && isGitHostedUrl(env.SECURITY_POLICY_URL)
      ? sameSiteSecurity
      : env.SECURITY_POLICY_URL;
  const expires = new Date(Date.now() + EXPIRY_DAYS * 86_400_000).toISOString();
  const body = [
    `Contact: ${contact}`,
    `Policy: ${policy}`,
    `Canonical: ${canonical}`,
    `Expires: ${expires}`,
    "",
  ].join("\r\n");

  return new Response(body, {
    status: 200,
    headers: noStoreHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
  });
}
