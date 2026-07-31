const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function asBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

export function encodeBase64Url(input: Uint8Array | ArrayBuffer): string {
  const bytes = asBytes(input);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, "");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeBase64Url(
  value: string,
  expectedBytes?: number,
): Uint8Array {
  if (!value || !BASE64URL_RE.test(value) || value.includes("="))
    throw new Error("Invalid base64url");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  let bytes: Uint8Array;
  if (typeof Buffer !== "undefined") {
    bytes = new Uint8Array(Buffer.from(padded, "base64"));
  } else {
    const binary = atob(padded);
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  // Reject non-canonical encodings such as alternate trailing bits.
  if (encodeBase64Url(bytes) !== value)
    throw new Error("Non-canonical base64url");
  if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes)
    throw new Error("Unexpected byte length");
  return bytes;
}

export const NOTE_ID_RE = /^[A-Za-z0-9_-]{32}$/;
export const NOTE_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidNoteId(id: string): boolean {
  try {
    return NOTE_ID_RE.test(id) && decodeBase64Url(id, 24).byteLength === 24;
  } catch {
    return false;
  }
}

export function isValidNoteKey(key: string): boolean {
  try {
    return NOTE_KEY_RE.test(key) && decodeBase64Url(key, 32).byteLength === 32;
  } catch {
    return false;
  }
}

export function assertNoteId(id: string): string {
  if (!isValidNoteId(id)) throw new Error("Invalid note ID");
  return id;
}

export function assertNoteKey(key: string): string {
  if (!isValidNoteKey(key)) throw new Error("Invalid note key");
  return key;
}
