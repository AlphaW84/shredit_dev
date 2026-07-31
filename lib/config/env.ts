import { z } from "zod";

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

const integerFromEnv = (fallback: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return fallback;
    return Number(value);
  }, z.number().int().finite());

const positiveIntegerFromEnv = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  return Number(value);
}, z.number().int().positive().finite().optional());

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const publicContactUri = z
  .string()
  .url()
  .refine(
    (value) => !/[\r\n]/u.test(value),
    "contact URI must be a single line",
  )
  .refine(
    (value) => ["https:", "mailto:"].includes(new URL(value).protocol),
    "contact URI must use https or mailto",
  );

const policyUrlKeys = ["SECURITY_POLICY_URL", "ABUSE_POLICY_URL"] as const;

function validatePolicyUrl(
  key: (typeof policyUrlKeys)[number],
  value: string,
  publicUrl: URL,
  loopback: boolean,
): void {
  const policyUrl = new URL(value);
  if (
    !["http:", "https:"].includes(policyUrl.protocol) ||
    policyUrl.username ||
    policyUrl.password ||
    policyUrl.search ||
    policyUrl.hash
  ) {
    throw new Error(
      `${key} must be an HTTP(S) URL without credentials, query, or fragment`,
    );
  }
  if (!loopback && policyUrl.protocol !== "https:") {
    throw new Error(`${key} must use HTTPS outside local loopback`);
  }
  if (policyUrl.origin !== publicUrl.origin) {
    throw new Error(
      `${key} must use the same canonical origin as PUBLIC_BASE_URL`,
    );
  }
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: optionalString,
  VALKEY_URL: optionalString,
  PUBLIC_BASE_URL: z.string().url().default("http://127.0.0.1:3232"),
  ONION_URL: optionalString,
  GIT_REPOSITORY_URL: optionalString,
  NEXT_PUBLIC_GIT_COMMIT: z.string().default("local"),
  SECURITY_CONTACT: publicContactUri.default("mailto:security@example.invalid"),
  ABUSE_CONTACT: publicContactUri.default("mailto:abuse@example.invalid"),
  SECURITY_POLICY_URL: z
    .string()
    .url()
    .default("http://127.0.0.1:3232/security"),
  ABUSE_POLICY_URL: z.string().url().default("http://127.0.0.1:3232/abuse"),
  TURNSTILE_ENABLED: booleanFromEnv.default(false),
  TURNSTILE_SITE_KEY: optionalString,
  TURNSTILE_SECRET_KEY: optionalString,
  TURNSTILE_BYPASS_COUNTRIES: z.string().default("CN"),
  TURNSTILE_BYPASS_ONION: booleanFromEnv.default(true),
  GEOIP_DB_PATH: optionalString,
  TRUSTED_PROXY_CIDRS: z.string().default(""),
  IP_HASH_SECRET: z.string().default("dev-ip-hash-secret-change-me"),
  POW_SECRET: z.string().default("dev-pow-secret-change-me"),
  POW_DIFFICULTY_BITS: integerFromEnv(18),
  IDEMPOTENCY_HMAC_SECRET: z
    .string()
    .default("dev-idempotency-secret-change-me"),
  IDEMPOTENCY_TOMBSTONE_RETENTION_DAYS: integerFromEnv(30),
  CREATE_LIMIT_PER_IP_HOUR: integerFromEnv(10),
  CREATE_LIMIT_PER_IP_DAY: integerFromEnv(50),
  PASSWORD_FAILURE_LIMIT_PER_NOTE_15M: integerFromEnv(5),
  PASSWORD_FAILURE_LIMIT_PER_IP_HOUR: integerFromEnv(50),
  ONION_TOKENS_PER_HOUR: integerFromEnv(200),
  ONION_TOKENS_PER_DAY: integerFromEnv(1000),
  ONION_TOKEN_BURST: integerFromEnv(20),
  ONION_TOKEN_BYTES: integerFromEnv(8192),
  MAX_ACTIVE_NOTE_BYTES: positiveIntegerFromEnv,
  MAX_ACTIVE_NOTE_COUNT: positiveIntegerFromEnv,
  ARGON2_MEMORY_KIB: integerFromEnv(65536),
  ARGON2_TIME_COST: integerFromEnv(3),
  ARGON2_PARALLELISM: integerFromEnv(1),
  ARGON2_HASH_LENGTH: integerFromEnv(32),
  ARGON2_MAX_CONCURRENCY: integerFromEnv(4),
  ARGON2_VERIFY_TIMEOUT_MS: integerFromEnv(5000),
  SHREDIT_LOCAL_EPHEMERAL: booleanFromEnv.default(false),
  IP_HASH_SECRET_PREVIOUS: optionalString,
  TURNSTILE_EXPECTED_ACTION: z.string().default("shredit-create"),
});

export type ShreditEnv = z.infer<typeof envSchema>;

let cached: ShreditEnv | undefined;

/** Parse runtime configuration once. Production intentionally fails closed. */
export function getEnv(): ShreditEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }
  const value = parsed.data;
  const publicUrl = new URL(value.PUBLIC_BASE_URL);
  if (
    !["http:", "https:"].includes(publicUrl.protocol) ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.pathname !== "/" ||
    publicUrl.search ||
    publicUrl.hash
  ) {
    throw new Error(
      "PUBLIC_BASE_URL must be an HTTP(S) origin without credentials, path, query, or fragment",
    );
  }
  if (value.ONION_URL) {
    const onionUrl = new URL(value.ONION_URL);
    if (
      !["http:", "https:"].includes(onionUrl.protocol) ||
      !onionUrl.hostname.endsWith(".onion") ||
      onionUrl.username ||
      onionUrl.password ||
      onionUrl.pathname !== "/" ||
      onionUrl.search ||
      onionUrl.hash
    ) {
      throw new Error(
        "ONION_URL must be an HTTP(S) .onion origin without credentials, path, query, or fragment",
      );
    }
  }
  const repositoryUrl = value.GIT_REPOSITORY_URL
    ? new URL(value.GIT_REPOSITORY_URL)
    : undefined;
  if (
    repositoryUrl &&
    (!["http:", "https:"].includes(repositoryUrl.protocol) ||
      repositoryUrl.username ||
      repositoryUrl.password ||
      repositoryUrl.search ||
      repositoryUrl.hash ||
      repositoryUrl.pathname === "/" ||
      repositoryUrl.pathname.replace(/\/$/u, "").endsWith(".git"))
  ) {
    throw new Error(
      "GIT_REPOSITORY_URL must be a public HTTP(S) repository URL without credentials, query, fragment, or .git suffix",
    );
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    publicUrl.hostname,
  );
  if (value.SHREDIT_LOCAL_EPHEMERAL) {
    if (!loopback)
      throw new Error(
        "SHREDIT_LOCAL_EPHEMERAL is allowed only for a loopback PUBLIC_BASE_URL",
      );
  }
  if (value.NODE_ENV === "production") {
    const required: Array<keyof ShreditEnv> = [
      "DATABASE_URL",
      "VALKEY_URL",
      "PUBLIC_BASE_URL",
      "NEXT_PUBLIC_GIT_COMMIT",
      "SECURITY_CONTACT",
      "ABUSE_CONTACT",
      "SECURITY_POLICY_URL",
      "ABUSE_POLICY_URL",
      "IDEMPOTENCY_HMAC_SECRET",
      "IP_HASH_SECRET",
      "POW_SECRET",
    ];
    const missing = required.filter((key) => {
      if (
        value.SHREDIT_LOCAL_EPHEMERAL &&
        (key === "DATABASE_URL" || key === "VALKEY_URL")
      )
        return false;
      const raw = process.env[String(key)];
      return raw === undefined || raw === "" || !value[key];
    });
    if (!loopback && !value.GIT_REPOSITORY_URL)
      missing.push("GIT_REPOSITORY_URL");
    if (!loopback && !value.TRUSTED_PROXY_CIDRS.trim())
      missing.push("TRUSTED_PROXY_CIDRS");
    if (!value.MAX_ACTIVE_NOTE_BYTES || value.MAX_ACTIVE_NOTE_BYTES <= 0)
      missing.push("MAX_ACTIVE_NOTE_BYTES");
    if (!value.MAX_ACTIVE_NOTE_COUNT || value.MAX_ACTIVE_NOTE_COUNT <= 0)
      missing.push("MAX_ACTIVE_NOTE_COUNT");
    if (
      value.TURNSTILE_ENABLED &&
      (!value.TURNSTILE_SITE_KEY || !value.TURNSTILE_SECRET_KEY)
    ) {
      missing.push("TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY");
    }
    if (missing.length > 0)
      throw new Error(
        `Missing production configuration: ${missing.join(", ")}`,
      );
    for (const key of policyUrlKeys)
      validatePolicyUrl(key, value[key], publicUrl, loopback);
    const positiveRuntimeValues: Array<keyof ShreditEnv> = [
      "IDEMPOTENCY_TOMBSTONE_RETENTION_DAYS",
      "CREATE_LIMIT_PER_IP_HOUR",
      "CREATE_LIMIT_PER_IP_DAY",
      "PASSWORD_FAILURE_LIMIT_PER_NOTE_15M",
      "PASSWORD_FAILURE_LIMIT_PER_IP_HOUR",
      "ONION_TOKENS_PER_HOUR",
      "ONION_TOKENS_PER_DAY",
      "ONION_TOKEN_BURST",
      "ONION_TOKEN_BYTES",
      "ARGON2_MEMORY_KIB",
      "ARGON2_TIME_COST",
      "ARGON2_PARALLELISM",
      "ARGON2_HASH_LENGTH",
      "ARGON2_MAX_CONCURRENCY",
      "ARGON2_VERIFY_TIMEOUT_MS",
    ];
    const invalidRuntimeValues = positiveRuntimeValues.filter((key) => {
      const candidate = value[key];
      return (
        typeof candidate !== "number" ||
        !Number.isSafeInteger(candidate) ||
        candidate <= 0
      );
    });
    if (invalidRuntimeValues.length > 0) {
      throw new Error(
        `Invalid positive production configuration: ${invalidRuntimeValues.join(", ")}`,
      );
    }
    if (value.POW_DIFFICULTY_BITS < 1 || value.POW_DIFFICULTY_BITS > 31) {
      throw new Error(
        "POW_DIFFICULTY_BITS must be between 1 and 31 in production",
      );
    }
    if (!value.SHREDIT_LOCAL_EPHEMERAL) {
      const secretKeys = [
        "IDEMPOTENCY_HMAC_SECRET",
        "IP_HASH_SECRET",
        "POW_SECRET",
      ] as const;
      const weakSecrets = secretKeys.filter((key) => {
        const secret = value[key];
        return (
          new TextEncoder().encode(secret).byteLength < 32 ||
          /(change-me|replace-with|example-secret)/iu.test(secret)
        );
      });
      if (weakSecrets.length > 0)
        throw new Error(
          `Weak production secret configuration: ${weakSecrets.join(", ")}`,
        );
      if (
        new Set(secretKeys.map((key) => value[key])).size !== secretKeys.length
      ) {
        throw new Error("Production HMAC and PoW secrets must be distinct");
      }
    }
    if (publicUrl.protocol !== "https:" && !loopback)
      throw new Error("PUBLIC_BASE_URL must use HTTPS outside local loopback");
    if (repositoryUrl && repositoryUrl.protocol !== "https:")
      throw new Error("GIT_REPOSITORY_URL must use HTTPS in production");
    if (!loopback && !/^[a-f0-9]{7,64}$/iu.test(value.NEXT_PUBLIC_GIT_COMMIT)) {
      throw new Error(
        "NEXT_PUBLIC_GIT_COMMIT must be an exact hexadecimal commit identifier in production",
      );
    }
  }
  cached = value;
  return value;
}

export function resetEnvForTests(): void {
  cached = undefined;
}

export function canonicalOrigins(): { clearnet: URL; onion?: URL } {
  const env = getEnv();
  return {
    clearnet: new URL(env.PUBLIC_BASE_URL),
    onion: env.ONION_URL ? new URL(env.ONION_URL) : undefined,
  };
}

export type RequestSurface = "clearnet" | "onion";

/** Resolve the destination surface from trusted ingress or a local canonical URL. */
export function surfaceForTarget(
  request: Request,
  ingressSurface: RequestSurface | null = null,
): RequestSurface | null {
  const origins = canonicalOrigins();
  const env = getEnv();
  const loopbackHosts = ["localhost", "127.0.0.1", "[::1]", "::1"];
  const localTargetHosts = [...loopbackHosts, "0.0.0.0"];
  const productionIngressRequired =
    env.NODE_ENV === "production" &&
    !loopbackHosts.includes(origins.clearnet.hostname);
  if (productionIngressRequired) {
    if (ingressSurface === "clearnet") return "clearnet";
    if (ingressSurface === "onion" && origins.onion) return "onion";
    return null;
  }
  const targetUrl = new URL(request.url);
  const target = targetUrl.origin;
  if (target === origins.clearnet.origin) return "clearnet";
  if (origins.onion && target === origins.onion.origin) return "onion";
  if (
    loopbackHosts.includes(origins.clearnet.hostname) &&
    localTargetHosts.includes(targetUrl.hostname) &&
    targetUrl.protocol === origins.clearnet.protocol &&
    targetUrl.port === origins.clearnet.port
  )
    return "clearnet";
  if (env.NODE_ENV !== "production" && !process.env.PUBLIC_BASE_URL) {
    if (
      targetUrl.protocol === "http:" &&
      localTargetHosts.includes(targetUrl.hostname)
    )
      return "clearnet";
  }
  return null;
}

/** Derive mutation policy from trusted ingress and an exact browser Origin. */
export function surfaceForRequest(
  request: Request,
  ingressSurface: RequestSurface | null = null,
): RequestSurface | null {
  const origins = canonicalOrigins();
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin) return null;
  const targetSurface = surfaceForTarget(request, ingressSurface);
  if (targetSurface === "clearnet" && requestOrigin === origins.clearnet.origin)
    return "clearnet";
  if (
    targetSurface === "onion" &&
    origins.onion &&
    requestOrigin === origins.onion.origin
  )
    return "onion";
  // Local development often alternates between localhost and 127.0.0.1. Keep production strict,
  // but allow an unconfigured loopback origin so the local app remains usable without an env file.
  if (getEnv().NODE_ENV !== "production" && !process.env.PUBLIC_BASE_URL) {
    try {
      const originUrl = new URL(requestOrigin);
      const targetUrl = new URL(request.url);
      const loopbackHosts = ["localhost", "127.0.0.1", "[::1]", "::1"];
      if (
        originUrl.origin === targetUrl.origin &&
        originUrl.protocol === "http:" &&
        loopbackHosts.includes(originUrl.hostname)
      )
        return "clearnet";
    } catch {
      return null;
    }
  }
  return null;
}

export function publicOriginForSurface(surface: RequestSurface): string {
  const origins = canonicalOrigins();
  return surface === "onion" && origins.onion
    ? origins.onion.origin
    : origins.clearnet.origin;
}
