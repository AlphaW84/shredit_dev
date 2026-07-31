import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getEnv,
  resetEnvForTests,
  surfaceForRequest,
  surfaceForTarget,
} from "@/lib/config/env";
import { trustedIngressSurface } from "@/lib/anti-abuse/request-context";

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

function configureProduction(): void {
  const values: Record<string, string> = {
    NODE_ENV: "production",
    SHREDIT_LOCAL_EPHEMERAL: "false",
    DATABASE_URL: "postgresql://shredit:shredit@127.0.0.1:5432/shredit",
    VALKEY_URL: "redis://127.0.0.1:6379",
    PUBLIC_BASE_URL: "https://shredit.dev",
    GIT_REPOSITORY_URL: "https://github.com/example/shredit",
    NEXT_PUBLIC_GIT_COMMIT: "0123456789abcdef",
    SECURITY_CONTACT: "mailto:security@shredit.dev",
    ABUSE_CONTACT: "mailto:abuse@shredit.dev",
    SECURITY_POLICY_URL: "https://shredit.dev/security",
    ABUSE_POLICY_URL: "https://shredit.dev/abuse",
    IDEMPOTENCY_HMAC_SECRET: "idempotency-0123456789abcdef-unique",
    IP_HASH_SECRET: "ip-hashing-0123456789abcdef-unique",
    POW_SECRET: "proof-work-0123456789abcdef-unique",
    MAX_ACTIVE_NOTE_BYTES: "104857600",
    MAX_ACTIVE_NOTE_COUNT: "10000",
    TURNSTILE_ENABLED: "false",
    TRUSTED_PROXY_CIDRS: "10.0.0.0/8",
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  resetEnvForTests();
}

describe("fail-closed environment validation", () => {
  it("rejects misspelled boolean values instead of silently disabling controls", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TURNSTILE_ENABLED", "tru");
    resetEnvForTests();

    expect(() => getEnv()).toThrow(/TURNSTILE_ENABLED/u);
  });

  it("requires distinct production secrets with at least 32 UTF-8 bytes", () => {
    configureProduction();
    vi.stubEnv("POW_SECRET", "short");
    resetEnvForTests();
    expect(() => getEnv()).toThrow(/POW_SECRET/u);

    configureProduction();
    vi.stubEnv("POW_SECRET", "ip-hashing-0123456789abcdef-unique");
    resetEnvForTests();
    expect(() => getEnv()).toThrow(/must be distinct/u);

    configureProduction();
    expect(() => getEnv()).not.toThrow();
  });

  it("requires repository metadata outside a loopback production preview", () => {
    configureProduction();
    vi.stubEnv("GIT_REPOSITORY_URL", "");
    resetEnvForTests();

    expect(() => getEnv()).toThrow(/GIT_REPOSITORY_URL/u);
  });

  it("requires an explicit trusted ingress range outside loopback", () => {
    configureProduction();
    vi.stubEnv("TRUSTED_PROXY_CIDRS", "");
    resetEnvForTests();

    expect(() => getEnv()).toThrow(/TRUSTED_PROXY_CIDRS/u);
  });

  it.each(["SECURITY_POLICY_URL", "ABUSE_POLICY_URL"] as const)(
    "requires an explicit production %s",
    (key) => {
      configureProduction();
      vi.stubEnv(key, "");
      resetEnvForTests();

      expect(() => getEnv()).toThrow(new RegExp(key, "u"));
    },
  );

  it.each(["SECURITY_POLICY_URL", "ABUSE_POLICY_URL"] as const)(
    "requires %s to use HTTPS outside loopback",
    (key) => {
      configureProduction();
      vi.stubEnv(
        key,
        `http://shredit.dev/${key === "SECURITY_POLICY_URL" ? "security" : "abuse"}`,
      );
      resetEnvForTests();

      expect(() => getEnv()).toThrow(new RegExp(`${key} must use HTTPS`, "u"));
    },
  );

  it.each(["SECURITY_POLICY_URL", "ABUSE_POLICY_URL"] as const)(
    "requires %s to use the canonical public origin",
    (key) => {
      configureProduction();
      vi.stubEnv(
        key,
        `https://policies.invalid/${key === "SECURITY_POLICY_URL" ? "security" : "abuse"}`,
      );
      resetEnvForTests();

      expect(() => getEnv()).toThrow(
        new RegExp(`${key} must use the same canonical origin`, "u"),
      );
    },
  );

  it("allows explicit same-origin HTTP policy URLs for a loopback production runtime", () => {
    configureProduction();
    vi.stubEnv("PUBLIC_BASE_URL", "http://127.0.0.1:3232");
    vi.stubEnv("GIT_REPOSITORY_URL", "");
    vi.stubEnv("SECURITY_POLICY_URL", "http://127.0.0.1:3232/security");
    vi.stubEnv("ABUSE_POLICY_URL", "http://127.0.0.1:3232/abuse");
    resetEnvForTests();

    expect(() => getEnv()).not.toThrow();
  });

  it("keeps a loopback production preview routable across internal loopback aliases", () => {
    configureProduction();
    vi.stubEnv("PUBLIC_BASE_URL", "http://127.0.0.1:3232");
    vi.stubEnv("GIT_REPOSITORY_URL", "");
    vi.stubEnv("SECURITY_POLICY_URL", "http://127.0.0.1:3232/security");
    vi.stubEnv("ABUSE_POLICY_URL", "http://127.0.0.1:3232/abuse");
    resetEnvForTests();

    const request = new Request("http://localhost:3232/api/v1/notes", {
      headers: { Origin: "http://127.0.0.1:3232" },
    });
    expect(surfaceForTarget(request)).toBe("clearnet");
    expect(surfaceForRequest(request)).toBe("clearnet");

    const standaloneBindRequest = new Request(
      "http://0.0.0.0:3232/api/v1/anti-abuse/policy",
      { headers: { Origin: "http://127.0.0.1:3232" } },
    );
    expect(surfaceForTarget(standaloneBindRequest)).toBe("clearnet");
    expect(surfaceForRequest(standaloneBindRequest)).toBe("clearnet");
  });

  it("does not let an arbitrary production Host select the onion policy", () => {
    configureProduction();
    vi.stubEnv("ONION_URL", "http://shredit-surface-test.onion");
    resetEnvForTests();

    const direct = new Request(
      "http://shredit-surface-test.onion/api/v1/notes",
      {
        headers: {
          Origin: "http://shredit-surface-test.onion",
          "x-shredit-runtime-peer": "203.0.113.5",
          "x-shredit-surface": "onion",
        },
      },
    );
    const trusted = new Request("https://shredit.dev/api/v1/notes", {
      headers: {
        Origin: "http://shredit-surface-test.onion",
        "x-shredit-runtime-peer": "10.0.0.5",
        "x-shredit-surface": "onion",
      },
    });

    expect(trustedIngressSurface(direct)).toBeNull();
    expect(surfaceForTarget(direct, trustedIngressSurface(direct))).toBeNull();
    expect(surfaceForRequest(direct, trustedIngressSurface(direct))).toBeNull();
    expect(trustedIngressSurface(trusted)).toBe("onion");
    expect(surfaceForTarget(trusted, trustedIngressSurface(trusted))).toBe(
      "onion",
    );
    expect(surfaceForRequest(trusted, trustedIngressSurface(trusted))).toBe(
      "onion",
    );
  });
});
