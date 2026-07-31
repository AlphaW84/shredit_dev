import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createNote } from "@/app/api/v1/notes/route";
import { GET as getNoteMetadata } from "@/app/api/v1/notes/[id]/meta/route";
import { POST as openNote } from "@/app/api/v1/notes/[id]/open/route";
import { resetEnvForTests } from "@/lib/config/env";
import { encodeBase64Url } from "@/lib/crypto/base64url";
import { noteStore } from "@/lib/note-store";
import { resetEphemeralAntiAbuseState } from "@/lib/rate-limit/valkey";

const CLEARNET_ORIGIN = "http://127.0.0.1:3232";
const ONION_ORIGIN = "http://shreditintegrationtest.onion";

type CreateFixture = {
  body: {
    id: string;
    protocolVersion: 1;
    iv: string;
    ciphertext: string;
    expiresIn: "1h" | "7d" | "never";
    password?: string;
  };
  idempotencyKey: string;
};

function bytes(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index) & 0xff);
}

function createFixture(
  seed: number,
  options: {
    ciphertextBytes?: number;
    password?: string;
    expiresIn?: CreateFixture["body"]["expiresIn"];
  } = {},
): CreateFixture {
  return {
    body: {
      id: encodeBase64Url(bytes(24, seed)),
      protocolVersion: 1,
      iv: encodeBase64Url(bytes(12, seed + 32)),
      ciphertext: encodeBase64Url(
        bytes(options.ciphertextBytes ?? 16, seed + 64),
      ),
      expiresIn: options.expiresIn ?? "7d",
      ...(options.password ? { password: options.password } : {}),
    },
    idempotencyKey: encodeBase64Url(bytes(24, seed + 96)),
  };
}

function createRequest(
  fixture: CreateFixture,
  options: { target?: string; origin?: string | null } = {},
): Request {
  const target = options.target ?? CLEARNET_ORIGIN;
  const headers = new Headers({
    "Content-Type": "application/json",
    "Idempotency-Key": fixture.idempotencyKey,
  });
  if (options.origin !== null) headers.set("Origin", options.origin ?? target);
  return new Request(`${target}/api/v1/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify(fixture.body),
  });
}

function openRequest(id: string, body: { password?: string } = {}): Request {
  return new Request(`${CLEARNET_ORIGIN}/api/v1/notes/${id}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: CLEARNET_ORIGIN },
    body: JSON.stringify(body),
  });
}

async function open(
  id: string,
  body: { password?: string } = {},
): Promise<Response> {
  return openNote(openRequest(id, body), { params: Promise.resolve({ id }) });
}

async function metadata(id: string): Promise<Response> {
  return getNoteMetadata(
    new Request(`${CLEARNET_ORIGIN}/api/v1/notes/${id}/meta`),
    {
      params: Promise.resolve({ id }),
    },
  );
}

beforeEach(async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("SHREDIT_LOCAL_EPHEMERAL", "true");
  vi.stubEnv("PUBLIC_BASE_URL", CLEARNET_ORIGIN);
  vi.stubEnv("ONION_URL", ONION_ORIGIN);
  vi.stubEnv("TURNSTILE_ENABLED", "false");
  vi.stubEnv("IDEMPOTENCY_HMAC_SECRET", "integration-idempotency-secret");
  vi.stubEnv("IP_HASH_SECRET", "integration-ip-secret");
  vi.stubEnv("POW_SECRET", "integration-pow-secret");
  vi.stubEnv("CREATE_LIMIT_PER_IP_HOUR", "50");
  vi.stubEnv("CREATE_LIMIT_PER_IP_DAY", "50");
  vi.stubEnv("PASSWORD_FAILURE_LIMIT_PER_NOTE_15M", "5");
  vi.stubEnv("PASSWORD_FAILURE_LIMIT_PER_IP_HOUR", "50");
  vi.stubEnv("MAX_ACTIVE_NOTE_BYTES", "1048576");
  vi.stubEnv("MAX_ACTIVE_NOTE_COUNT", "100");
  vi.stubEnv("ARGON2_MEMORY_KIB", "8192");
  vi.stubEnv("ARGON2_TIME_COST", "1");
  resetEnvForTests();
  resetEphemeralAntiAbuseState();
  await noteStore.resetForTests();
});

afterEach(async () => {
  vi.useRealTimers();
  await noteStore.resetForTests();
  resetEphemeralAntiAbuseState();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("note API integration", () => {
  it("serializes concurrent exact creates without charging a second quota token", async () => {
    vi.stubEnv("CREATE_LIMIT_PER_IP_HOUR", "1");
    vi.stubEnv("CREATE_LIMIT_PER_IP_DAY", "1");
    resetEnvForTests();
    const fixture = createFixture(1);

    const concurrent = await Promise.all([
      createNote(createRequest(fixture)),
      createNote(createRequest(fixture)),
    ]);
    const created = concurrent.find((response) => response.status === 201);
    const replayed = concurrent.find((response) => response.status === 200);
    const nextCreate = await createNote(createRequest(createFixture(2)));

    expect(concurrent.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    if (!created || !replayed)
      throw new Error("Expected one create and one replay response");
    expect(replayed.headers.get("Idempotent-Replay")).toBe("true");
    await expect(replayed.json()).resolves.toEqual(await created.json());
    expect(nextCreate.status).toBe(429);
  });

  it("allows exactly one concurrent passwordless open", async () => {
    const fixture = createFixture(3);
    expect((await createNote(createRequest(fixture))).status).toBe(201);
    expect((await metadata(fixture.body.id)).status).toBe(200);

    const responses = await Promise.all([
      open(fixture.body.id),
      open(fixture.body.id),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 404,
    ]);
    const successful = responses.find((response) => response.status === 200);
    await expect(successful?.json()).resolves.toMatchObject({
      id: fixture.body.id,
      protocolVersion: 1,
      iv: fixture.body.iv,
      ciphertext: fixture.body.ciphertext,
    });
    expect((await metadata(fixture.body.id)).status).toBe(404);
  });

  it("does not consume a protected note after a wrong password", async () => {
    const fixture = createFixture(4, {
      password: "correct horse battery staple",
    });
    expect((await createNote(createRequest(fixture))).status).toBe(201);
    await expect((await metadata(fixture.body.id)).json()).resolves.toEqual({
      requiresPassword: true,
    });

    const wrong = await open(fixture.body.id, {
      password: "incorrect password",
    });
    expect(wrong.status).toBe(404);
    expect((await metadata(fixture.body.id)).status).toBe(200);

    const correct = await open(fixture.body.id, {
      password: fixture.body.password,
    });
    expect(correct.status).toBe(200);
    expect(
      (await open(fixture.body.id, { password: fixture.body.password })).status,
    ).toBe(404);
  });

  it("enforces expiry on read without waiting for cleanup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00.000Z"));
    const fixture = createFixture(5, { expiresIn: "1h" });
    expect((await createNote(createRequest(fixture))).status).toBe(201);

    vi.setSystemTime(new Date("2026-07-26T13:00:00.001Z"));
    expect((await metadata(fixture.body.id)).status).toBe(404);
    expect((await open(fixture.body.id)).status).toBe(404);
  });

  it("rolls back a rejected capacity reservation and accepts the next note", async () => {
    vi.stubEnv("MAX_ACTIVE_NOTE_BYTES", "20");
    resetEnvForTests();
    const rejected = await createNote(
      createRequest(createFixture(6, { ciphertextBytes: 21 })),
    );
    const accepted = await createNote(
      createRequest(createFixture(7, { ciphertextBytes: 16 })),
    );

    expect(rejected.status).toBe(507);
    expect(accepted.status).toBe(201);
    await expect(noteStore.stats()).resolves.toEqual({
      activeNoteCount: 1,
      activePayloadBytes: 16,
    });
  });

  it("accepts the maximum 64 KiB plaintext ciphertext envelope", async () => {
    const fixture = createFixture(8, { ciphertextBytes: 65_552 });
    const response = await createNote(createRequest(fixture));
    expect(response.status).toBe(201);
    expect((await open(fixture.body.id)).status).toBe(200);
  });

  it("requires the Origin to match the configured destination surface", async () => {
    const fixture = createFixture(9);
    const missing = await createNote(createRequest(fixture, { origin: null }));
    const clearnetMismatch = await createNote(
      createRequest(fixture, { origin: ONION_ORIGIN }),
    );
    const onionMismatch = await createNote(
      createRequest(fixture, { target: ONION_ORIGIN, origin: CLEARNET_ORIGIN }),
    );
    const valid = await createNote(createRequest(fixture));

    expect(missing.status).toBe(403);
    expect(clearnetMismatch.status).toBe(403);
    expect(onionMismatch.status).toBe(403);
    expect(valid.status).toBe(201);
  });
});
