import { getEnv } from "@/lib/config/env";

export const GENERATED_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_";

interface Argon2Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

let activeArgon2Operations = 0;
const argon2Waiters: Argon2Waiter[] = [];

class Argon2CapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Argon2CapacityError";
  }
}

function releaseArgon2Slot(): void {
  const next = argon2Waiters.shift();
  if (next) {
    clearTimeout(next.timeout);
    next.resolve(createArgon2Release());
    return;
  }
  activeArgon2Operations = Math.max(0, activeArgon2Operations - 1);
}

function createArgon2Release(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseArgon2Slot();
  };
}

async function acquireArgon2Slot(
  limit: number,
  timeoutMs: number,
): Promise<() => void> {
  if (activeArgon2Operations < limit) {
    activeArgon2Operations += 1;
    return createArgon2Release();
  }

  const maxQueued = Math.max(1, limit * 2);
  if (argon2Waiters.length >= maxQueued) {
    throw new Argon2CapacityError("Argon2 queue capacity is exhausted");
  }

  return new Promise<() => void>((resolve, reject) => {
    const waiter: Argon2Waiter = {
      resolve,
      reject,
      timeout: setTimeout(() => {
        const index = argon2Waiters.indexOf(waiter);
        if (index >= 0) argon2Waiters.splice(index, 1);
        reject(new Argon2CapacityError("Argon2 queue wait timed out"));
      }, timeoutMs),
    };
    waiter.timeout.unref?.();
    argon2Waiters.push(waiter);
  });
}

async function runArgon2Operation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const env = getEnv();
  const limit = Math.max(1, env.ARGON2_MAX_CONCURRENCY);
  const timeoutMs = Math.max(1, env.ARGON2_VERIFY_TIMEOUT_MS);
  const startedAt = Date.now();
  const release = await acquireArgon2Slot(limit, timeoutMs);
  const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
  const controller = new AbortController();
  let timedOut = false;
  let pending: Promise<T>;

  try {
    pending = operation(controller.signal);
  } catch (error) {
    release();
    throw error;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Argon2CapacityError("Argon2 operation timed out"));
    }, remainingMs);
    timeout.unref?.();
  });

  try {
    return await Promise.race([pending, timeoutResult]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (timedOut) {
      void pending.catch(() => undefined).finally(release);
    } else {
      release();
    }
  }
}

export function normalizePassword(value: string): string {
  return value.normalize("NFC");
}

export function passwordCodePointLength(value: string): number {
  return Array.from(value).length;
}

export function validatePassword(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const normalized = normalizePassword(value);
  const count = passwordCodePointLength(normalized);
  return count >= 8 && count <= 128;
}

export function assertPassword(value: unknown): string {
  if (!validatePassword(value)) throw new Error("Invalid password");
  return normalizePassword(value as string);
}

export function generatePassword(length = 20): string {
  if (!Number.isInteger(length) || length < 1)
    throw new Error("Invalid password length");
  const result: string[] = [];
  const cutoff =
    Math.floor(256 / GENERATED_PASSWORD_ALPHABET.length) *
    GENERATED_PASSWORD_ALPHABET.length;
  while (result.length < length) {
    const random = new Uint8Array(Math.max(32, length - result.length));
    crypto.getRandomValues(random);
    for (const value of random) {
      if (value < cutoff)
        result.push(
          GENERATED_PASSWORD_ALPHABET[
            value % GENERATED_PASSWORD_ALPHABET.length
          ],
        );
      if (result.length === length) break;
    }
  }
  return result.join("");
}

export async function hashPassword(password: string): Promise<string> {
  const env = getEnv();
  const normalized = assertPassword(password);
  return runArgon2Operation(async (signal) => {
    const { hash } = await import("@node-rs/argon2");
    return hash(
      normalized,
      {
        algorithm: 2,
        memoryCost: env.ARGON2_MEMORY_KIB,
        timeCost: env.ARGON2_TIME_COST,
        parallelism: env.ARGON2_PARALLELISM,
        outputLen: env.ARGON2_HASH_LENGTH,
      },
      signal,
    );
  });
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const normalized = assertPassword(password);
  return runArgon2Operation(async (signal) => {
    const { verify } = await import("@node-rs/argon2");
    return verify(encodedHash, normalized, undefined, signal);
  });
}
