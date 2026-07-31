import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertWebCryptoCapability,
  decryptNote,
  encryptNote,
  parseNoteLocation,
  toBase64Url,
} from "@/lib/client-crypto";
import {
  classifyPreparedRequestFailure,
  postOpenNoteAfterCryptoPreflight,
  preparedRequestAfterCreateFailure,
  preparedRequestForAntiAbuseRefresh,
  type PreparedRequest,
} from "@/components/shredit-ui";

const NOTE_ID = toBase64Url(new Uint8Array(24).fill(7));
const OTHER_NOTE_ID = toBase64Url(new Uint8Array(24).fill(8));
const KEY = toBase64Url(new Uint8Array(32).fill(9));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client AES-GCM protocol", () => {
  it("passes the deterministic WebCrypto capability preflight", async () => {
    await expect(assertWebCryptoCapability()).resolves.toBeUndefined();
  });

  it("round-trips UTF-8 plaintext with AES-256-GCM", async () => {
    const plaintext = "Read once. \u79c1\u5bc6\u30e1\u30e2.";
    const encrypted = await encryptNote(NOTE_ID, plaintext);

    await expect(
      decryptNote(NOTE_ID, encrypted.key, encrypted.iv, encrypted.ciphertext),
    ).resolves.toBe(plaintext);
  });

  it("rejects ciphertext when the note ID changes the authenticated data", async () => {
    const encrypted = await encryptNote(NOTE_ID, "bound to one note ID");

    await expect(
      decryptNote(
        OTHER_NOTE_ID,
        encrypted.key,
        encrypted.iv,
        encrypted.ciphertext,
      ),
    ).rejects.toThrow();
  });

  it("rejects a malformed AES key", async () => {
    const encrypted = await encryptNote(NOTE_ID, "secret");
    const shortKey = toBase64Url(new Uint8Array(31));

    await expect(
      decryptNote(NOTE_ID, shortKey, encrypted.iv, encrypted.ciphertext),
    ).rejects.toThrow("malformed-payload");
  });
});

describe("note fragment parsing", () => {
  it("accepts the canonical v1 note location", () => {
    expect(parseNoteLocation(`/n/${NOTE_ID}`, "", `#v1.${KEY}`)).toEqual({
      id: NOTE_ID,
      key: KEY,
    });
  });

  it("returns null for an unsupported protocol version", () => {
    expect(parseNoteLocation(`/n/${NOTE_ID}`, "", `#v2.${KEY}`)).toBeNull();
  });

  it.each([
    ["query string", `/n/${NOTE_ID}`, "?source=preview", `#v1.${KEY}`],
    ["trailing slash", `/n/${NOTE_ID}/`, "", `#v1.${KEY}`],
    ["malformed key", `/n/${NOTE_ID}`, "", "#v1.not-a-key"],
    ["noncanonical key", `/n/${NOTE_ID}`, "", `#v1.${"_".repeat(43)}`],
  ])(
    "returns null without throwing for a %s",
    (_label, pathname, search, hash) => {
      expect(() => parseNoteLocation(pathname, search, hash)).not.toThrow();
      expect(parseNoteLocation(pathname, search, hash)).toBeNull();
    },
  );
});

describe("destructive open preflight", () => {
  it("does not send the consume request when WebCrypto is unavailable", async () => {
    vi.stubGlobal("crypto", { getRandomValues: vi.fn() });
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));

    await expect(
      postOpenNoteAfterCryptoPreflight(NOTE_ID, "", fetcher),
    ).rejects.toThrow("crypto-unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("prepared create request retry policy", () => {
  it.each([
    [409, "IDEMPOTENCY_CONFLICT"],
    [400, "INVALID_REQUEST"],
  ])("preserves the prepared request after %i %s", (status, code) => {
    expect(classifyPreparedRequestFailure(status, code)).toBe("preserve");
  });

  it("regenerates only for an explicit note ID conflict", () => {
    expect(classifyPreparedRequestFailure(409, "NOTE_ID_CONFLICT")).toBe(
      "regenerate",
    );
    expect(classifyPreparedRequestFailure(500, "NOTE_ID_CONFLICT")).toBe(
      "preserve",
    );
    expect(classifyPreparedRequestFailure(503, "NOTE_ID_CONFLICT")).toBe(
      "refresh-proof",
    );
  });

  it("refreshes proof material for retryable responses that may consume it", () => {
    expect(classifyPreparedRequestFailure(403, "ANTI_ABUSE_FAILED")).toBe(
      "refresh-proof",
    );
    expect(classifyPreparedRequestFailure(429, "RATE_LIMITED")).toBe(
      "refresh-proof",
    );
    expect(classifyPreparedRequestFailure(503, "DEPENDENCY_UNAVAILABLE")).toBe(
      "refresh-proof",
    );
    expect(classifyPreparedRequestFailure(507, "STORAGE_FULL")).toBe(
      "refresh-proof",
    );
    expect(classifyPreparedRequestFailure(507)).toBe("refresh-proof");
    expect(classifyPreparedRequestFailure("network")).toBe("refresh-proof");
  });

  it.each([
    [429, "RATE_LIMITED"],
    [503, "DEPENDENCY_UNAVAILABLE"],
    [507, "STORAGE_FULL"],
  ])(
    "keeps the core request, AES key, and idempotency key while refreshing proof after %i %s",
    (status, code) => {
      const body = {
        id: NOTE_ID,
        protocolVersion: 1,
        iv: "fixed-iv",
        ciphertext: "fixed-ciphertext",
        expiresIn: "7d",
        password: "fixed-password",
        turnstileToken: "one-use-token",
        pow: { challenge: "one-use-challenge", nonce: "nonce" },
      };
      const prepared: PreparedRequest = {
        body,
        id: NOTE_ID,
        key: KEY,
        idempotencyKey: "fixed-idempotency-key",
      };

      const retained = preparedRequestAfterCreateFailure(
        prepared,
        status,
        code,
      );
      expect(retained).not.toBe(prepared);
      expect(retained?.id).toBe(prepared.id);
      expect(retained?.body).toMatchObject({
        id: NOTE_ID,
        protocolVersion: 1,
        iv: "fixed-iv",
        ciphertext: "fixed-ciphertext",
        expiresIn: "7d",
        password: "fixed-password",
      });
      expect(retained?.body).not.toHaveProperty("turnstileToken");
      expect(retained?.body).not.toHaveProperty("pow");
      expect(retained?.key).toBe(KEY);
      expect(retained?.idempotencyKey).toBe("fixed-idempotency-key");
      expect(retained?.antiAbuseRefreshRequired).toBe(true);
    },
  );

  it("keeps the core request after an ambiguous create network failure", () => {
    const prepared: PreparedRequest = {
      body: {
        id: NOTE_ID,
        protocolVersion: 1,
        iv: "fixed-iv",
        ciphertext: "fixed-ciphertext",
        expiresIn: "never",
        turnstileToken: "one-use-token",
      },
      id: NOTE_ID,
      key: KEY,
      idempotencyKey: "fixed-idempotency-key",
    };

    const retained = preparedRequestAfterCreateFailure(prepared, "network");
    expect(retained).toEqual({
      ...prepared,
      body: {
        id: NOTE_ID,
        protocolVersion: 1,
        iv: "fixed-iv",
        ciphertext: "fixed-ciphertext",
        expiresIn: "never",
      },
      antiAbuseRefreshRequired: true,
    });
  });

  it("refreshes only anti-abuse proof material after proof rejection", () => {
    const prepared: PreparedRequest = {
      body: {
        id: NOTE_ID,
        protocolVersion: 1,
        iv: "fixed-iv",
        ciphertext: "fixed-ciphertext",
        expiresIn: "7d",
        turnstileToken: "one-use-token",
        pow: { challenge: "one-use-challenge", nonce: "nonce" },
      },
      id: NOTE_ID,
      key: KEY,
      idempotencyKey: "fixed-idempotency-key",
    };

    const refreshed = preparedRequestForAntiAbuseRefresh(prepared);
    expect(refreshed.id).toBe(prepared.id);
    expect(refreshed.key).toBe(prepared.key);
    expect(refreshed.idempotencyKey).toBe(prepared.idempotencyKey);
    expect(refreshed.body.ciphertext).toBe(prepared.body.ciphertext);
    expect(refreshed.body).not.toHaveProperty("turnstileToken");
    expect(refreshed.body).not.toHaveProperty("pow");
    expect(refreshed.antiAbuseRefreshRequired).toBe(true);
  });
});
