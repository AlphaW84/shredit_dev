import { createHash, createHmac, randomBytes } from "node:crypto";
import { decodeBase64Url, encodeBase64Url } from "./base64url";
import type { RequestSurface } from "@/lib/config/env";

export const PROTOCOL_VERSION = 1 as const;
export const MAX_NOTE_PLAINTEXT_BYTES = 65_536;
export const MAX_CIPHERTEXT_BYTES = MAX_NOTE_PLAINTEXT_BYTES + 16;
export const NOTE_ID_BYTES = 24;
export const NOTE_KEY_BYTES = 32;
export const NOTE_IV_BYTES = 12;
export const IDEMPOTENCY_KEY_BYTES = 24;

export type ExpirySelection = "1h" | "24h" | "7d" | "30d" | "never";

export function randomBase64Url(bytes: number): string {
  return encodeBase64Url(randomBytes(bytes));
}

export function buildAdditionalData(noteId: string): Uint8Array {
  return new TextEncoder().encode(`shredit:v1:${noteId}`);
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function expiryDate(
  selection: ExpirySelection,
  now = new Date(),
): Date | null {
  if (selection === "never") return null;
  const milliseconds: Record<Exclude<ExpirySelection, "never">, number> = {
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(now.getTime() + milliseconds[selection]);
}

export function canonicalLengthPrefixed(
  parts: Array<string | Uint8Array>,
): Uint8Array {
  const encoded = parts.map((part) =>
    typeof part === "string" ? new TextEncoder().encode(part) : part,
  );
  const total = encoded.reduce((sum, item) => sum + 4 + item.byteLength, 0);
  const result = new Uint8Array(total);
  const view = new DataView(result.buffer);
  let offset = 0;
  for (const item of encoded) {
    view.setUint32(offset, item.byteLength, false);
    offset += 4;
    result.set(item, offset);
    offset += item.byteLength;
  }
  return result;
}

export function uint32BigEndian(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error("Invalid uint32");
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, false);
  return result;
}

export function sha256(input: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(input).digest());
}

export function hmacSha256(
  secret: string,
  input: Uint8Array | string,
): Uint8Array {
  return new Uint8Array(createHmac("sha256", secret).update(input).digest());
}

export function digestBase64Url(input: Uint8Array): string {
  return encodeBase64Url(sha256(input));
}

export function idempotencyDigest(rawKey: string, secret: string): Uint8Array {
  return hmacSha256(secret, rawKey);
}

export function noteIdDigest(noteId: string, secret: string): Uint8Array {
  return hmacSha256(secret, noteId);
}

export function passwordCommitment(
  normalizedPassword: string,
  secret: string,
): Uint8Array {
  return hmacSha256(secret, normalizedPassword);
}

export function requestFingerprint(args: {
  surface: RequestSurface;
  id: string;
  protocolVersion: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  expiresIn: ExpirySelection;
  normalizedPassword?: string;
  secret: string;
}): Uint8Array {
  return sha256(
    canonicalLengthPrefixed([
      args.surface,
      args.id,
      uint32BigEndian(args.protocolVersion),
      args.iv,
      args.ciphertext,
      args.expiresIn,
      passwordCommitment(args.normalizedPassword ?? "", args.secret),
    ]),
  );
}

export function payloadDigest(args: {
  surface: RequestSurface;
  id: string;
  protocolVersion: number;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  expiresIn: ExpirySelection;
}): Uint8Array {
  return sha256(
    canonicalLengthPrefixed([
      args.surface,
      args.id,
      uint32BigEndian(args.protocolVersion),
      args.iv,
      args.ciphertext,
      args.expiresIn,
    ]),
  );
}

export function parseFragment(fragment: string): Uint8Array {
  const match = /^#?v1\.([A-Za-z0-9_-]{43})$/u.exec(fragment);
  if (!match) throw new Error("Invalid note fragment");
  return decodeBase64Url(match[1], NOTE_KEY_BYTES);
}
