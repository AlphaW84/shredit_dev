import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv, type RequestSurface } from "@/lib/config/env";
import { decodeBase64Url, encodeBase64Url } from "@/lib/crypto/base64url";
import { hmacSha256 } from "@/lib/crypto/protocol";
import {
  cleanupPowChallengeStates,
  consumePowChallengeState,
  storePowChallengeState,
} from "@/lib/rate-limit/valkey";

const POW_PREFIX = new TextEncoder().encode("shredit:pow:v1");
const CHALLENGE_TTL_SECONDS = 120;

interface ChallengeRecord {
  challengeId: string;
  payloadDigest: Uint8Array;
  surface: RequestSurface;
  expiresAtUnix: number;
  difficultyBits: number;
  signature: Uint8Array;
}

export interface PowChallenge {
  version: 1;
  challengeId: string;
  expiresAtUnix: number;
  difficultyBits: number;
  surface: RequestSurface;
  payloadDigest: string;
  signature: string;
}

function canonicalBytes(
  record: Omit<ChallengeRecord, "signature">,
): Uint8Array {
  return new TextEncoder().encode(
    `shredit:pow:v1|${record.challengeId}|${record.expiresAtUnix}|${record.difficultyBits}|${record.surface}|${encodeBase64Url(record.payloadDigest)}`,
  );
}

function stateValue(record: ChallengeRecord): string {
  return [
    "shredit:pow-state:v1",
    record.challengeId,
    String(record.expiresAtUnix),
    String(record.difficultyBits),
    record.surface,
    encodeBase64Url(record.payloadDigest),
    encodeBase64Url(record.signature),
  ].join("|");
}

function toWire(record: ChallengeRecord): PowChallenge {
  return {
    version: 1,
    challengeId: record.challengeId,
    expiresAtUnix: record.expiresAtUnix,
    difficultyBits: record.difficultyBits,
    surface: record.surface,
    payloadDigest: encodeBase64Url(record.payloadDigest),
    signature: encodeBase64Url(record.signature),
  };
}

function parseWireChallenge(value: string): PowChallenge | null {
  let candidate: unknown;
  try {
    try {
      candidate = JSON.parse(value);
    } catch {
      candidate = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    }
  } catch {
    const parts = value.split("|");
    if (parts.length !== 7 || parts[0] !== "shredit:pow:v1") return null;
    candidate = {
      version: 1,
      challengeId: parts[1],
      expiresAtUnix: Number(parts[2]),
      difficultyBits: Number(parts[3]),
      surface: parts[4],
      payloadDigest: parts[5],
      signature: parts[6],
    };
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return null;
  const challenge = candidate as Record<string, unknown>;
  if (
    challenge.version !== 1 ||
    typeof challenge.challengeId !== "string" ||
    !Number.isSafeInteger(challenge.expiresAtUnix) ||
    !Number.isSafeInteger(challenge.difficultyBits) ||
    (challenge.surface !== "clearnet" && challenge.surface !== "onion") ||
    typeof challenge.payloadDigest !== "string" ||
    typeof challenge.signature !== "string"
  ) {
    return null;
  }
  if (
    (challenge.expiresAtUnix as number) <= 0 ||
    (challenge.difficultyBits as number) < 0 ||
    (challenge.difficultyBits as number) > 256
  ) {
    return null;
  }
  return challenge as unknown as PowChallenge;
}

export async function issuePowChallenge(
  payloadDigest: Uint8Array,
  surface: RequestSurface = "onion",
): Promise<PowChallenge> {
  if (payloadDigest.byteLength !== 32)
    throw new TypeError("PoW payload digest must be exactly 32 bytes");
  const env = getEnv();
  if (
    !Number.isSafeInteger(env.POW_DIFFICULTY_BITS) ||
    env.POW_DIFFICULTY_BITS < 0 ||
    env.POW_DIFFICULTY_BITS > 256
  ) {
    throw new TypeError(
      "POW_DIFFICULTY_BITS must be an integer from 0 through 256",
    );
  }

  const digest = new Uint8Array(payloadDigest);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const challengeId = encodeBase64Url(randomBytes(16));
    const expiresAtUnix =
      Math.floor(Date.now() / 1_000) + CHALLENGE_TTL_SECONDS;
    const unsigned = {
      challengeId,
      payloadDigest: digest,
      surface,
      expiresAtUnix,
      difficultyBits: env.POW_DIFFICULTY_BITS,
    };
    const record: ChallengeRecord = {
      ...unsigned,
      signature: hmacSha256(env.POW_SECRET, canonicalBytes(unsigned)),
    };
    if (
      await storePowChallengeState(
        challengeId,
        stateValue(record),
        CHALLENGE_TTL_SECONDS,
      )
    )
      return toWire(record);
  }
  throw new Error("Unable to allocate a unique PoW challenge");
}

function hasLeadingZeroBits(digest: Uint8Array, bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);
  const remainingBits = bits % 8;
  for (let index = 0; index < fullBytes; index += 1)
    if (digest[index] !== 0) return false;
  if (remainingBits === 0) return true;
  return (digest[fullBytes] & (0xff << (8 - remainingBits))) === 0;
}

export async function verifyPowSolution(args: {
  challenge: string;
  nonce: string;
  expectedPayloadDigest: Uint8Array;
  expectedSurface: RequestSurface;
}): Promise<boolean> {
  const challenge = parseWireChallenge(args.challenge);
  if (!challenge || args.expectedPayloadDigest.byteLength !== 32) return false;

  let challengeId: Uint8Array;
  let payloadDigest: Uint8Array;
  let signature: Uint8Array;
  let nonce: Uint8Array;
  try {
    challengeId = decodeBase64Url(challenge.challengeId, 16);
    payloadDigest = decodeBase64Url(challenge.payloadDigest, 32);
    signature = decodeBase64Url(challenge.signature, 32);
    nonce = decodeBase64Url(args.nonce, 8);
  } catch {
    return false;
  }

  const unsigned = {
    challengeId: challenge.challengeId,
    payloadDigest,
    surface: challenge.surface,
    expiresAtUnix: challenge.expiresAtUnix,
    difficultyBits: challenge.difficultyBits,
  };
  const expectedSignature = hmacSha256(
    getEnv().POW_SECRET,
    canonicalBytes(unsigned),
  );
  if (!timingSafeEqual(signature, expectedSignature)) return false;
  if (challenge.expiresAtUnix <= Math.floor(Date.now() / 1_000)) return false;
  if (
    challenge.surface !== args.expectedSurface ||
    challenge.surface !== "onion"
  )
    return false;
  if (!timingSafeEqual(payloadDigest, args.expectedPayloadDigest)) return false;

  const input = new Uint8Array(
    POW_PREFIX.byteLength +
      challengeId.byteLength +
      payloadDigest.byteLength +
      nonce.byteLength,
  );
  let offset = 0;
  input.set(POW_PREFIX, offset);
  offset += POW_PREFIX.byteLength;
  input.set(challengeId, offset);
  offset += challengeId.byteLength;
  input.set(payloadDigest, offset);
  offset += payloadDigest.byteLength;
  input.set(nonce, offset);
  const workDigest = new Uint8Array(
    createHash("sha256").update(input).digest(),
  );
  if (!hasLeadingZeroBits(workDigest, challenge.difficultyBits)) return false;

  const record: ChallengeRecord = { ...unsigned, signature };
  return consumePowChallengeState(challenge.challengeId, stateValue(record));
}

/** Valkey expires production challenges itself; this only cleans explicit local ephemeral state. */
export async function cleanupPowChallenges(): Promise<number> {
  return cleanupPowChallengeStates();
}
