const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const MAX_NOTE_PLAINTEXT_BYTES = 65536;

export async function assertWebCryptoCapability() {
  try {
    const cryptoApi = globalThis.crypto;
    const subtle = cryptoApi?.subtle;
    if (
      !cryptoApi ||
      typeof cryptoApi.getRandomValues !== "function" ||
      !subtle ||
      typeof subtle.importKey !== "function" ||
      typeof subtle.encrypt !== "function" ||
      typeof subtle.decrypt !== "function"
    ) {
      throw new Error("crypto-unavailable");
    }

    const keyBytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    const iv = Uint8Array.from({ length: 12 }, (_, index) => index);
    const additionalData = encoder.encode("shredit:webcrypto-preflight:v1");
    const expected = encoder.encode("shredit");
    const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    const ciphertext = await subtle.encrypt(
      { name: "AES-GCM", iv, additionalData },
      key,
      expected,
    );
    const decrypted = new Uint8Array(
      await subtle.decrypt(
        { name: "AES-GCM", iv, additionalData },
        key,
        ciphertext,
      ),
    );
    if (
      decrypted.byteLength !== expected.byteLength ||
      decrypted.some((byte, index) => byte !== expected[index])
    ) {
      throw new Error("crypto-preflight-mismatch");
    }
  } catch {
    throw new Error("crypto-unavailable");
  }
}

export function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("non-canonical base64url");
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (toBase64Url(bytes) !== value) throw new Error("non-canonical base64url");
  return bytes;
}

export function utf8ByteLength(value: string) {
  return encoder.encode(value).byteLength;
}

export function randomBase64Url(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function normalizePassword(value: string) {
  return value.normalize("NFC");
}

export function passwordCodePointLength(value: string) {
  return Array.from(value).length;
}

export function generatePassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_";
  const result: string[] = [];
  const cutoff = Math.floor(256 / alphabet.length) * alphabet.length;
  while (result.length < 20) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < cutoff) result.push(alphabet[byte % alphabet.length]);
      if (result.length === 20) break;
    }
  }
  return result.join("");
}

function uint32BigEndian(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function lengthPrefixed(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + 4 + part.byteLength, 0);
  const result = new Uint8Array(total);
  const view = new DataView(result.buffer);
  let offset = 0;
  for (const part of parts) {
    view.setUint32(offset, part.byteLength, false);
    offset += 4;
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export async function createPayloadDigest(input: {
  surface: "clearnet" | "onion";
  id: string;
  protocolVersion: 1;
  iv: string;
  ciphertext: string;
  expiresIn: "1h" | "24h" | "7d" | "30d" | "never";
}) {
  const canonical = lengthPrefixed([
    encoder.encode(input.surface),
    encoder.encode(input.id),
    uint32BigEndian(input.protocolVersion),
    fromBase64Url(input.iv),
    fromBase64Url(input.ciphertext),
    encoder.encode(input.expiresIn),
  ]);
  return toBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", canonical)),
  );
}

export interface PowChallenge {
  version: 1;
  challengeId: string;
  expiresAtUnix: number;
  difficultyBits: number;
  surface: "onion";
  payloadDigest: string;
  signature: string;
}

export async function solvePowChallenge(
  challenge: PowChallenge,
  onProgress?: (attempts: number) => void,
) {
  if (!crypto?.subtle || typeof Worker === "undefined")
    throw new Error("crypto-unavailable");
  if (
    challenge.version !== 1 ||
    challenge.surface !== "onion" ||
    challenge.expiresAtUnix <= Math.floor(Date.now() / 1000) ||
    challenge.difficultyBits < 1 ||
    challenge.difficultyBits > 31 ||
    fromBase64Url(challenge.challengeId).byteLength !== 16 ||
    fromBase64Url(challenge.payloadDigest).byteLength !== 32
  )
    throw new Error("malformed-payload");

  const workerSource = `
    const decode = (value) => {
      const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
      const binary = atob(padded);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    };
    const encode = (bytes) => {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
    };
    const hasZeroBits = (digest, bits) => {
      const full = Math.floor(bits / 8);
      for (let i = 0; i < full; i += 1) if (digest[i] !== 0) return false;
      const rest = bits % 8;
      return rest === 0 || (digest[full] & (0xff << (8 - rest))) === 0;
    };
    self.onmessage = async ({ data }) => {
      const prefix = new TextEncoder().encode("shredit:pow:v1");
      const challengeId = decode(data.challengeId);
      const payload = decode(data.payloadDigest);
      const base = new Uint8Array(prefix.length + challengeId.length + payload.length + 8);
      base.set(prefix, 0);
      base.set(challengeId, prefix.length);
      base.set(payload, prefix.length + challengeId.length);
      const nonceOffset = base.length - 8;
      let counter = 0n;
      const batchSize = 128;
      while (counter <= 0xffffffffffffffffn) {
        const jobs = [];
        const nonces = [];
        for (let index = 0; index < batchSize && counter <= 0xffffffffffffffffn; index += 1, counter += 1n) {
          const input = base.slice();
          const view = new DataView(input.buffer);
          view.setBigUint64(nonceOffset, counter, false);
          nonces.push(input.slice(nonceOffset));
          jobs.push(crypto.subtle.digest("SHA-256", input));
        }
        const hashes = await Promise.all(jobs);
        for (let index = 0; index < hashes.length; index += 1) {
          if (hasZeroBits(new Uint8Array(hashes[index]), data.difficultyBits)) {
            self.postMessage({ nonce: encode(nonces[index]), attempts: Number(counter) });
            return;
          }
        }
        if (counter % 4096n === 0n) self.postMessage({ progress: Number(counter) });
      }
      self.postMessage({ error: "pow-exhausted" });
    };
  `;
  const objectUrl = URL.createObjectURL(
    new Blob([workerSource], { type: "text/javascript" }),
  );
  const worker = new Worker(objectUrl);
  try {
    return await new Promise<string>((resolve, reject) => {
      worker.onmessage = (
        event: MessageEvent<{
          nonce?: string;
          progress?: number;
          error?: string;
        }>,
      ) => {
        if (event.data.progress !== undefined)
          onProgress?.(event.data.progress);
        if (event.data.nonce) resolve(event.data.nonce);
        if (event.data.error) reject(new Error(event.data.error));
      };
      worker.onerror = () => reject(new Error("pow-worker-failed"));
      worker.postMessage({
        challengeId: challenge.challengeId,
        payloadDigest: challenge.payloadDigest,
        difficultyBits: challenge.difficultyBits,
      });
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(objectUrl);
  }
}

export async function encryptNote(noteId: string, plaintext: string) {
  if (!crypto?.subtle) throw new Error("crypto-unavailable");
  const keyBytes = new Uint8Array(32);
  crypto.getRandomValues(keyBytes);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(`shredit:v1:${noteId}`),
    },
    key,
    encoder.encode(plaintext),
  );
  return {
    key: toBase64Url(keyBytes),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function decryptNote(
  noteId: string,
  keyValue: string,
  ivValue: string,
  ciphertextValue: string,
) {
  if (!crypto?.subtle) throw new Error("crypto-unavailable");
  const keyBytes = fromBase64Url(keyValue);
  const iv = fromBase64Url(ivValue);
  const ciphertext = fromBase64Url(ciphertextValue);
  if (
    keyBytes.byteLength !== 32 ||
    iv.byteLength !== 12 ||
    ciphertext.byteLength < 16 ||
    ciphertext.byteLength > 65552
  ) {
    throw new Error("malformed-payload");
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "decrypt",
  ]);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(`shredit:v1:${noteId}`),
    },
    key,
    ciphertext,
  );
  return decoder.decode(plaintext);
}

export function parseNoteLocation(
  pathname: string,
  search: string,
  hash: string,
) {
  if (search) return null;
  const match = pathname.match(/^\/n\/([A-Za-z0-9_-]{32})$/);
  const hashMatch = hash.match(/^#v1\.([A-Za-z0-9_-]{43})$/);
  if (!match || !hashMatch) return null;
  const id = match[1];
  const key = hashMatch[1];
  try {
    if (
      fromBase64Url(id).byteLength !== 24 ||
      fromBase64Url(key).byteLength !== 32
    )
      return null;
    return { id, key };
  } catch {
    return null;
  }
}

export function buildShareUrl(origin: string, noteId: string, key: string) {
  return `${origin.replace(/\/$/, "")}/n/${noteId}#v1.${key}`;
}
