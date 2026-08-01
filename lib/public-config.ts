import { getEnv } from "@/lib/config/env";

const gitHostPattern = /(?:^|\.)github\.com$|(?:^|\.)gitlab\.com$|(?:^|\.)bitbucket\.org$/iu;

export function isGitHostedUrl(value: string): boolean {
  if (!value.startsWith("http")) return false;
  try {
    return gitHostPattern.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

function publicContact(value: string, linksEnabled: boolean): string {
  if (linksEnabled || !value.startsWith("http")) return value;
  return isGitHostedUrl(value) ? "" : value;
}

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
    securityContact: publicContact(
      env.SECURITY_CONTACT,
      env.PUBLIC_REPOSITORY_LINKS_ENABLED,
    ),
    abuseContact: publicContact(
      env.ABUSE_CONTACT,
      env.PUBLIC_REPOSITORY_LINKS_ENABLED,
    ),
    commit: env.NEXT_PUBLIC_GIT_COMMIT,
  };
}
