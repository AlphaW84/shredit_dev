import { afterEach, describe, expect, it } from "vitest";
import { resetEnvForTests } from "@/lib/config/env";
import { getPublicRuntimeConfig } from "@/lib/public-config";

const KEYS = [
  "NODE_ENV",
  "PUBLIC_BASE_URL",
  "ONION_URL",
  "GIT_REPOSITORY_URL",
  "NEXT_PUBLIC_GIT_COMMIT",
  "SHREDIT_LOCAL_EPHEMERAL",
  "IDEMPOTENCY_HMAC_SECRET",
  "IP_HASH_SECRET",
  "POW_SECRET",
  "MAX_ACTIVE_NOTE_BYTES",
  "MAX_ACTIVE_NOTE_COUNT",
  "SECURITY_CONTACT",
  "ABUSE_CONTACT",
  "SECURITY_POLICY_URL",
  "ABUSE_POLICY_URL",
] as const;
const original = new Map(KEYS.map((key) => [key, process.env[key]] as const));

afterEach(() => {
  for (const key of KEYS) {
    const value = original.get(key);
    if (value === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: value });
  }
  resetEnvForTests();
});

describe("public runtime configuration", () => {
  it("selects only the validated public onion, repository, and commit values", () => {
    Object.assign(process.env, { NODE_ENV: "test" });
    process.env.PUBLIC_BASE_URL = "https://shredit.dev";
    process.env.ONION_URL = "http://shreditpublicconfigtest.onion";
    process.env.GIT_REPOSITORY_URL = "https://github.com/example/shredit/";
    process.env.NEXT_PUBLIC_GIT_COMMIT = "0123456789abcdef";
    resetEnvForTests();

    expect(getPublicRuntimeConfig()).toEqual({
      clearnetUrl: "https://shredit.dev",
      onionUrl: "http://shreditpublicconfigtest.onion",
      repositoryUrl: "https://github.com/example/shredit",
      securityContact: "mailto:security@example.invalid",
      abuseContact: "mailto:abuse@example.invalid",
      commit: "0123456789abcdef",
    });
  });

  it("rejects non-onion schemes and repository credentials", () => {
    Object.assign(process.env, { NODE_ENV: "test" });
    process.env.PUBLIC_BASE_URL = "https://shredit.dev";
    process.env.ONION_URL = "javascript:alert(1)";
    process.env.GIT_REPOSITORY_URL = "https://github.com/example/shredit";
    resetEnvForTests();
    expect(() => getPublicRuntimeConfig()).toThrow(/ONION_URL/u);

    delete process.env.ONION_URL;
    process.env.GIT_REPOSITORY_URL =
      "https://user:password@github.com/example/shredit";
    resetEnvForTests();
    expect(() => getPublicRuntimeConfig()).toThrow(/GIT_REPOSITORY_URL/u);
  });

  it("omits an unconfigured repository URL in a loopback production preview", () => {
    Object.assign(process.env, {
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "http://127.0.0.1:3232",
      SHREDIT_LOCAL_EPHEMERAL: "true",
      GIT_REPOSITORY_URL: "",
      NEXT_PUBLIC_GIT_COMMIT: "local",
      IDEMPOTENCY_HMAC_SECRET: "local-idempotency-secret",
      IP_HASH_SECRET: "local-ip-secret",
      POW_SECRET: "local-pow-secret",
      MAX_ACTIVE_NOTE_BYTES: "1024",
      MAX_ACTIVE_NOTE_COUNT: "10",
      SECURITY_CONTACT: "mailto:security@example.invalid",
      ABUSE_CONTACT: "mailto:abuse@example.invalid",
      SECURITY_POLICY_URL: "http://127.0.0.1:3232/security",
      ABUSE_POLICY_URL: "http://127.0.0.1:3232/abuse",
    });
    resetEnvForTests();

    expect(getPublicRuntimeConfig()).toEqual({
      clearnetUrl: "http://127.0.0.1:3232",
      onionUrl: undefined,
      repositoryUrl: undefined,
      securityContact: "mailto:security@example.invalid",
      abuseContact: "mailto:abuse@example.invalid",
      commit: "local",
    });
  });
});
