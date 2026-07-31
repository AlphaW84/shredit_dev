import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeBase64Url } from "@/lib/crypto/base64url";

const routeMocks = vi.hoisted(() => ({
  checkReplay: vi.fn(),
  hasNoteIdCollision: vi.fn(),
  create: vi.fn(),
  consume: vi.fn(),
  metadata: vi.fn(),
  consumeClearnetCreateLimit: vi.fn(),
  consumeOnionCreateQuota: vi.fn(),
  consumePowChallengeIssuanceLimit: vi.fn(),
  consumeProtectedOpenLimit: vi.fn(),
  withCreateIdempotencyLock: vi.fn(),
  verifyTurnstile: vi.fn(),
  verifyPowSolution: vi.fn(),
  issuePowChallenge: vi.fn(),
  trustedClientIp: vi.fn(),
  trustedIngressSurface: vi.fn(),
}));

vi.mock("@/lib/note-store", () => ({
  noteStore: {
    checkReplay: routeMocks.checkReplay,
    hasNoteIdCollision: routeMocks.hasNoteIdCollision,
    create: routeMocks.create,
    consume: routeMocks.consume,
    metadata: routeMocks.metadata,
  },
}));

vi.mock("@/lib/rate-limit/valkey", () => ({
  consumeClearnetCreateLimit: routeMocks.consumeClearnetCreateLimit,
  consumeOnionCreateQuota: routeMocks.consumeOnionCreateQuota,
  consumePowChallengeIssuanceLimit: routeMocks.consumePowChallengeIssuanceLimit,
  consumeProtectedOpenLimit: routeMocks.consumeProtectedOpenLimit,
  withCreateIdempotencyLock: routeMocks.withCreateIdempotencyLock,
}));

vi.mock("@/lib/anti-abuse/turnstile", () => ({
  verifyTurnstile: routeMocks.verifyTurnstile,
}));
vi.mock("@/lib/anti-abuse/pow", () => ({
  verifyPowSolution: routeMocks.verifyPowSolution,
  issuePowChallenge: routeMocks.issuePowChallenge,
}));
vi.mock("@/lib/anti-abuse/request-context", () => ({
  trustedClientIp: routeMocks.trustedClientIp,
  trustedIngressSurface: routeMocks.trustedIngressSurface,
}));

import { resetEnvForTests } from "@/lib/config/env";
import { POST as createNote } from "@/app/api/v1/notes/route";
import { POST as openNote } from "@/app/api/v1/notes/[id]/open/route";
import { POST as createPowChallenge } from "@/app/api/v1/anti-abuse/pow-challenge/route";
import { GET as getNoteMetadata } from "@/app/api/v1/notes/[id]/meta/route";

const CLEARNET_ORIGIN = "https://shredit.dev";
const ONION_ORIGIN = "http://shreditintegrationtest.onion";
const NOTE_ID = encodeBase64Url(new Uint8Array(24));
const IDEMPOTENCY_KEY = encodeBase64Url(new Uint8Array(24).fill(1));
const IV = encodeBase64Url(new Uint8Array(12));
const CIPHERTEXT = encodeBase64Url(new Uint8Array(16));
const POW_DIGEST = encodeBase64Url(new Uint8Array(32));

function requestFor(
  origin: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createRequest(
  origin = CLEARNET_ORIGIN,
  extra: Record<string, unknown> = {},
): Request {
  return requestFor(
    origin,
    "/api/v1/notes",
    {
      id: NOTE_ID,
      protocolVersion: 1,
      iv: IV,
      ciphertext: CIPHERTEXT,
      expiresIn: "7d",
      ...extra,
    },
    { "Idempotency-Key": IDEMPOTENCY_KEY },
  );
}

async function responseCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PUBLIC_BASE_URL", CLEARNET_ORIGIN);
  vi.stubEnv("ONION_URL", ONION_ORIGIN);
  vi.stubEnv("IDEMPOTENCY_HMAC_SECRET", "route-test-idempotency-secret");
  resetEnvForTests();

  routeMocks.checkReplay.mockResolvedValue({ kind: "missing" });
  routeMocks.hasNoteIdCollision.mockResolvedValue(false);
  routeMocks.create.mockResolvedValue({
    kind: "created",
    id: NOTE_ID,
    expiresAt: null,
  });
  routeMocks.consume.mockResolvedValue({
    kind: "success",
    protocolVersion: 1,
    id: NOTE_ID,
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(16),
  });
  routeMocks.metadata.mockResolvedValue({ requiresPassword: false });
  routeMocks.consumeClearnetCreateLimit.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    remaining: 9,
    cost: 1,
  });
  routeMocks.consumeOnionCreateQuota.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    remaining: 19,
    cost: 1,
  });
  routeMocks.consumePowChallengeIssuanceLimit.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    remaining: 19,
    cost: 1,
  });
  routeMocks.consumeProtectedOpenLimit.mockResolvedValue({
    allowed: true,
    retryAfterSeconds: 0,
    remaining: 4,
    cost: 1,
  });
  routeMocks.withCreateIdempotencyLock.mockImplementation(
    async (_digest: Uint8Array, operation: () => Promise<Response>) =>
      operation(),
  );
  routeMocks.verifyTurnstile.mockResolvedValue(true);
  routeMocks.verifyPowSolution.mockResolvedValue(true);
  routeMocks.issuePowChallenge.mockResolvedValue({
    version: 1,
    challengeId: encodeBase64Url(new Uint8Array(16)),
    expiresAtUnix: 2_000_000_000,
    difficultyBits: 18,
    surface: "onion",
    payloadDigest: POW_DIGEST,
    signature: encodeBase64Url(new Uint8Array(32)),
  });
  routeMocks.trustedClientIp.mockReturnValue("203.0.113.7");
  routeMocks.trustedIngressSurface.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("create route anti-abuse ordering", () => {
  it("checks replay and note collision before quota and token verification", async () => {
    const response = await createNote(createRequest());

    expect(response.status).toBe(201);
    expect(routeMocks.checkReplay.mock.invocationCallOrder[0]).toBeLessThan(
      routeMocks.hasNoteIdCollision.mock.invocationCallOrder[0],
    );
    expect(
      routeMocks.hasNoteIdCollision.mock.invocationCallOrder[0],
    ).toBeLessThan(
      routeMocks.consumeClearnetCreateLimit.mock.invocationCallOrder[0],
    );
    expect(
      routeMocks.consumeClearnetCreateLimit.mock.invocationCallOrder[0],
    ).toBeLessThan(routeMocks.verifyTurnstile.mock.invocationCallOrder[0]);
    expect(routeMocks.verifyTurnstile.mock.invocationCallOrder[0]).toBeLessThan(
      routeMocks.create.mock.invocationCallOrder[0],
    );
  });

  it("returns an exact replay without consuming quota or a one-use token", async () => {
    const expiresAt = new Date("2026-08-02T00:00:00.000Z");
    routeMocks.checkReplay.mockResolvedValue({
      kind: "replay",
      id: NOTE_ID,
      expiresAt,
    });

    const response = await createNote(createRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Idempotent-Replay")).toBe("true");
    expect(await response.json()).toEqual({
      id: NOTE_ID,
      expiresAt: expiresAt.toISOString(),
    });
    expect(routeMocks.hasNoteIdCollision).not.toHaveBeenCalled();
    expect(routeMocks.consumeClearnetCreateLimit).not.toHaveBeenCalled();
    expect(routeMocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(routeMocks.create).not.toHaveBeenCalled();
  });

  it("rejects a note-ID collision before consuming anti-abuse state", async () => {
    routeMocks.hasNoteIdCollision.mockResolvedValue(true);

    const response = await createNote(createRequest());
    expect(response.status).toBe(409);
    expect(await responseCode(response)).toBe("NOTE_ID_CONFLICT");
    expect(routeMocks.consumeClearnetCreateLimit).not.toHaveBeenCalled();
    expect(routeMocks.verifyTurnstile).not.toHaveBeenCalled();
  });

  it("rejects an idempotency-key conflict before consuming anti-abuse state", async () => {
    routeMocks.checkReplay.mockResolvedValue({ kind: "idempotency-conflict" });

    const response = await createNote(createRequest());
    expect(response.status).toBe(409);
    expect(await responseCode(response)).toBe("IDEMPOTENCY_CONFLICT");
    expect(routeMocks.hasNoteIdCollision).not.toHaveBeenCalled();
    expect(routeMocks.consumeClearnetCreateLimit).not.toHaveBeenCalled();
    expect(routeMocks.verifyTurnstile).not.toHaveBeenCalled();
  });

  it("maps a denied create quota to 429 with Retry-After", async () => {
    routeMocks.consumeClearnetCreateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 37,
      remaining: 0,
      cost: 1,
    });

    const response = await createNote(createRequest());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("37");
    expect(await responseCode(response)).toBe("RATE_LIMITED");
    expect(routeMocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(routeMocks.create).not.toHaveBeenCalled();
  });

  it("maps database and Valkey failures to 503", async () => {
    routeMocks.checkReplay.mockRejectedValueOnce(new Error("postgres down"));
    const databaseResponse = await createNote(createRequest());
    expect(databaseResponse.status).toBe(503);
    expect(await responseCode(databaseResponse)).toBe("DEPENDENCY_UNAVAILABLE");

    routeMocks.consumeClearnetCreateLimit.mockRejectedValueOnce(
      new Error("valkey down"),
    );
    const valkeyResponse = await createNote(createRequest());
    expect(valkeyResponse.status).toBe(503);
    expect(await responseCode(valkeyResponse)).toBe("DEPENDENCY_UNAVAILABLE");

    routeMocks.create.mockRejectedValueOnce(
      new Error("postgres transaction failed"),
    );
    const createResponse = await createNote(createRequest());
    expect(createResponse.status).toBe(503);
    expect(await responseCode(createResponse)).toBe("DEPENDENCY_UNAVAILABLE");
  });

  it("awaits onion PoW before charging the weighted quota", async () => {
    const response = await createNote(
      createRequest(ONION_ORIGIN, {
        pow: { challenge: "signed-challenge", nonce: "work-nonce" },
      }),
    );

    expect(response.status).toBe(201);
    expect(routeMocks.verifyTurnstile).not.toHaveBeenCalled();
    expect(routeMocks.verifyPowSolution).toHaveBeenCalledOnce();
    expect(routeMocks.consumeOnionCreateQuota).toHaveBeenCalledWith(16);
    expect(
      routeMocks.verifyPowSolution.mock.invocationCallOrder[0],
    ).toBeLessThan(
      routeMocks.consumeOnionCreateQuota.mock.invocationCallOrder[0],
    );
  });

  it("maps a denied onion quota to 429 after validating PoW", async () => {
    routeMocks.consumeOnionCreateQuota.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 52,
      remaining: 0,
      cost: 1,
    });
    const response = await createNote(
      createRequest(ONION_ORIGIN, {
        pow: { challenge: "signed-challenge", nonce: "work-nonce" },
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("52");
    expect(await responseCode(response)).toBe("RATE_LIMITED");
    expect(routeMocks.create).not.toHaveBeenCalled();
  });

  it("serializes concurrent onion replays before consuming one-use anti-abuse state", async () => {
    const lockTails = new Map<string, Promise<void>>();
    routeMocks.withCreateIdempotencyLock.mockImplementation(
      async (digest: Uint8Array, operation: () => Promise<Response>) => {
        const key = Buffer.from(digest).toString("hex");
        const previous = lockTails.get(key) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const tail = previous.then(() => gate);
        lockTails.set(key, tail);
        await previous;
        try {
          return await operation();
        } finally {
          release();
          if (lockTails.get(key) === tail) lockTails.delete(key);
        }
      },
    );

    let created = false;
    routeMocks.checkReplay.mockImplementation(async () =>
      created
        ? { kind: "replay", id: NOTE_ID, expiresAt: null }
        : { kind: "missing" },
    );
    routeMocks.create.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      created = true;
      return { kind: "created", id: NOTE_ID, expiresAt: null };
    });

    const pow = { challenge: "signed-challenge", nonce: "work-nonce" };
    const responses = await Promise.all([
      createNote(createRequest(ONION_ORIGIN, { pow })),
      createNote(createRequest(ONION_ORIGIN, { pow })),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    expect(
      responses.filter(
        (response) => response.headers.get("Idempotent-Replay") === "true",
      ),
    ).toHaveLength(1);
    expect(routeMocks.verifyPowSolution).toHaveBeenCalledOnce();
    expect(routeMocks.consumeOnionCreateQuota).toHaveBeenCalledOnce();
    expect(routeMocks.create).toHaveBeenCalledOnce();
  });
});

describe("open, metadata, and PoW dependency behavior", () => {
  it("throttles protected-open attempts before accessing the note", async () => {
    routeMocks.consumeProtectedOpenLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 91,
      remaining: 0,
      cost: 1,
    });
    const request = requestFor(
      CLEARNET_ORIGIN,
      `/api/v1/notes/${NOTE_ID}/open`,
      { password: "password123" },
    );

    const response = await openNote(request, {
      params: Promise.resolve({ id: NOTE_ID }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("91");
    expect(await responseCode(response)).toBe("PASSWORD_THROTTLED");
    expect(routeMocks.consume).not.toHaveBeenCalled();
  });

  it("keeps passwordless opens independent of Valkey and maps store failures to 503", async () => {
    routeMocks.consume.mockRejectedValue(new Error("postgres down"));
    const request = requestFor(
      CLEARNET_ORIGIN,
      `/api/v1/notes/${NOTE_ID}/open`,
      {},
    );

    const response = await openNote(request, {
      params: Promise.resolve({ id: NOTE_ID }),
    });
    expect(response.status).toBe(503);
    expect(await responseCode(response)).toBe("DEPENDENCY_UNAVAILABLE");
    expect(routeMocks.consumeProtectedOpenLimit).not.toHaveBeenCalled();
  });

  it("maps protected-open Valkey failure to 503 without consuming", async () => {
    routeMocks.consumeProtectedOpenLimit.mockRejectedValue(
      new Error("valkey down"),
    );
    const request = requestFor(
      CLEARNET_ORIGIN,
      `/api/v1/notes/${NOTE_ID}/open`,
      { password: "password123" },
    );

    const response = await openNote(request, {
      params: Promise.resolve({ id: NOTE_ID }),
    });
    expect(response.status).toBe(503);
    expect(await responseCode(response)).toBe("DEPENDENCY_UNAVAILABLE");
    expect(routeMocks.consume).not.toHaveBeenCalled();
  });

  it("awaits PoW challenge storage and maps its failure to 503", async () => {
    const request = requestFor(
      ONION_ORIGIN,
      "/api/v1/anti-abuse/pow-challenge",
      {
        surface: "onion",
        payloadDigest: POW_DIGEST,
      },
    );
    const success = await createPowChallenge(request);
    expect(success.status).toBe(200);
    expect(routeMocks.issuePowChallenge).toHaveBeenCalledOnce();

    routeMocks.issuePowChallenge.mockRejectedValueOnce(
      new Error("valkey down"),
    );
    const failure = await createPowChallenge(
      requestFor(ONION_ORIGIN, "/api/v1/anti-abuse/pow-challenge", {
        surface: "onion",
        payloadDigest: POW_DIGEST,
      }),
    );
    expect(failure.status).toBe(503);
    expect(await responseCode(failure)).toBe("DEPENDENCY_UNAVAILABLE");
  });

  it("maps metadata database failure to 503", async () => {
    routeMocks.metadata.mockRejectedValue(new Error("postgres down"));
    const response = await getNoteMetadata(
      new Request(`${CLEARNET_ORIGIN}/api/v1/notes/${NOTE_ID}/meta`),
      { params: Promise.resolve({ id: NOTE_ID }) },
    );

    expect(response.status).toBe(503);
    expect(await responseCode(response)).toBe("DEPENDENCY_UNAVAILABLE");
  });
});
