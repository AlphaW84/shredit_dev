import { describe, expect, it } from "vitest";
import {
  decodeBase64Url,
  encodeBase64Url,
  isValidNoteId,
  isValidNoteKey,
} from "@/lib/crypto/base64url";
import {
  generatePassword,
  normalizePassword,
  passwordCodePointLength,
  validatePassword,
} from "@/lib/crypto/password";
import {
  canonicalLengthPrefixed,
  payloadDigest,
  utf8ByteLength,
} from "@/lib/crypto/protocol";
import { createNoteSchema } from "@/lib/validation/schemas";

describe("base64url and protocol boundaries", () => {
  it("round-trips canonical binary values and rejects padding", () => {
    const bytes = Uint8Array.from([0, 1, 2, 250, 255]);
    const encoded = encodeBase64Url(bytes);
    expect(encoded).toBe("AAEC-v8");
    expect(decodeBase64Url(encoded)).toEqual(bytes);
    expect(() => decodeBase64Url(`${encoded}=`)).toThrow();
  });

  it("accepts only 24-byte note IDs and 32-byte keys", () => {
    expect(isValidNoteId(encodeBase64Url(new Uint8Array(24)))).toBe(true);
    expect(isValidNoteKey(encodeBase64Url(new Uint8Array(32)))).toBe(true);
    expect(isValidNoteId("!".repeat(32))).toBe(false);
    expect(isValidNoteKey("!".repeat(43))).toBe(false);
  });

  it("counts UTF-8 bytes rather than JavaScript code points", () => {
    expect(utf8ByteLength("a")).toBe(1);
    expect(utf8ByteLength("你")).toBe(3);
    expect(utf8ByteLength("😀")).toBe(4);
    expect(utf8ByteLength("😀".repeat(16_384))).toBe(65_536);
  });

  it("uses deterministic length-prefixed payload digests", () => {
    const args = {
      surface: "clearnet" as const,
      id: "A".repeat(32),
      protocolVersion: 1,
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(16),
      expiresIn: "7d" as const,
    };
    expect(payloadDigest(args)).toEqual(payloadDigest(args));
    expect(canonicalLengthPrefixed(["a", "bc"])).not.toEqual(
      canonicalLengthPrefixed(["ab", "c"]),
    );
  });
});

describe("password contract", () => {
  it("normalizes NFC without trimming and enforces code points", () => {
    expect(normalizePassword("e\u0301")).toBe("é");
    expect(normalizePassword(" pass123")).toBe(" pass123");
    expect(passwordCodePointLength("😀".repeat(8))).toBe(8);
    expect(validatePassword("😀".repeat(8))).toBe(true);
    expect(validatePassword("short")).toBe(false);
  });

  it("generates the required twenty-character password shape", () => {
    const generated = generatePassword();
    expect(generated).toHaveLength(20);
    expect(generated).toMatch(/^[A-HJ-NP-Za-km-z2-9_-]{20}$/u);
  });
});

describe("strict create schema", () => {
  it("defaults expiry and rejects unknown fields", () => {
    const valid = createNoteSchema.safeParse({
      id: encodeBase64Url(new Uint8Array(24)),
      protocolVersion: 1,
      iv: encodeBase64Url(new Uint8Array(12)),
      ciphertext: encodeBase64Url(new Uint8Array(16)),
    });
    expect(valid.success).toBe(true);
    if (valid.success) expect(valid.data.expiresIn).toBe("7d");

    const invalid = createNoteSchema.safeParse({
      id: encodeBase64Url(new Uint8Array(24)),
      protocolVersion: 1,
      iv: encodeBase64Url(new Uint8Array(12)),
      ciphertext: encodeBase64Url(new Uint8Array(16)),
      unknown: true,
    });
    expect(invalid.success).toBe(false);
  });
});
