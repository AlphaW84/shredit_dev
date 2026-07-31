import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getSecurityText } from "@/app/.well-known/security.txt/route";
import { getEnv, resetEnvForTests } from "@/lib/config/env";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PUBLIC_BASE_URL", "https://shredit.dev");
  vi.stubEnv("SECURITY_CONTACT", "mailto:security@shredit.dev");
  vi.stubEnv("SECURITY_POLICY_URL", "https://shredit.dev/security");
  resetEnvForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("public security routes", () => {
  it("serves a canonical no-store RFC 9116 policy with a future expiry", async () => {
    const before = Date.now();
    const response = getSecurityText();
    const body = await response.text();
    const expires = /^Expires: (.+)$/mu.exec(body)?.[1];

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toContain("Contact: mailto:security@shredit.dev\r\n");
    expect(body).toContain("Policy: https://shredit.dev/security\r\n");
    expect(body).toContain(
      "Canonical: https://shredit.dev/.well-known/security.txt\r\n",
    );
    expect(expires).toBeDefined();
    expect(Date.parse(expires as string)).toBeGreaterThan(before);
  });

  it("rejects line breaks and non-public schemes in contact configuration", () => {
    vi.stubEnv(
      "SECURITY_CONTACT",
      "mailto:security@shredit.dev\nCanonical: https://attacker.invalid",
    );
    resetEnvForTests();
    expect(() => getEnv()).toThrow(/Invalid environment configuration/u);

    vi.stubEnv("SECURITY_CONTACT", "file:///operator/secret");
    resetEnvForTests();
    expect(() => getEnv()).toThrow(/Invalid environment configuration/u);
  });
});
