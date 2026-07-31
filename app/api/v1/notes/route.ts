import { decodeBase64Url } from "@/lib/crypto/base64url";
import {
  errorResponse,
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
} from "@/lib/api/errors";
import {
  readIdempotencyKey,
  readJsonBody,
  requestSurfaceOrResponse,
} from "@/lib/api/request";
import { getEnv } from "@/lib/config/env";
import { hashPassword, normalizePassword } from "@/lib/crypto/password";
import {
  expiryDate,
  idempotencyDigest,
  noteIdDigest,
  payloadDigest,
  requestFingerprint,
  type ExpirySelection,
} from "@/lib/crypto/protocol";
import { noteStore } from "@/lib/note-store";
import { createNoteSchema } from "@/lib/validation/schemas";
import { verifyPowSolution } from "@/lib/anti-abuse/pow";
import { verifyTurnstile } from "@/lib/anti-abuse/turnstile";
import { trustedClientIp } from "@/lib/anti-abuse/request-context";
import {
  consumeClearnetCreateLimit,
  consumeOnionCreateQuota,
  withCreateIdempotencyLock,
} from "@/lib/rate-limit/valkey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const ALLOWED_METHODS = ["POST", "OPTIONS"] as const;

export function GET() {
  return methodNotAllowedResponse(ALLOWED_METHODS);
}

export const HEAD = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;

export function OPTIONS() {
  return optionsResponse(ALLOWED_METHODS);
}

export async function POST(request: Request) {
  const env = getEnv();
  const surface = requestSurfaceOrResponse(request);
  if (surface instanceof Response) return surface;

  const idempotencyHeader = request.headers.get("idempotency-key");
  const idempotencyKey = readIdempotencyKey(request);
  if (idempotencyKey instanceof Response) return idempotencyKey;

  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success)
    return errorResponse("BAD_REQUEST", { retryable: false });
  const input = parsed.data;

  if (
    surface === "clearnet" &&
    input.password &&
    env.NODE_ENV === "production"
  ) {
    const publicUrl = new URL(env.PUBLIC_BASE_URL);
    const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
      publicUrl.hostname,
    );
    if (!loopback && publicUrl.protocol !== "https:")
      return errorResponse("BAD_REQUEST", { retryable: false });
  }

  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    iv = decodeBase64Url(input.iv, 12);
    ciphertext = decodeBase64Url(input.ciphertext);
  } catch {
    return errorResponse("BAD_REQUEST", { retryable: false });
  }

  const expiresIn = input.expiresIn as ExpirySelection;
  const normalizedPassword = input.password
    ? normalizePassword(input.password)
    : undefined;
  const digestSecret = env.IDEMPOTENCY_HMAC_SECRET;
  const fingerprint = requestFingerprint({
    surface,
    id: input.id,
    protocolVersion: input.protocolVersion,
    iv,
    ciphertext,
    expiresIn,
    normalizedPassword,
    secret: digestSecret,
  });
  const antiAbusePayloadDigest = payloadDigest({
    surface,
    id: input.id,
    protocolVersion: input.protocolVersion,
    iv,
    ciphertext,
    expiresIn,
  });

  const keyDigest = idempotencyDigest(
    idempotencyHeader as string,
    digestSecret,
  );
  const inputNoteIdDigest = noteIdDigest(input.id, digestSecret);
  try {
    const replay = await noteStore.checkReplay({
      id: input.id,
      keyDigest,
      fingerprint,
      surface,
    });
    if (replay.kind === "idempotency-conflict") {
      return errorResponse("IDEMPOTENCY_CONFLICT", { retryable: false });
    }
    if (replay.kind === "replay") {
      return jsonResponse(
        { id: replay.id, expiresAt: replay.expiresAt?.toISOString() ?? null },
        200,
        { "Idempotent-Replay": "true" },
      );
    }
  } catch {
    return errorResponse("DEPENDENCY_UNAVAILABLE");
  }

  try {
    return await withCreateIdempotencyLock(keyDigest, async () => {
      const replay = await noteStore.checkReplay({
        id: input.id,
        keyDigest,
        fingerprint,
        surface,
      });
      if (replay.kind === "idempotency-conflict") {
        return errorResponse("IDEMPOTENCY_CONFLICT", { retryable: false });
      }
      if (replay.kind === "replay") {
        return jsonResponse(
          { id: replay.id, expiresAt: replay.expiresAt?.toISOString() ?? null },
          200,
          { "Idempotent-Replay": "true" },
        );
      }
      if (await noteStore.hasNoteIdCollision(input.id, inputNoteIdDigest)) {
        return errorResponse("NOTE_ID_CONFLICT", { retryable: true });
      }

      if (surface === "clearnet") {
        const limit = await consumeClearnetCreateLimit(
          trustedClientIp(request),
        );
        if (!limit.allowed) {
          return errorResponse("RATE_LIMITED", {
            retryable: true,
            retryAfter: limit.retryAfterSeconds,
          });
        }
        if (!(await verifyTurnstile(input.turnstileToken, request, surface))) {
          return errorResponse("ANTI_ABUSE_FAILED", { retryable: true });
        }
      } else {
        if (!input.pow?.challenge || !input.pow.nonce) {
          return errorResponse("ANTI_ABUSE_FAILED", { retryable: true });
        }
        const validPow = await verifyPowSolution({
          challenge: input.pow.challenge,
          nonce: input.pow.nonce,
          expectedPayloadDigest: antiAbusePayloadDigest,
          expectedSurface: "onion",
        });
        if (!validPow)
          return errorResponse("ANTI_ABUSE_FAILED", { retryable: true });
        const quota = await consumeOnionCreateQuota(ciphertext.byteLength);
        if (!quota.allowed) {
          return errorResponse("RATE_LIMITED", {
            retryable: true,
            retryAfter: quota.retryAfterSeconds,
          });
        }
      }

      let passwordHash: string | undefined;
      if (normalizedPassword) {
        passwordHash = await hashPassword(normalizedPassword);
      }

      const result = await noteStore.create({
        id: input.id,
        protocolVersion: 1,
        iv,
        ciphertext,
        expiresAt: expiryDate(expiresIn),
        passwordHash,
        keyDigest,
        fingerprint,
        noteIdDigest: inputNoteIdDigest,
        surface,
      });
      if (result.kind === "idempotency-conflict")
        return errorResponse("IDEMPOTENCY_CONFLICT", { retryable: false });
      if (result.kind === "note-id-conflict")
        return errorResponse("NOTE_ID_CONFLICT", { retryable: true });
      if (result.kind === "storage-full")
        return errorResponse("STORAGE_FULL", { retryable: true });

      const response = {
        id: result.id,
        expiresAt: result.expiresAt?.toISOString() ?? null,
      };
      if (result.kind === "replay")
        return jsonResponse(response, 200, { "Idempotent-Replay": "true" });
      return jsonResponse(response, 201);
    });
  } catch {
    return errorResponse("DEPENDENCY_UNAVAILABLE");
  }
}
