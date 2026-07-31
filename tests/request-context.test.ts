import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isUnknownClientIp,
  requiresTurnstile,
  trustedClientIp,
  trustedCountry,
  trustedIngressSurface,
} from "@/lib/anti-abuse/request-context";
import { resetEnvForTests } from "@/lib/config/env";

const ENV_KEYS = [
  "TRUSTED_PROXY_CIDRS",
  "TURNSTILE_ENABLED",
  "TURNSTILE_BYPASS_COUNTRIES",
] as const;
const originalEnv = new Map(
  ENV_KEYS.map((key) => [key, process.env[key]] as const),
);

function configure(cidrs: string): void {
  process.env.TRUSTED_PROXY_CIDRS = cidrs;
  process.env.TURNSTILE_ENABLED = "true";
  process.env.TURNSTILE_BYPASS_COUNTRIES = "CN";
  resetEnvForTests();
}

function requestWithPeer(headers: HeadersInit, peer?: string): Request {
  const requestHeaders = new Headers(headers);
  if (peer !== undefined) requestHeaders.set("x-shredit-runtime-peer", peer);
  return new Request("https://shredit.dev/api/v1/notes", {
    headers: requestHeaders,
  });
}

beforeEach(() => configure("10.0.0.0/8,2001:db8:abcd::/48"));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvForTests();
});

describe("trusted proxy request context", () => {
  it("fails closed when the runtime does not expose the actual peer", () => {
    const request = requestWithPeer({
      "x-forwarded-for": "198.51.100.4",
      "cf-ipcountry": "CN",
    });
    expect(isUnknownClientIp(trustedClientIp(request))).toBe(true);
    expect(trustedCountry(request)).toBeNull();
    expect(requiresTurnstile(request, "clearnet")).toBe(true);
  });

  it("ignores forwarded identity and country from an untrusted direct peer", () => {
    const request = requestWithPeer(
      {
        "x-forwarded-for": "192.0.2.77",
        "cf-connecting-ip": "192.0.2.77",
        "cf-ipcountry": "CN",
      },
      "203.0.113.9",
    );
    expect(trustedClientIp(request)).toBe("203.0.113.9");
    expect(trustedCountry(request)).toBeNull();
    expect(requiresTurnstile(request, "clearnet")).toBe(true);
  });

  it("walks a verified IPv4 proxy chain from right to left", () => {
    const request = requestWithPeer(
      { "x-forwarded-for": "198.51.100.44, 10.0.0.4", "cf-ipcountry": "CN" },
      "10.0.0.5",
    );
    expect(trustedClientIp(request)).toBe("198.51.100.44");
    expect(trustedCountry(request)).toBe("CN");
    expect(requiresTurnstile(request, "clearnet")).toBe(false);
  });

  it("ignores a spoofed left prefix when the proxy appends the real client", () => {
    const request = requestWithPeer(
      { "x-forwarded-for": "192.0.2.200, 198.51.100.44" },
      "10.0.0.5",
    );
    expect(trustedClientIp(request)).toBe("198.51.100.44");
  });

  it("supports IPv6 CIDRs, peer ports, and canonical client addresses", () => {
    const request = requestWithPeer(
      { "x-forwarded-for": "2001:db8:ffff:0:0:0:0:9, 2001:db8:abcd::4" },
      "[2001:db8:abcd::5]:443",
    );
    expect(trustedClientIp(request)).toBe("2001:db8:ffff::9");
  });

  it("fails closed for malformed CIDR configuration", () => {
    configure("10.0.0.0/99");
    const request = requestWithPeer(
      { "x-forwarded-for": "198.51.100.4", "cf-ipcountry": "CN" },
      "10.0.0.5",
    );
    expect(trustedClientIp(request)).toBe("10.0.0.5");
    expect(trustedCountry(request)).toBeNull();
    expect(requiresTurnstile(request, "clearnet")).toBe(true);
  });

  it("requires consistent fallback identity and country headers", () => {
    const request = requestWithPeer(
      {
        "cf-connecting-ip": "198.51.100.4",
        "x-real-ip": "198.51.100.5",
        "cf-ipcountry": "CN",
        "x-vercel-ip-country": "US",
      },
      "10.0.0.5",
    );
    expect(isUnknownClientIp(trustedClientIp(request))).toBe(true);
    expect(trustedCountry(request)).toBeNull();
    expect(requiresTurnstile(request, "clearnet")).toBe(true);
  });

  it("accepts a proxy-selected surface only from a trusted socket peer", () => {
    const trusted = requestWithPeer(
      { "x-shredit-surface": "onion" },
      "10.0.0.5",
    );
    const direct = requestWithPeer(
      { "x-shredit-surface": "onion" },
      "203.0.113.5",
    );
    const invalid = requestWithPeer(
      { "x-shredit-surface": "unexpected" },
      "10.0.0.5",
    );

    expect(trustedIngressSurface(trusted)).toBe("onion");
    expect(trustedIngressSurface(direct)).toBeNull();
    expect(trustedIngressSurface(invalid)).toBeNull();
  });
});
