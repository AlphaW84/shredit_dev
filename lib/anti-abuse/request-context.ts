import { BlockList, isIP } from "node:net";
import { getEnv, type RequestSurface } from "@/lib/config/env";

const UNKNOWN_IP = "unknown-ip";
const MAX_FORWARDED_HOPS = 32;
const INTERNAL_PEER_HEADER = "x-shredit-runtime-peer";
const TRUSTED_SURFACE_HEADER = "x-shredit-surface";

interface TrustedProxyPolicy {
  blockList: BlockList;
  configured: boolean;
}

interface ClientContext {
  clientIp: string;
  forwardedHeadersTrusted: boolean;
}

function stripAddressPort(value: string): string | null {
  const candidate = value.trim();
  if (!candidate || candidate.includes("%")) return null;
  if (candidate.startsWith("[")) {
    const match = /^\[([^\]]+)\](?::(\d{1,5}))?$/u.exec(candidate);
    if (!match || (match[2] && Number(match[2]) > 65_535)) return null;
    return match[1];
  }
  if (isIP(candidate) !== 0) return candidate;
  const ipv4WithPort = /^([^:]+):(\d{1,5})$/u.exec(candidate);
  if (
    !ipv4WithPort ||
    Number(ipv4WithPort[2]) > 65_535 ||
    isIP(ipv4WithPort[1]) !== 4
  )
    return null;
  return ipv4WithPort[1];
}

function normalizeIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let candidate = stripAddressPort(value);
  if (!candidate) return null;
  if (
    candidate.toLowerCase().startsWith("::ffff:") &&
    isIP(candidate.slice(7)) === 4
  )
    candidate = candidate.slice(7);
  const version = isIP(candidate);
  if (version === 4)
    return candidate
      .split(".")
      .map((part) => String(Number(part)))
      .join(".");
  if (version !== 6) return null;
  try {
    const hostname = new URL(`http://[${candidate}]/`).hostname;
    return hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1).toLowerCase()
      : hostname.toLowerCase();
  } catch {
    return null;
  }
}

function trustedProxyPolicy(): TrustedProxyPolicy | null {
  const entries = getEnv()
    .TRUSTED_PROXY_CIDRS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const blockList = new BlockList();
  try {
    for (const entry of entries) {
      const parts = entry.split("/");
      if (parts.length > 2) return null;
      const address = normalizeIp(parts[0]);
      if (!address) return null;
      const version = isIP(address);
      const maxPrefix = version === 4 ? 32 : 128;
      const prefix = parts[1] === undefined ? maxPrefix : Number(parts[1]);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix)
        return null;
      blockList.addSubnet(address, prefix, version === 4 ? "ipv4" : "ipv6");
    }
  } catch {
    return null;
  }
  return { blockList, configured: entries.length > 0 };
}

function isTrustedProxy(policy: TrustedProxyPolicy, address: string): boolean {
  const version = isIP(address);
  return (
    version !== 0 &&
    policy.blockList.check(address, version === 4 ? "ipv4" : "ipv6")
  );
}

function actualPeerIp(request: Request): string | null {
  return normalizeIp(request.headers.get(INTERNAL_PEER_HEADER));
}

function forwardedChain(value: string): string[] | null {
  const parts = value.split(",");
  if (parts.length === 0 || parts.length > MAX_FORWARDED_HOPS) return null;
  const normalized = parts.map(normalizeIp);
  return normalized.every((value): value is string => value !== null)
    ? normalized
    : null;
}

function resolveClientContext(request: Request): ClientContext {
  const peer = actualPeerIp(request);
  if (!peer) return { clientIp: UNKNOWN_IP, forwardedHeadersTrusted: false };

  const policy = trustedProxyPolicy();
  if (!policy || !policy.configured || !isTrustedProxy(policy, peer)) {
    return { clientIp: peer, forwardedHeadersTrusted: false };
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor !== null) {
    const chain = forwardedChain(forwardedFor);
    if (!chain) return { clientIp: UNKNOWN_IP, forwardedHeadersTrusted: false };
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      const hop = chain[index];
      if (!isTrustedProxy(policy, hop))
        return { clientIp: hop, forwardedHeadersTrusted: true };
    }
    return { clientIp: UNKNOWN_IP, forwardedHeadersTrusted: false };
  }

  const fallbackHeaders = ["cf-connecting-ip", "x-real-ip"]
    .map((name) => request.headers.get(name))
    .filter((value): value is string => value !== null);
  if (fallbackHeaders.length === 0)
    return { clientIp: UNKNOWN_IP, forwardedHeadersTrusted: false };
  const fallbackIps = fallbackHeaders.map(normalizeIp);
  if (fallbackIps.some((value) => value === null))
    return { clientIp: UNKNOWN_IP, forwardedHeadersTrusted: false };
  const unique = new Set(fallbackIps as string[]);
  if (unique.size !== 1)
    return { clientIp: UNKNOWN_IP, forwardedHeadersTrusted: false };
  return { clientIp: [...unique][0], forwardedHeadersTrusted: true };
}

export function trustedClientIp(request: Request): string {
  return resolveClientContext(request).clientIp;
}

export function trustedCountry(request: Request): string | null {
  if (!resolveClientContext(request).forwardedHeadersTrusted) return null;
  const values = ["cf-ipcountry", "x-vercel-ip-country"]
    .map((name) => request.headers.get(name))
    .filter((value): value is string => value !== null);
  if (
    values.length === 0 ||
    values.some((value) => !/^[A-Za-z]{2}$/u.test(value))
  )
    return null;
  const countries = new Set(values.map((value) => value.toUpperCase()));
  return countries.size === 1 ? [...countries][0] : null;
}

/**
 * Read the reverse-proxy-selected public surface only from a verified ingress
 * peer. The proxy must overwrite this header after selecting its vhost.
 */
export function trustedIngressSurface(request: Request): RequestSurface | null {
  const peer = actualPeerIp(request);
  if (!peer) return null;
  const policy = trustedProxyPolicy();
  if (!policy || !policy.configured || !isTrustedProxy(policy, peer))
    return null;
  const surface = request.headers.get(TRUSTED_SURFACE_HEADER);
  return surface === "clearnet" || surface === "onion" ? surface : null;
}

export function requiresTurnstile(
  request: Request,
  surface: RequestSurface,
): boolean {
  const env = getEnv();
  if (!env.TURNSTILE_ENABLED || surface === "onion") return false;
  const country = trustedCountry(request);
  const bypass = new Set(
    env.TURNSTILE_BYPASS_COUNTRIES.split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );
  return country === null || !bypass.has(country);
}

export function isUnknownClientIp(value: string): boolean {
  return value === UNKNOWN_IP;
}
