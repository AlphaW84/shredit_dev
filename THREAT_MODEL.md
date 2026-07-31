# Threat Model

This threat model covers the Shredit v1.1 MVP: public creation of one-time, plain-text notes encrypted in the browser, optional password gating, clearnet and optional onion origins, PostgreSQL storage, Valkey anti-abuse state, and a Next.js App Router deployment on Dokploy.

## Assets

- Plaintext note content while it exists in a user's browser.
- The 256-bit AES-GCM note key in the URL fragment.
- Encrypted payload, IV, expiry, password hash, idempotency tombstones, and capacity counters.
- User intent that a note is delivered at most once.
- Server secrets: `DATABASE_URL`, `VALKEY_URL`, `IDEMPOTENCY_HMAC_SECRET`, `IP_HASH_SECRET`, `POW_SECRET`, and Turnstile secret.
- Public configuration and exact build commit shown in the footer.
- Availability and quota state, including the distinction between safe reads and anti-abuse-dependent mutations.

## Trust Boundaries

```text
Browser crypto boundary
  plaintext + random AES key + fragment  --Web Crypto--> ciphertext + IV
       |                                                        |
       | HTTPS/or authenticated onion transport                v
       +-------------------------------> Next.js API -> PostgreSQL (ciphertext)
                                                   -> Valkey (short-lived anti-abuse state)
Reverse proxy/Dokploy config -> trusted origin/IP/GeoIP policy and redacted logs
```

The browser is not trusted for policy decisions, body size, origin, password validation, expiry, or anti-abuse success. The server is intentionally blind to the AES key but is trusted to enforce access gates, one-time deletion, quotas, and protocol validation. The reverse proxy is trusted only when its CIDRs and header contract are explicitly configured.

## Adversaries And Abuse Cases

| Threat                                     | Impact                                           | Controls                                                                                |
| ------------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Link holder or crawler triggers a read     | Premature note destruction                       | GET/render/meta/prefetch never consume; only explicit POST open deletes                 |
| Concurrent opens race                      | More than one successful delivery                | Capacity-first PostgreSQL transaction and atomic delete                                 |
| Wrong-password guessing                    | Note disclosure or online abuse                  | Argon2id, per-note/IP throttles, generic `404`, bounded verification pool               |
| Note-ID enumeration                        | Existence/privacy disclosure                     | High-entropy IDs, generic unavailable state, metadata only for active rows              |
| Fragment leakage                           | AES key disclosure                               | Local fragment parsing, no fragment in requests/logs/referrers/analytics, `no-referrer` |
| Malicious ciphertext or malformed input    | Parser/runtime compromise or resource exhaustion | Strict Zod-like schema, canonical base64url, body/ciphertext limits, CSP, Node runtime  |
| Replay after lost create response          | Duplicate notes or lost sender link              | HMAC idempotency digest, fingerprint, surface binding, tombstone transaction            |
| Note-ID collision                          | Overwrite or wrong payload                       | Unique constraints, no upsert, regenerate ID/key/idempotency once                       |
| Capacity race or ledger drift              | Storage exhaustion or accidental data loss       | Singleton capacity lock, atomic counters, bounded cleanup, explicit reconciliation      |
| Valkey outage                              | Abuse bypass or inconsistent throttling          | Fail closed for create/protected open/PoW; keep safe PostgreSQL reads routable          |
| Spoofed proxy/IP/country headers           | Rate-limit or CN/Turnstile bypass                | Trusted proxy CIDRs, HMAC IP keys, trusted GeoIP only, unknown-country fallback         |
| Onion third-party request                  | Correlation or unexpected script execution       | Onion CSP excludes Cloudflare/third parties, no analytics/fonts/images                  |
| Cache or link-preview storage              | Disclosure/consume side effects                  | `Cache-Control: no-store`, dynamic note/API/health routes, proxy bypass                 |
| Log/telemetry leakage                      | Secret or content exposure                       | Route-template logs and redaction of IDs, bodies, URLs, keys, passwords, IPs            |
| Compromised browser/device                 | Plaintext/key theft                              | Explicit limitation; no server-side control can correct a compromised endpoint          |
| Malicious recipient                        | Screenshots, copying, forwarding                 | Explicit non-guarantee; UI offers only literal display and copy                         |
| Traffic correlation or identifying content | Network-level deanonymization                    | Tor footnote and qualified claims; no promise of anonymity                              |
| Dependency/build compromise                | Malicious code in client/server                  | Pinned lockfile, secret/dependency scans, local production build, public commit link    |

## Security Invariants

1. The AES key never appears in an HTTP request, server-rendered data, log, metric, referrer, or browser persistence.
2. Plaintext, passwords, full share URLs, note IDs, ciphertext, and raw IPs are not logged or stored in note records.
3. A wrong password does not consume a note or change capacity counters.
4. At most one concurrent explicit open returns the payload.
5. Unavailable responses do not reveal whether a note exists, expired, was consumed, or failed password verification.
6. Idempotency replay of the same request/surface returns one creation without consuming a second anti-abuse token.
7. Capacity reservation and deletion/counter updates are atomic and use one lock order.
8. Onion responses load no third-party resources; note/API/health routes are uncached.
9. Production configuration fails closed when mandatory secrets, origins, public commit metadata, or finite capacity limits are absent.

## Residual Risk And Operator Responsibilities

The service cannot recover a consumed note, detect screenshots, prevent a recipient from copying plaintext, or guarantee anonymity. Operators must set realistic capacity limits, trusted proxy CIDRs, GeoIP behavior, onion provisioning, contact addresses, legal copy, and the final name/trademark decision. Production PostgreSQL backups are intentionally an operator policy and are not managed by the application; the chosen note-database policy disables backups.

Security review must use local synthetic data. Production deploy, root/server access, database access, remote pushes, and Dokploy webhook calls require separate explicit authorization.
