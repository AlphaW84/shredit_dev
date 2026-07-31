import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import Redis from "ioredis";
import { getEnv, type RequestSurface } from "@/lib/config/env";

// The hash tag keeps every script key in one slot when Valkey cluster mode is used.
const KEY_PREFIX = "shredit:{anti-abuse}:v1";
const NO_PREVIOUS_KEY = `${KEY_PREFIX}:rl:no-previous`;
const CONNECT_TIMEOUT_MS = 750;
const COMMAND_TIMEOUT_MS = 1_000;
const POW_ISSUANCE_IP_WINDOW_SECONDS = 120;
const IDEMPOTENCY_LOCK_TTL_MS = 15_000;
const IDEMPOTENCY_LOCK_WAIT_MS = 10_000;
const IDEMPOTENCY_LOCK_RETRY_MS = 40;
const IDEMPOTENCY_LOCK_HEARTBEAT_MS = 4_000;

const FIXED_WINDOWS_SCRIPT = `
local dimensions = tonumber(ARGV[1])
local allowed = 1
local retry_after = 0
local remaining = 9007199254740991

for index = 1, dimensions do
  local argument_offset = 2 + ((index - 1) * 3)
  local limit = tonumber(ARGV[argument_offset])
  local window_seconds = tonumber(ARGV[argument_offset + 1])
  local has_previous = tonumber(ARGV[argument_offset + 2])

  local active_count = redis.call('INCR', KEYS[index])
  local active_ttl = redis.call('TTL', KEYS[index])
  if active_count == 1 or active_ttl < 0 then
    redis.call('EXPIRE', KEYS[index], window_seconds)
    active_ttl = window_seconds
  end

  local previous_count = 0
  local previous_ttl = 0
  if has_previous == 1 then
    previous_count = tonumber(redis.call('GET', KEYS[dimensions + index]) or '0')
    if previous_count > 0 then
      previous_ttl = redis.call('TTL', KEYS[dimensions + index])
      if previous_ttl < 0 then
        redis.call('EXPIRE', KEYS[dimensions + index], window_seconds)
        previous_ttl = window_seconds
      end
    end
  end

  local effective_count = active_count + previous_count
  local dimension_remaining = limit - effective_count
  if dimension_remaining < remaining then remaining = dimension_remaining end

  if effective_count > limit then
    allowed = 0
    local dimension_retry = active_ttl
    if previous_count > 0 then
      if active_count <= limit and previous_count <= limit then
        dimension_retry = math.min(active_ttl, previous_ttl)
      elseif active_count > limit and previous_count > limit then
        dimension_retry = math.max(active_ttl, previous_ttl)
      elseif previous_count > limit then
        dimension_retry = previous_ttl
      end
    end
    if dimension_retry > retry_after then retry_after = dimension_retry end
  end
end

if remaining < 0 then remaining = 0 end
if allowed == 0 and retry_after < 1 then retry_after = 1 end
return { allowed, retry_after, remaining }
`;

const ONION_QUOTA_SCRIPT = `
local hourly_limit = tonumber(ARGV[1])
local daily_limit = tonumber(ARGV[2])
local burst_capacity = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000) + math.floor(tonumber(redis_time[2]) / 1000)
local refill_per_ms = hourly_limit / 3600000

local tokens = tonumber(redis.call('HGET', KEYS[3], 'tokens'))
local updated_at = tonumber(redis.call('HGET', KEYS[3], 'updated_at'))
if tokens == nil or updated_at == nil then
  tokens = burst_capacity
  updated_at = now_ms
else
  local elapsed = now_ms - updated_at
  if elapsed < 0 then elapsed = 0 end
  tokens = math.min(burst_capacity, tokens + (elapsed * refill_per_ms))
end

local hourly_count = tonumber(redis.call('GET', KEYS[1]) or '0')
local daily_count = tonumber(redis.call('GET', KEYS[2]) or '0')
local hourly_ttl = redis.call('TTL', KEYS[1])
local daily_ttl = redis.call('TTL', KEYS[2])
local allowed = 1
local retry_after = 0

if hourly_count + cost > hourly_limit then
  allowed = 0
  if hourly_ttl < 1 then hourly_ttl = 3600 end
  retry_after = math.max(retry_after, hourly_ttl)
end
if daily_count + cost > daily_limit then
  allowed = 0
  if daily_ttl < 1 then daily_ttl = 86400 end
  retry_after = math.max(retry_after, daily_ttl)
end
if tokens < cost then
  allowed = 0
  local bucket_retry = 3600
  if refill_per_ms > 0 and cost <= burst_capacity then
    bucket_retry = math.ceil(((cost - tokens) / refill_per_ms) / 1000)
  end
  retry_after = math.max(retry_after, bucket_retry)
end

if allowed == 1 then
  hourly_count = redis.call('INCRBY', KEYS[1], cost)
  if hourly_count == cost or redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], 3600) end
  daily_count = redis.call('INCRBY', KEYS[2], cost)
  if daily_count == cost or redis.call('TTL', KEYS[2]) < 0 then redis.call('EXPIRE', KEYS[2], 86400) end
  tokens = tokens - cost
end

redis.call('HSET', KEYS[3], 'tokens', tostring(tokens), 'updated_at', tostring(now_ms))
local bucket_ttl_ms = math.ceil((burst_capacity / refill_per_ms) + 1000)
if bucket_ttl_ms < 60000 then bucket_ttl_ms = 60000 end
redis.call('PEXPIRE', KEYS[3], bucket_ttl_ms)

local remaining = math.floor(math.min(tokens, hourly_limit - hourly_count, daily_limit - daily_count))
if remaining < 0 then remaining = 0 end
if allowed == 0 and retry_after < 1 then retry_after = 1 end
return { allowed, retry_after, remaining }
`;

const POW_ISSUANCE_SCRIPT = `
local hourly_limit = tonumber(ARGV[1])
local daily_limit = tonumber(ARGV[2])
local ip_limit = tonumber(ARGV[3])
local has_previous_ip = tonumber(ARGV[4])

local function increment_window(key, window_seconds)
  local count = redis.call('INCR', key)
  local ttl = redis.call('TTL', key)
  if count == 1 or ttl < 0 then
    redis.call('EXPIRE', key, window_seconds)
    ttl = window_seconds
  end
  return count, ttl
end

-- Charge the two fixed-cardinality host windows first. Once either is full,
-- no attacker-controlled IP key or challenge-state key is created.
local hourly_count, hourly_ttl = increment_window(KEYS[1], 3600)
local daily_count, daily_ttl = increment_window(KEYS[2], 86400)
local remaining = math.min(hourly_limit - hourly_count, daily_limit - daily_count)
local retry_after = 0
if hourly_count > hourly_limit then retry_after = math.max(retry_after, hourly_ttl) end
if daily_count > daily_limit then retry_after = math.max(retry_after, daily_ttl) end
if retry_after > 0 then
  if remaining < 0 then remaining = 0 end
  return { 0, retry_after, remaining }
end

local active_ip_count, active_ip_ttl = increment_window(KEYS[3], 120)
local previous_ip_count = 0
local previous_ip_ttl = 0
if has_previous_ip == 1 then
  previous_ip_count = tonumber(redis.call('GET', KEYS[4]) or '0')
  if previous_ip_count > 0 then
    previous_ip_ttl = redis.call('TTL', KEYS[4])
    if previous_ip_ttl < 0 then
      redis.call('EXPIRE', KEYS[4], 120)
      previous_ip_ttl = 120
    end
  end
end

local effective_ip_count = active_ip_count + previous_ip_count
remaining = math.min(remaining, ip_limit - effective_ip_count)
if effective_ip_count > ip_limit then
  local ip_retry = active_ip_ttl
  if previous_ip_count > 0 then
    if active_ip_count <= ip_limit and previous_ip_count <= ip_limit then
      ip_retry = math.min(active_ip_ttl, previous_ip_ttl)
    elseif active_ip_count > ip_limit and previous_ip_count > ip_limit then
      ip_retry = math.max(active_ip_ttl, previous_ip_ttl)
    elseif previous_ip_count > ip_limit then
      ip_retry = previous_ip_ttl
    end
  end
  if remaining < 0 then remaining = 0 end
  return { 0, math.max(1, ip_retry), remaining }
end

if remaining < 0 then remaining = 0 end
return { 1, 0, remaining }
`;

const CONSUME_POW_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value == false then return 0 end
if value ~= ARGV[1] then return -1 end
redis.call('DEL', KEYS[1])
return 1
`;

const EXTEND_LOCK_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value == false or value ~= ARGV[1] then return 0 end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`;

const RELEASE_LOCK_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if value == false or value ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

export class ValkeyUnavailableError extends Error {
  override readonly name = "ValkeyUnavailableError";

  constructor(
    message = "Valkey anti-abuse storage is unavailable",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class AntiAbuseConfigurationError extends Error {
  override readonly name = "AntiAbuseConfigurationError";
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
  cost: number;
}

interface FixedWindowDimension {
  activeKey: string;
  previousKey?: string;
  limit: number;
  windowSeconds: number;
}

interface EphemeralCounter {
  value: number;
  expiresAtMs: number;
}

interface EphemeralBucket {
  tokens: number;
  updatedAtMs: number;
}

interface EphemeralPowRecord {
  value: string;
  expiresAtMs: number;
}

interface EphemeralLease {
  token: string;
  expiresAtMs: number;
}

interface EphemeralState {
  counters: Map<string, EphemeralCounter>;
  buckets: Map<string, EphemeralBucket>;
  pow: Map<string, EphemeralPowRecord>;
  leases: Map<string, EphemeralLease>;
}

const ephemeralGlobal = globalThis as typeof globalThis & {
  __shreditEphemeralAntiAbuse?: EphemeralState;
};

const ephemeral =
  ephemeralGlobal.__shreditEphemeralAntiAbuse ??
  (ephemeralGlobal.__shreditEphemeralAntiAbuse = {
    counters: new Map(),
    buckets: new Map(),
    pow: new Map(),
    leases: new Map(),
  });

let client: Redis | undefined;
let clientUrl: string | undefined;
let connectPromise: Promise<void> | undefined;

function localEphemeralEnabled(): boolean {
  return (
    (
      getEnv() as ReturnType<typeof getEnv> & {
        SHREDIT_LOCAL_EPHEMERAL?: boolean;
      }
    ).SHREDIT_LOCAL_EPHEMERAL === true
  );
}

export function isLocalEphemeralAntiAbuse(): boolean {
  return localEphemeralEnabled();
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new AntiAbuseConfigurationError(`${name} must be a positive integer`);
  return value;
}

function previousIpSecret(): string | undefined {
  const env = getEnv();
  return env.IP_HASH_SECRET_PREVIOUS &&
    env.IP_HASH_SECRET_PREVIOUS !== env.IP_HASH_SECRET
    ? env.IP_HASH_SECRET_PREVIOUS
    : undefined;
}

function hmacKey(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

function canonicalIpv6(input: string): string {
  let source = input.toLowerCase();
  if (source.includes(".")) {
    const lastColon = source.lastIndexOf(":");
    const octets = source
      .slice(lastColon + 1)
      .split(".")
      .map((part) => Number(part));
    source = `${source.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = source.split("::");
  const left = halves[0]
    ? halves[0].split(":").map((part) => Number.parseInt(part, 16))
    : [];
  const right =
    halves.length === 2 && halves[1]
      ? halves[1].split(":").map((part) => Number.parseInt(part, 16))
      : [];
  const groups =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
      : left;

  if (
    groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff
  ) {
    return `${groups[6] >>> 8}.${groups[6] & 0xff}.${groups[7] >>> 8}.${groups[7] & 0xff}`;
  }

  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }

  const rendered = groups.map((group) => group.toString(16));
  if (bestLength < 2) return rendered.join(":");
  const before = rendered.slice(0, bestStart).join(":");
  const after = rendered.slice(bestStart + bestLength).join(":");
  return `${before}::${after}`;
}

/** Normalize a trusted proxy address before hashing. Invalid or missing values share a fail-safe bucket. */
export function normalizeClientIp(value: string | null | undefined): string {
  if (typeof value !== "string") return "unknown-ip";
  let candidate = value.trim();
  if (!candidate || candidate.includes(",") || candidate.includes("%"))
    return "unknown-ip";

  if (candidate.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::(\d{1,5}))?$/u.exec(candidate);
    if (!match || (match[2] && Number(match[2]) > 65_535)) return "unknown-ip";
    candidate = match[1];
  } else if (isIP(candidate) === 0) {
    const match = /^([^:]+):(\d{1,5})$/u.exec(candidate);
    if (!match || Number(match[2]) > 65_535 || isIP(match[1]) !== 4)
      return "unknown-ip";
    candidate = match[1];
  }

  const family = isIP(candidate);
  if (family === 4)
    return candidate
      .split(".")
      .map((part) => String(Number(part)))
      .join(".");
  if (family === 6) return canonicalIpv6(candidate);
  return "unknown-ip";
}

function ipWindowKey(
  secret: string,
  surface: RequestSurface,
  clientIp: string | null | undefined,
  windowName: string,
): string {
  const digest = hmacKey(
    secret,
    `${surface}${normalizeClientIp(clientIp)}${windowName}`,
  );
  return `${KEY_PREFIX}:rl:fw:${digest}`;
}

function noteWindowKey(
  secret: string,
  noteId: string,
  windowName: string,
): string {
  const digest = hmacKey(secret, `note${noteId}${windowName}`);
  return `${KEY_PREFIX}:rl:fw:${digest}`;
}

function createRedis(url: string): Redis {
  const redis = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    enableReadyCheck: true,
    maxRetriesPerRequest: 0,
    connectTimeout: CONNECT_TIMEOUT_MS,
    commandTimeout: COMMAND_TIMEOUT_MS,
    retryStrategy: () => null,
  });
  // ioredis emits connection failures even when the awaited command rejects.
  redis.on("error", () => undefined);
  return redis;
}

function redisIsReady(redis: Redis): boolean {
  return redis.status === "ready";
}

async function requireValkey(): Promise<Redis> {
  const url = getEnv().VALKEY_URL;
  if (!url) throw new ValkeyUnavailableError("VALKEY_URL is not configured");

  if (!client || clientUrl !== url || client.status === "end") {
    client?.disconnect(false);
    client = createRedis(url);
    clientUrl = url;
    connectPromise = undefined;
  }

  try {
    if (client.status === "wait") {
      connectPromise ??= client
        .connect()
        .then(() => undefined)
        .finally(() => {
          connectPromise = undefined;
        });
      await connectPromise;
    } else if (!redisIsReady(client)) {
      if (connectPromise) await connectPromise;
      if (!redisIsReady(client))
        throw new Error(`Valkey connection is ${client.status}`);
    }
    return client;
  } catch (error) {
    client.disconnect(false);
    client = undefined;
    clientUrl = undefined;
    connectPromise = undefined;
    throw new ValkeyUnavailableError(undefined, { cause: error });
  }
}

async function evalValkey(
  script: string,
  keys: string[],
  args: Array<string | number>,
): Promise<unknown> {
  try {
    const redis = await requireValkey();
    return await redis.eval(script, keys.length, ...keys, ...args);
  } catch (error) {
    if (error instanceof ValkeyUnavailableError) throw error;
    client?.disconnect(false);
    client = undefined;
    clientUrl = undefined;
    throw new ValkeyUnavailableError(undefined, { cause: error });
  }
}

function idempotencyLockKey(keyDigest: Uint8Array): string {
  if (keyDigest.byteLength !== 32)
    throw new TypeError("Idempotency lock digest must be exactly 32 bytes");
  return `${KEY_PREFIX}:idempotency-lock:${Buffer.from(keyDigest).toString("base64url")}`;
}

function leaseTokensEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

async function tryAcquireIdempotencyLease(
  key: string,
  token: string,
): Promise<boolean> {
  if (localEphemeralEnabled()) {
    const nowMs = Date.now();
    const existing = ephemeral.leases.get(key);
    if (existing && existing.expiresAtMs > nowMs) return false;
    ephemeral.leases.set(key, {
      token,
      expiresAtMs: nowMs + IDEMPOTENCY_LOCK_TTL_MS,
    });
    return true;
  }
  try {
    const redis = await requireValkey();
    return (
      (await redis.set(key, token, "PX", IDEMPOTENCY_LOCK_TTL_MS, "NX")) ===
      "OK"
    );
  } catch (error) {
    if (error instanceof ValkeyUnavailableError) throw error;
    client?.disconnect(false);
    client = undefined;
    clientUrl = undefined;
    throw new ValkeyUnavailableError(undefined, { cause: error });
  }
}

async function extendIdempotencyLease(
  key: string,
  token: string,
): Promise<boolean> {
  if (localEphemeralEnabled()) {
    const lease = ephemeral.leases.get(key);
    if (
      !lease ||
      lease.expiresAtMs <= Date.now() ||
      !leaseTokensEqual(lease.token, token)
    ) {
      if (lease?.expiresAtMs && lease.expiresAtMs <= Date.now())
        ephemeral.leases.delete(key);
      return false;
    }
    lease.expiresAtMs = Date.now() + IDEMPOTENCY_LOCK_TTL_MS;
    return true;
  }
  const result = await evalValkey(
    EXTEND_LOCK_SCRIPT,
    [key],
    [token, IDEMPOTENCY_LOCK_TTL_MS],
  );
  return Number(result) === 1;
}

async function releaseIdempotencyLease(
  key: string,
  token: string,
): Promise<boolean> {
  if (localEphemeralEnabled()) {
    const lease = ephemeral.leases.get(key);
    if (!lease || !leaseTokensEqual(lease.token, token)) return false;
    ephemeral.leases.delete(key);
    return true;
  }
  const result = await evalValkey(RELEASE_LOCK_SCRIPT, [key], [token]);
  return Number(result) === 1;
}

function waitForLeaseRetry(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Serialize one create idempotency key across replicas. Callers must repeat
 * their replay lookup inside the lease before consuming one-use anti-abuse state.
 */
export async function withCreateIdempotencyLock<T>(
  keyDigest: Uint8Array,
  operation: () => Promise<T>,
): Promise<T> {
  const key = idempotencyLockKey(keyDigest);
  const token = randomBytes(24).toString("base64url");
  const deadline = Date.now() + IDEMPOTENCY_LOCK_WAIT_MS;
  while (!(await tryAcquireIdempotencyLease(key, token))) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0)
      throw new ValkeyUnavailableError(
        "Timed out waiting for the create idempotency lock",
      );
    await waitForLeaseRetry(Math.min(IDEMPOTENCY_LOCK_RETRY_MS, remainingMs));
  }

  let heartbeatFailure: unknown;
  let heartbeatInFlight: Promise<void> | undefined;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight || heartbeatFailure) return;
    heartbeatInFlight = extendIdempotencyLease(key, token)
      .then((extended) => {
        if (!extended)
          heartbeatFailure = new ValkeyUnavailableError(
            "Create idempotency lock ownership was lost",
          );
      })
      .catch((error: unknown) => {
        heartbeatFailure = error;
      })
      .finally(() => {
        heartbeatInFlight = undefined;
      });
  }, IDEMPOTENCY_LOCK_HEARTBEAT_MS);
  heartbeat.unref?.();

  let result: T | undefined;
  let failure: unknown;
  try {
    result = await operation();
  } catch (error) {
    failure = error;
  } finally {
    clearInterval(heartbeat);
    if (heartbeatInFlight) await heartbeatInFlight;
    if (!failure && heartbeatFailure) failure = heartbeatFailure;
    try {
      const released = await releaseIdempotencyLease(key, token);
      if (!released && !failure)
        failure = new ValkeyUnavailableError(
          "Create idempotency lock ownership was lost",
        );
    } catch (error) {
      if (!failure) failure = error;
    }
  }
  if (failure) throw failure;
  return result as T;
}

function cleanCounter(
  key: string,
  nowMs: number,
): EphemeralCounter | undefined {
  const counter = ephemeral.counters.get(key);
  if (counter && counter.expiresAtMs <= nowMs) {
    ephemeral.counters.delete(key);
    return undefined;
  }
  return counter;
}

function consumeEphemeralFixedWindows(
  dimensions: FixedWindowDimension[],
): RateLimitDecision {
  const nowMs = Date.now();
  let allowed = true;
  let retryAfterSeconds = 0;
  let remaining = Number.MAX_SAFE_INTEGER;

  for (const dimension of dimensions) {
    const current = cleanCounter(dimension.activeKey, nowMs) ?? {
      value: 0,
      expiresAtMs: nowMs + dimension.windowSeconds * 1_000,
    };
    current.value += 1;
    ephemeral.counters.set(dimension.activeKey, current);

    const previous = dimension.previousKey
      ? cleanCounter(dimension.previousKey, nowMs)
      : undefined;
    const effective = current.value + (previous?.value ?? 0);
    remaining = Math.min(remaining, Math.max(0, dimension.limit - effective));
    if (effective <= dimension.limit) continue;

    allowed = false;
    const activeRetry = Math.max(
      1,
      Math.ceil((current.expiresAtMs - nowMs) / 1_000),
    );
    let dimensionRetry = activeRetry;
    if (previous) {
      const previousRetry = Math.max(
        1,
        Math.ceil((previous.expiresAtMs - nowMs) / 1_000),
      );
      if (current.value <= dimension.limit && previous.value <= dimension.limit)
        dimensionRetry = Math.min(activeRetry, previousRetry);
      else if (
        current.value > dimension.limit &&
        previous.value > dimension.limit
      )
        dimensionRetry = Math.max(activeRetry, previousRetry);
      else if (previous.value > dimension.limit) dimensionRetry = previousRetry;
    }
    retryAfterSeconds = Math.max(retryAfterSeconds, dimensionRetry);
  }

  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : Math.max(1, retryAfterSeconds),
    remaining,
    cost: 1,
  };
}

async function consumeFixedWindows(
  dimensions: FixedWindowDimension[],
): Promise<RateLimitDecision> {
  if (localEphemeralEnabled()) return consumeEphemeralFixedWindows(dimensions);

  const keys = [
    ...dimensions.map((dimension) => dimension.activeKey),
    ...dimensions.map((dimension) => dimension.previousKey ?? NO_PREVIOUS_KEY),
  ];
  const args: Array<string | number> = [dimensions.length];
  for (const dimension of dimensions)
    args.push(
      dimension.limit,
      dimension.windowSeconds,
      dimension.previousKey ? 1 : 0,
    );
  const result = await evalValkey(FIXED_WINDOWS_SCRIPT, keys, args);
  if (!Array.isArray(result) || result.length !== 3)
    throw new ValkeyUnavailableError(
      "Valkey returned an invalid fixed-window result",
    );
  return {
    allowed: Number(result[0]) === 1,
    retryAfterSeconds: Number(result[1]),
    remaining: Number(result[2]),
    cost: 1,
  };
}

/** Atomically charge the independent clearnet per-IP hour and day windows. */
export async function consumeClearnetCreateLimit(
  clientIp: string | null | undefined,
): Promise<RateLimitDecision> {
  const env = getEnv();
  const previous = previousIpSecret();
  return consumeFixedWindows([
    {
      activeKey: ipWindowKey(
        env.IP_HASH_SECRET,
        "clearnet",
        clientIp,
        "create-hour",
      ),
      previousKey: previous
        ? ipWindowKey(previous, "clearnet", clientIp, "create-hour")
        : undefined,
      limit: positiveInteger(
        env.CREATE_LIMIT_PER_IP_HOUR,
        "CREATE_LIMIT_PER_IP_HOUR",
      ),
      windowSeconds: 3_600,
    },
    {
      activeKey: ipWindowKey(
        env.IP_HASH_SECRET,
        "clearnet",
        clientIp,
        "create-day",
      ),
      previousKey: previous
        ? ipWindowKey(previous, "clearnet", clientIp, "create-day")
        : undefined,
      limit: positiveInteger(
        env.CREATE_LIMIT_PER_IP_DAY,
        "CREATE_LIMIT_PER_IP_DAY",
      ),
      windowSeconds: 86_400,
    },
  ]);
}

/** Reserve one protected-open verification attempt across the per-note and per-IP windows. */
export async function consumeProtectedOpenLimit(args: {
  noteId: string;
  clientIp: string | null | undefined;
  surface?: RequestSurface;
}): Promise<RateLimitDecision> {
  if (!args.noteId || args.noteId.length > 256)
    throw new TypeError("A bounded note ID is required");
  const env = getEnv();
  const previous = previousIpSecret();
  const surface = args.surface ?? "clearnet";
  const ipDecision = await consumeFixedWindows([
    {
      activeKey: ipWindowKey(
        env.IP_HASH_SECRET,
        surface,
        args.clientIp,
        "protected-open-ip-hour",
      ),
      previousKey: previous
        ? ipWindowKey(
            previous,
            surface,
            args.clientIp,
            "protected-open-ip-hour",
          )
        : undefined,
      limit: positiveInteger(
        env.PASSWORD_FAILURE_LIMIT_PER_IP_HOUR,
        "PASSWORD_FAILURE_LIMIT_PER_IP_HOUR",
      ),
      windowSeconds: 3_600,
    },
  ]);

  // Reject a saturated address before an attacker-controlled note ID can
  // allocate a new Valkey key. Allowed attempts still charge both windows.
  if (!ipDecision.allowed) return ipDecision;

  const noteDecision = await consumeFixedWindows([
    {
      activeKey: noteWindowKey(
        env.IP_HASH_SECRET,
        args.noteId,
        "protected-note-15m",
      ),
      previousKey: previous
        ? noteWindowKey(previous, args.noteId, "protected-note-15m")
        : undefined,
      limit: positiveInteger(
        env.PASSWORD_FAILURE_LIMIT_PER_NOTE_15M,
        "PASSWORD_FAILURE_LIMIT_PER_NOTE_15M",
      ),
      windowSeconds: 900,
    },
  ]);

  return {
    ...noteDecision,
    remaining: Math.min(ipDecision.remaining, noteDecision.remaining),
  };
}

function consumeEphemeralPowChallengeIssuanceLimit(args: {
  activeIpKey: string;
  previousIpKey?: string;
  hourlyLimit: number;
  dailyLimit: number;
  ipLimit: number;
}): RateLimitDecision {
  const hostDecision = consumeEphemeralFixedWindows([
    {
      activeKey: `${KEY_PREFIX}:rl:pow-issuance:host-hour`,
      limit: args.hourlyLimit,
      windowSeconds: 3_600,
    },
    {
      activeKey: `${KEY_PREFIX}:rl:pow-issuance:host-day`,
      limit: args.dailyLimit,
      windowSeconds: 86_400,
    },
  ]);
  if (!hostDecision.allowed) return hostDecision;

  const ipDecision = consumeEphemeralFixedWindows([
    {
      activeKey: args.activeIpKey,
      previousKey: args.previousIpKey,
      limit: args.ipLimit,
      windowSeconds: POW_ISSUANCE_IP_WINDOW_SECONDS,
    },
  ]);
  return {
    allowed: ipDecision.allowed,
    retryAfterSeconds: ipDecision.retryAfterSeconds,
    remaining: Math.min(hostDecision.remaining, ipDecision.remaining),
    cost: 1,
  };
}

/**
 * Bound PoW challenge allocation before creating its 120-second state key.
 * Global host windows cap key cardinality; the HMAC-IP window limits one source.
 */
export async function consumePowChallengeIssuanceLimit(
  clientIp: string | null | undefined,
): Promise<RateLimitDecision> {
  const env = getEnv();
  const previous = previousIpSecret();
  const hourlyLimit = positiveInteger(
    env.ONION_TOKENS_PER_HOUR,
    "ONION_TOKENS_PER_HOUR",
  );
  const dailyLimit = positiveInteger(
    env.ONION_TOKENS_PER_DAY,
    "ONION_TOKENS_PER_DAY",
  );
  const ipLimit = positiveInteger(env.ONION_TOKEN_BURST, "ONION_TOKEN_BURST");
  const activeIpKey = ipWindowKey(
    env.IP_HASH_SECRET,
    "onion",
    clientIp,
    "pow-challenge-issuance-2m",
  );
  const previousIpKey = previous
    ? ipWindowKey(previous, "onion", clientIp, "pow-challenge-issuance-2m")
    : undefined;

  if (localEphemeralEnabled()) {
    return consumeEphemeralPowChallengeIssuanceLimit({
      activeIpKey,
      previousIpKey,
      hourlyLimit,
      dailyLimit,
      ipLimit,
    });
  }

  const result = await evalValkey(
    POW_ISSUANCE_SCRIPT,
    [
      `${KEY_PREFIX}:rl:pow-issuance:host-hour`,
      `${KEY_PREFIX}:rl:pow-issuance:host-day`,
      activeIpKey,
      previousIpKey ?? NO_PREVIOUS_KEY,
    ],
    [hourlyLimit, dailyLimit, ipLimit, previousIpKey ? 1 : 0],
  );
  if (!Array.isArray(result) || result.length !== 3) {
    throw new ValkeyUnavailableError(
      "Valkey returned an invalid PoW issuance-limit result",
    );
  }
  return {
    allowed: Number(result[0]) === 1,
    retryAfterSeconds: Number(result[1]),
    remaining: Number(result[2]),
    cost: 1,
  };
}

function consumeEphemeralOnionQuota(args: {
  hourlyLimit: number;
  dailyLimit: number;
  burst: number;
  cost: number;
}): RateLimitDecision {
  const nowMs = Date.now();
  const hourKey = `${KEY_PREFIX}:rl:onion:hour`;
  const dayKey = `${KEY_PREFIX}:rl:onion:day`;
  const bucketKey = `${KEY_PREFIX}:rl:onion:burst`;
  const hour = cleanCounter(hourKey, nowMs);
  const day = cleanCounter(dayKey, nowMs);
  const storedBucket = ephemeral.buckets.get(bucketKey);
  const refillPerMs = args.hourlyLimit / 3_600_000;
  const tokens = storedBucket
    ? Math.min(
        args.burst,
        storedBucket.tokens +
          Math.max(0, nowMs - storedBucket.updatedAtMs) * refillPerMs,
      )
    : args.burst;

  let retryAfterSeconds = 0;
  if ((hour?.value ?? 0) + args.cost > args.hourlyLimit) {
    retryAfterSeconds = Math.max(
      retryAfterSeconds,
      hour ? Math.ceil((hour.expiresAtMs - nowMs) / 1_000) : 3_600,
    );
  }
  if ((day?.value ?? 0) + args.cost > args.dailyLimit) {
    retryAfterSeconds = Math.max(
      retryAfterSeconds,
      day ? Math.ceil((day.expiresAtMs - nowMs) / 1_000) : 86_400,
    );
  }
  if (tokens < args.cost) {
    const bucketRetry =
      args.cost <= args.burst
        ? Math.ceil((args.cost - tokens) / refillPerMs / 1_000)
        : 3_600;
    retryAfterSeconds = Math.max(retryAfterSeconds, bucketRetry);
  }

  const allowed = retryAfterSeconds <= 0;
  const nextHour = hour ?? { value: 0, expiresAtMs: nowMs + 3_600_000 };
  const nextDay = day ?? { value: 0, expiresAtMs: nowMs + 86_400_000 };
  let nextTokens = tokens;
  if (allowed) {
    nextHour.value += args.cost;
    nextDay.value += args.cost;
    nextTokens -= args.cost;
    ephemeral.counters.set(hourKey, nextHour);
    ephemeral.counters.set(dayKey, nextDay);
  }
  ephemeral.buckets.set(bucketKey, { tokens: nextTokens, updatedAtMs: nowMs });
  const remaining = Math.max(
    0,
    Math.floor(
      Math.min(
        nextTokens,
        args.hourlyLimit - nextHour.value,
        args.dailyLimit - nextDay.value,
      ),
    ),
  );
  return {
    allowed,
    retryAfterSeconds: allowed ? 0 : Math.max(1, retryAfterSeconds),
    remaining,
    cost: args.cost,
  };
}

/** Atomically charge weighted onion hour/day quotas and the refilling burst bucket. */
export async function consumeOnionCreateQuota(
  ciphertextBytes: number,
): Promise<RateLimitDecision> {
  if (!Number.isSafeInteger(ciphertextBytes) || ciphertextBytes < 0)
    throw new TypeError("ciphertextBytes must be a non-negative integer");
  const env = getEnv();
  const hourlyLimit = positiveInteger(
    env.ONION_TOKENS_PER_HOUR,
    "ONION_TOKENS_PER_HOUR",
  );
  const dailyLimit = positiveInteger(
    env.ONION_TOKENS_PER_DAY,
    "ONION_TOKENS_PER_DAY",
  );
  const burst = positiveInteger(env.ONION_TOKEN_BURST, "ONION_TOKEN_BURST");
  const tokenBytes = positiveInteger(
    env.ONION_TOKEN_BYTES,
    "ONION_TOKEN_BYTES",
  );
  const cost = Math.max(1, Math.ceil(ciphertextBytes / tokenBytes));

  if (localEphemeralEnabled())
    return consumeEphemeralOnionQuota({ hourlyLimit, dailyLimit, burst, cost });
  const result = await evalValkey(
    ONION_QUOTA_SCRIPT,
    [
      `${KEY_PREFIX}:rl:onion:hour`,
      `${KEY_PREFIX}:rl:onion:day`,
      `${KEY_PREFIX}:rl:onion:burst`,
    ],
    [hourlyLimit, dailyLimit, burst, cost],
  );
  if (!Array.isArray(result) || result.length !== 3)
    throw new ValkeyUnavailableError(
      "Valkey returned an invalid onion-quota result",
    );
  return {
    allowed: Number(result[0]) === 1,
    retryAfterSeconds: Number(result[1]),
    remaining: Number(result[2]),
    cost,
  };
}

function powKey(challengeId: string): string {
  return `${KEY_PREFIX}:pow:${challengeId}`;
}

function assertPowStateArguments(
  challengeId: string,
  value: string,
  ttlSeconds?: number,
): void {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(challengeId))
    throw new TypeError("Invalid PoW challenge ID");
  if (!value || Buffer.byteLength(value, "utf8") > 1_024)
    throw new TypeError("Invalid PoW challenge state");
  if (ttlSeconds !== undefined) {
    positiveInteger(ttlSeconds, "PoW challenge TTL");
    if (ttlSeconds > 300)
      throw new AntiAbuseConfigurationError(
        "PoW challenge TTL must not exceed 300 seconds",
      );
  }
}

export async function storePowChallengeState(
  challengeId: string,
  value: string,
  ttlSeconds: number,
): Promise<boolean> {
  assertPowStateArguments(challengeId, value, ttlSeconds);
  if (localEphemeralEnabled()) {
    const key = powKey(challengeId);
    const existing = ephemeral.pow.get(key);
    const nowMs = Date.now();
    if (existing && existing.expiresAtMs > nowMs) return false;
    ephemeral.pow.set(key, { value, expiresAtMs: nowMs + ttlSeconds * 1_000 });
    return true;
  }
  try {
    const redis = await requireValkey();
    return (
      (await redis.set(powKey(challengeId), value, "EX", ttlSeconds, "NX")) ===
      "OK"
    );
  } catch (error) {
    if (error instanceof ValkeyUnavailableError) throw error;
    client?.disconnect(false);
    client = undefined;
    clientUrl = undefined;
    throw new ValkeyUnavailableError(undefined, { cause: error });
  }
}

/** Compare and delete in one operation, so concurrent valid solutions have exactly one winner. */
export async function consumePowChallengeState(
  challengeId: string,
  expectedValue: string,
): Promise<boolean> {
  assertPowStateArguments(challengeId, expectedValue);
  const key = powKey(challengeId);
  if (localEphemeralEnabled()) {
    const record = ephemeral.pow.get(key);
    if (!record || record.expiresAtMs <= Date.now()) {
      ephemeral.pow.delete(key);
      return false;
    }
    if (record.value !== expectedValue) return false;
    ephemeral.pow.delete(key);
    return true;
  }
  const result = await evalValkey(CONSUME_POW_SCRIPT, [key], [expectedValue]);
  return Number(result) === 1;
}

export async function cleanupPowChallengeStates(): Promise<number> {
  if (!localEphemeralEnabled()) return 0;
  const nowMs = Date.now();
  let removed = 0;
  for (const [key, record] of ephemeral.pow) {
    if (record.expiresAtMs <= nowMs) {
      ephemeral.pow.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export function resetEphemeralAntiAbuseState(): void {
  ephemeral.counters.clear();
  ephemeral.buckets.clear();
  ephemeral.pow.clear();
  ephemeral.leases.clear();
}

export async function valkeyPing(
  timeoutMs = CONNECT_TIMEOUT_MS,
): Promise<boolean> {
  if (localEphemeralEnabled()) return true;
  try {
    const redis = await requireValkey();
    await Promise.race([
      redis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Valkey timeout")), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function closeValkey(): Promise<void> {
  const redis = client;
  client = undefined;
  clientUrl = undefined;
  connectPromise = undefined;
  if (!redis) return;
  if (redis.status === "ready")
    await redis.quit().catch(() => redis.disconnect(false));
  else redis.disconnect(false);
}
