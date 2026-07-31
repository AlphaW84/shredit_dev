import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issuePowChallenge, verifyPowSolution } from "@/lib/anti-abuse/pow";
import { resetEnvForTests } from "@/lib/config/env";
import { decodeBase64Url, encodeBase64Url } from "@/lib/crypto/base64url";
import {
  ValkeyUnavailableError,
  closeValkey,
  consumeClearnetCreateLimit,
  consumeOnionCreateQuota,
  consumePowChallengeIssuanceLimit,
  consumeProtectedOpenLimit,
  normalizeClientIp,
  resetEphemeralAntiAbuseState,
  withCreateIdempotencyLock,
} from "@/lib/rate-limit/valkey";

const ENV_KEYS = [
  "VALKEY_URL",
  "SHREDIT_LOCAL_EPHEMERAL",
  "IP_HASH_SECRET",
  "IP_HASH_SECRET_PREVIOUS",
  "POW_SECRET",
  "POW_DIFFICULTY_BITS",
  "CREATE_LIMIT_PER_IP_HOUR",
  "CREATE_LIMIT_PER_IP_DAY",
  "PASSWORD_FAILURE_LIMIT_PER_NOTE_15M",
  "PASSWORD_FAILURE_LIMIT_PER_IP_HOUR",
  "ONION_TOKENS_PER_HOUR",
  "ONION_TOKENS_PER_DAY",
  "ONION_TOKEN_BURST",
  "ONION_TOKEN_BYTES",
] as const;

const originalEnv = new Map(
  ENV_KEYS.map((key) => [key, process.env[key]] as const),
);

function configureEphemeral(overrides: Record<string, string> = {}): void {
  delete process.env.VALKEY_URL;
  process.env.SHREDIT_LOCAL_EPHEMERAL = "true";
  process.env.IP_HASH_SECRET = "anti-abuse-test-ip-secret";
  delete process.env.IP_HASH_SECRET_PREVIOUS;
  process.env.POW_SECRET = "anti-abuse-test-pow-secret";
  process.env.POW_DIFFICULTY_BITS = "0";
  process.env.CREATE_LIMIT_PER_IP_HOUR = "2";
  process.env.CREATE_LIMIT_PER_IP_DAY = "3";
  process.env.PASSWORD_FAILURE_LIMIT_PER_NOTE_15M = "2";
  process.env.PASSWORD_FAILURE_LIMIT_PER_IP_HOUR = "3";
  process.env.ONION_TOKENS_PER_HOUR = "10";
  process.env.ONION_TOKENS_PER_DAY = "20";
  process.env.ONION_TOKEN_BURST = "2";
  process.env.ONION_TOKEN_BYTES = "8";
  Object.assign(process.env, overrides);
  resetEnvForTests();
}

function solveChallenge(challenge: {
  challengeId: string;
  payloadDigest: string;
  difficultyBits: number;
}): string {
  const prefix = Buffer.from("shredit:pow:v1", "utf8");
  const challengeId = Buffer.from(decodeBase64Url(challenge.challengeId, 16));
  const payloadDigest = Buffer.from(
    decodeBase64Url(challenge.payloadDigest, 32),
  );
  for (let counter = 0n; counter < 1_000_000n; counter += 1n) {
    const nonce = Buffer.alloc(8);
    nonce.writeBigUInt64BE(counter);
    const digest = createHash("sha256")
      .update(Buffer.concat([prefix, challengeId, payloadDigest, nonce]))
      .digest();
    const fullBytes = Math.floor(challenge.difficultyBits / 8);
    const remainingBits = challenge.difficultyBits % 8;
    const fullBytesPass = digest
      .subarray(0, fullBytes)
      .every((byte) => byte === 0);
    const partialBytePass =
      remainingBits === 0 ||
      (digest[fullBytes] & (0xff << (8 - remainingBits))) === 0;
    if (fullBytesPass && partialBytePass) return encodeBase64Url(nonce);
  }
  throw new Error("Unable to solve test PoW");
}

beforeEach(() => {
  configureEphemeral();
  resetEphemeralAntiAbuseState();
});

afterEach(async () => {
  await closeValkey();
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTests();
  resetEphemeralAntiAbuseState();
});

describe("Valkey anti-abuse policy", () => {
  it("canonicalizes trusted IPv4 and IPv6 values and rejects address lists", () => {
    expect(normalizeClientIp("203.0.113.7:443")).toBe("203.0.113.7");
    expect(normalizeClientIp("[2001:0DB8:0:0:0:0:0:1]:443")).toBe(
      "2001:db8::1",
    );
    expect(normalizeClientIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeClientIp("203.0.113.7, 198.51.100.4")).toBe("unknown-ip");
    expect(normalizeClientIp(undefined)).toBe("unknown-ip");
  });

  it("charges independent clearnet hourly and daily fixed windows", async () => {
    await expect(
      consumeClearnetCreateLimit("203.0.113.9"),
    ).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });
    await expect(
      consumeClearnetCreateLimit("203.0.113.9"),
    ).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
    });
    const rejected = await consumeClearnetCreateLimit("203.0.113.9");
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBeGreaterThan(0);
    await expect(
      consumeClearnetCreateLimit("203.0.113.10"),
    ).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("carries active counters across an IP-HMAC secret rotation", async () => {
    await expect(
      consumeClearnetCreateLimit("203.0.113.11"),
    ).resolves.toMatchObject({ allowed: true, remaining: 1 });

    process.env.IP_HASH_SECRET_PREVIOUS = process.env.IP_HASH_SECRET;
    process.env.IP_HASH_SECRET = "rotated-anti-abuse-test-ip-secret";
    resetEnvForTests();
    await expect(
      consumeClearnetCreateLimit("203.0.113.11"),
    ).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(
      consumeClearnetCreateLimit("203.0.113.11"),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("throttles protected opens by both note and client address", async () => {
    const note = "A".repeat(32);
    await expect(
      consumeProtectedOpenLimit({ noteId: note, clientIp: "198.51.100.8" }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      consumeProtectedOpenLimit({ noteId: note, clientIp: "198.51.100.8" }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      consumeProtectedOpenLimit({ noteId: note, clientIp: "198.51.100.8" }),
    ).resolves.toMatchObject({ allowed: false });

    resetEphemeralAntiAbuseState();
    for (const suffix of ["A", "B", "C"]) {
      await expect(
        consumeProtectedOpenLimit({
          noteId: suffix.repeat(32),
          clientIp: "198.51.100.9",
        }),
      ).resolves.toMatchObject({ allowed: true });
    }
    await expect(
      consumeProtectedOpenLimit({
        noteId: "D".repeat(32),
        clientIp: "198.51.100.9",
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("rejects a saturated IP before allocating attacker-controlled note windows", async () => {
    configureEphemeral({
      PASSWORD_FAILURE_LIMIT_PER_NOTE_15M: "2",
      PASSWORD_FAILURE_LIMIT_PER_IP_HOUR: "3",
    });
    resetEphemeralAntiAbuseState();

    const saturatedIp = "198.51.100.90";
    for (const seed of ["A", "B", "C"]) {
      await expect(
        consumeProtectedOpenLimit({
          noteId: seed.repeat(32),
          clientIp: saturatedIp,
        }),
      ).resolves.toMatchObject({ allowed: true });
    }

    let lastRejectedNoteId = "";
    for (let index = 0; index < 1_000; index += 1) {
      lastRejectedNoteId = index.toString(36).padStart(32, "0");
      await expect(
        consumeProtectedOpenLimit({
          noteId: lastRejectedNoteId,
          clientIp: saturatedIp,
        }),
      ).resolves.toMatchObject({ allowed: false });
    }

    const otherIp = "198.51.100.91";
    await expect(
      consumeProtectedOpenLimit({
        noteId: lastRejectedNoteId,
        clientIp: otherIp,
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      consumeProtectedOpenLimit({
        noteId: lastRejectedNoteId,
        clientIp: otherIp,
      }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      consumeProtectedOpenLimit({
        noteId: lastRejectedNoteId,
        clientIp: otherIp,
      }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it("charges onion payload weight and enforces the burst bucket", async () => {
    const first = await consumeOnionCreateQuota(9);
    expect(first).toMatchObject({ allowed: true, cost: 2, remaining: 0 });
    const second = await consumeOnionCreateQuota(1);
    expect(second.allowed).toBe(false);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("bounds PoW challenge issuance by source and global host windows", async () => {
    await expect(
      consumePowChallengeIssuanceLimit("198.51.100.20"),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      consumePowChallengeIssuanceLimit("198.51.100.20"),
    ).resolves.toMatchObject({ allowed: true, remaining: 0 });
    await expect(
      consumePowChallengeIssuanceLimit("198.51.100.20"),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      consumePowChallengeIssuanceLimit("198.51.100.21"),
    ).resolves.toMatchObject({ allowed: true });

    configureEphemeral({
      ONION_TOKENS_PER_HOUR: "2",
      ONION_TOKENS_PER_DAY: "20",
      ONION_TOKEN_BURST: "10",
    });
    resetEphemeralAntiAbuseState();
    await expect(
      consumePowChallengeIssuanceLimit("198.51.100.30"),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      consumePowChallengeIssuanceLimit("198.51.100.31"),
    ).resolves.toMatchObject({ allowed: true, remaining: 0 });
    const hostRejected =
      await consumePowChallengeIssuanceLimit("198.51.100.32");
    expect(hostRejected.allowed).toBe(false);
    expect(hostRejected.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("fails closed when Valkey is absent outside explicit local mode", async () => {
    process.env.SHREDIT_LOCAL_EPHEMERAL = "false";
    delete process.env.VALKEY_URL;
    resetEnvForTests();
    await expect(
      consumeClearnetCreateLimit("192.0.2.4"),
    ).rejects.toBeInstanceOf(ValkeyUnavailableError);
    await expect(
      consumePowChallengeIssuanceLimit("192.0.2.4"),
    ).rejects.toBeInstanceOf(ValkeyUnavailableError);
    await expect(
      issuePowChallenge(new Uint8Array(32), "onion"),
    ).rejects.toBeInstanceOf(ValkeyUnavailableError);
  });

  it("serializes one idempotency digest without globally blocking other digests", async () => {
    const digest = new Uint8Array(32).fill(1);
    let active = 0;
    let maximumActive = 0;
    const criticalSection = async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
    };

    await Promise.all([
      withCreateIdempotencyLock(digest, criticalSection),
      withCreateIdempotencyLock(digest, criticalSection),
    ]);
    expect(maximumActive).toBe(1);

    active = 0;
    maximumActive = 0;
    await Promise.all([
      withCreateIdempotencyLock(new Uint8Array(32).fill(2), criticalSection),
      withCreateIdempotencyLock(new Uint8Array(32).fill(3), criticalSection),
    ]);
    expect(maximumActive).toBe(2);
  });
});

describe("Valkey-backed proof of work", () => {
  it("binds the signed payload and atomically accepts a challenge once", async () => {
    configureEphemeral({ POW_DIFFICULTY_BITS: "8" });
    const payload = new Uint8Array(32).fill(7);
    const challenge = await issuePowChallenge(payload, "onion");
    const nonce = solveChallenge(challenge);

    const tampered = {
      ...challenge,
      payloadDigest: encodeBase64Url(new Uint8Array(32).fill(8)),
    };
    await expect(
      verifyPowSolution({
        challenge: JSON.stringify(tampered),
        nonce,
        expectedPayloadDigest: new Uint8Array(32).fill(8),
        expectedSurface: "onion",
      }),
    ).resolves.toBe(false);

    const encodedChallenge = JSON.stringify(challenge);
    const concurrentAttempts = await Promise.all([
      verifyPowSolution({
        challenge: encodedChallenge,
        nonce,
        expectedPayloadDigest: payload,
        expectedSurface: "onion",
      }),
      verifyPowSolution({
        challenge: encodedChallenge,
        nonce,
        expectedPayloadDigest: payload,
        expectedSurface: "onion",
      }),
    ]);
    expect(concurrentAttempts.filter(Boolean)).toHaveLength(1);
  });
});
