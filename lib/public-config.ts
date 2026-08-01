import { getEnv } from "@/lib/config/env";

export interface PublicRuntimeConfig {
  clearnetUrl: string;
  onionUrl?: string;
  repositoryUrl?: string;
  securityContact: string;
  abuseContact: string;
  commit: string;
}

export function getPublicRuntimeConfig(): PublicRuntimeConfig {
  const env = getEnv();
  return {
    clearnetUrl: new URL(env.PUBLIC_BASE_URL).origin,
    onionUrl: env.ONION_URL ? new URL(env.ONION_URL).origin : undefined,
    repositoryUrl: env.PUBLIC_REPOSITORY_LINKS_ENABLED
      ? env.GIT_REPOSITORY_URL?.replace(/\/$/u, "")
      : undefined,
    securityContact: env.SECURITY_CONTACT,
    abuseContact: env.ABUSE_CONTACT,
    commit: env.NEXT_PUBLIC_GIT_COMMIT,
  };
}
