import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeBase64Url } from "@/lib/crypto/base64url";

const routeMocks = vi.hoisted(() => ({
  consumePowChallengeIssuanceLimit: vi.fn(),
  issuePowChallenge: vi.fn(),
  trustedClientIp: vi.fn(),
  trustedIngressSurface: vi.fn(),
}));

vi.mock("@/lib/rate-limit/valkey", () => ({
  consumePowChallengeIssuanceLimit: routeMocks.consumePowChallengeIssuanceLimit,
}));
vi.mock("@/lib/anti-abuse/pow", () => ({
  issuePowChallenge: routeMocks.issuePowChallenge,
}));
vi.mock("@/lib/anti-abuse/request-context", () => ({
  trustedClientIp: routeMocks.trustedClientIp,
  trustedIngressSurface: routeMocks.trustedIngressSurface,
}));

import { POST as createPowChallenge } from "@/app/api/v1/anti-abuse/pow-challenge/route";
import { resetEnvForTests } from "@/lib/config/env";

const ONION_ORIGIN = "http://shreditpowissuancetest.onion";
const PAYLOAD_DIGEST = encodeBase64Url(new Uint8Array(32));

function challengeRequest(): Request {
  return new Request(`${ONION_ORIGIN}/api/v1/anti-abuse/pow-challenge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ONION_ORIGIN,
    },
    body: JSON.stringify({
      surface: "onion",
      payloadDigest: PAYLOAD_DIGEST,
    }),
  });
}

async function responseCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PUBLIC_BASE_URL", "https://shredit.dev");
  vi.stubEnv("ONION_URL", ONION_ORIGIN);
  resetEnvForTests();
  routeMocks.trustedClientIp.mockReturnValue("198.51.100.40");
  routeMocks.trustedIngressSurface.mockReturnValue(null);
  routeMocks.consumePowChallengeIssuanceLimit.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    remaining: 19,
    cost: 1,
  });
  routeMocks.issuePowChallenge.mockResolvedValue({
    version: 1,
    challengeId: encodeBase64Url(new Uint8Array(16)),
    expiresAtUnix: 2_000_000_000,
    difficultyBits: 18,
    surface: "onion",
    payloadDigest: PAYLOAD_DIGEST,
    signature: encodeBase64Url(new Uint8Array(32)),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("PoW challenge issuance route limit", () => {
  it("checks the trusted client limit before allocating challenge state", async () => {
    const response = await createPowChallenge(challengeRequest());

    expect(response.status).toBe(200);
    expect(routeMocks.trustedClientIp).toHaveBeenCalledOnce();
    expect(routeMocks.consumePowChallengeIssuanceLimit).toHaveBeenCalledWith(
      "198.51.100.40",
    );
    expect(
      routeMocks.consumePowChallengeIssuanceLimit.mock.invocationCallOrder[0],
    ).toBeLessThan(routeMocks.issuePowChallenge.mock.invocationCallOrder[0]);
  });

  it("returns 429 with Retry-After without creating a challenge", async () => {
    routeMocks.consumePowChallengeIssuanceLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 73,
      remaining: 0,
      cost: 1,
    });

    const response = await createPowChallenge(challengeRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("73");
    expect(await responseCode(response)).toBe("RATE_LIMITED");
    expect(routeMocks.issuePowChallenge).not.toHaveBeenCalled();
  });

  it("fails closed on Valkey outage without creating a challenge", async () => {
    routeMocks.consumePowChallengeIssuanceLimit.mockRejectedValue(
      new Error("valkey down"),
    );

    const response = await createPowChallenge(challengeRequest());
    expect(response.status).toBe(503);
    expect(await responseCode(response)).toBe("DEPENDENCY_UNAVAILABLE");
    expect(routeMocks.issuePowChallenge).not.toHaveBeenCalled();
  });
});
