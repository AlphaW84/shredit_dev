# Implementation Decisions

This is the decision ledger for protocol details that need one deterministic interpretation. It complements, and never expands, `SHREDIT_PROJECT_SPEC.md` v1.1. Each item is a security-preserving contract that should have a unit or integration test. A decision is not evidence that the behavior has already been implemented or verified.

## Repository And Scope

1. No `AGENTS.md` exists in this repository as of 2026-07-26. The implementation follows the user handoff and the frozen specification.
2. English (`en`) is the fallback locale and Simplified Chinese (`zh-CN`) is the only alternate. Locale negotiation must never add a locale segment to `/n/<id>#v1.<key>` links.
3. The app remains a plain-text, one-time note utility. Libraries must not introduce accounts, files, Markdown, downloads, analytics, trackers, recovery, sender controls, or other non-goals.

## Encoding And Cryptography

4. Plaintext size is measured with `TextEncoder().encode(value).byteLength`, before encryption, and must be at most `65536`. JavaScript string length is not a substitute for the UTF-8 byte limit.
5. Note IDs are exactly 24 random bytes encoded base64url without padding (32 characters). AES keys are exactly 32 random bytes encoded base64url without padding (43 characters). IVs are exactly 12 random bytes.
6. AES-GCM uses Web Crypto only, protocol version `1`, and additional authenticated data `UTF-8("shredit:v1:" + noteId)`. The returned ciphertext includes the 16-byte authentication tag. No compression is applied.
7. Binary API fields use base64url without padding. Decoders reject padding, non-canonical encodings, wrong decoded lengths, and characters outside `[A-Za-z0-9_-]`.
8. The accepted share grammar is `^/n/[A-Za-z0-9_-]{32}#v1\.[A-Za-z0-9_-]{43}$` after removing the configured origin. Query strings, percent-encoding, extra path segments, and version mismatches are rejected before any API request. The fragment is never put in fetch URLs, logs, metadata, referrers, or error reports.
9. If a note ID collision occurs, the browser creates a new note ID, a new AES key, and a new idempotency key, re-encrypts, and retries once. The server never upserts a client ID.

## Canonical Payload And Proof Of Work

10. The server-relevant create tuple is serialized with a deterministic length-prefixed encoding: each byte/string field is `uint32be(length) || bytes`; the integer protocol version is `uint32be(1)`; fields appear in this exact order: `surface`, `id` (ASCII canonical base64url), `protocolVersion`, decoded `iv`, decoded `ciphertext`, and ASCII `expiresIn`. This encoding is used for the SHA-256 payload digest and the idempotency request fingerprint where the specification calls for the tuple.
11. The PoW challenge signature is HMAC-SHA-256 over the exact UTF-8 bytes `shredit:pow:v1|<challengeId>|<expiresAtUnix>|<difficultyBits>|<surface>|<payloadDigest>`. Challenge IDs and digests are canonical base64url strings in the signed text.
12. PoW work is SHA-256 over `UTF-8("shredit:pow:v1") || challengeIdBytes || payloadDigestBytes || counterUint64BigEndian`. The counter is an unsigned 64-bit big-endian integer and is transmitted as exactly 8 base64url-decoded bytes. Leading-zero difficulty is counted at the bit level, not as hexadecimal characters.
13. Challenges have a two-minute expiry and a Valkey single-use marker. Validation order is signature, expiry, exact surface, recomputed payload digest, difficulty, then atomic single-use consumption. An exact idempotency replay does not consume a second challenge; a new payload does.

## Passwords And Access Gates

14. Password omission is the only passwordless representation. `null`, an empty string, and whitespace-only values are not equivalent to omission. Submitted passwords are NFC-normalized without trimming and validated at 8-128 Unicode code points on both client and server.
15. Generated passwords are 20 characters from `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_`. Generated values and custom passwords stay in memory only; they never enter browser storage, URLs, logs, telemetry, or error reports.
16. Argon2id verification occurs outside a held database row lock, in a bounded worker pool with the configured timeout. Failure increments note/IP throttles and returns the same generic unavailable result as an absent note. A wrong password never consumes or changes capacity.
17. The password gate is not a key-derivation path. AES decryption still requires the fragment key, and the server never receives that key.

## Delivery, Idempotency, And Capacity

18. Passwordless consume starts one PostgreSQL transaction by locking the singleton `note_capacity` row, then atomically deletes an active/unexpired note and updates its idempotency tombstone and capacity counters before commit. The payload is returned only from the successful delete.
19. Protected consume uses a bounded two-phase flow: read/verify without a long write lock, then re-lock the capacity row and delete only when ID, expiry, and the previously read password hash still match. A concurrent winner or cleanup returns the generic unavailable result.
20. Create inserts the idempotency row and note row in one transaction after reserving capacity. The raw idempotency header is never stored; its digest is HMAC-SHA-256 with `IDEMPOTENCY_HMAC_SECRET`. Replays require the same digest, request fingerprint, and server-derived surface. A mismatch returns `409` without note information.
21. The idempotency fingerprint includes the password commitment (`HMAC-SHA-256(IDEMPOTENCY_HMAC_SECRET, normalizedPassword)`) but never the raw password or one-use Turnstile/PoW token. IP changes are allowed for an exact replay; clearnet/onion surface changes are not.
22. Expiry cleanup uses bounded batches and `FOR UPDATE SKIP LOCKED` or equivalent. Cleanup, consume, and create acquire locks in capacity-first order. Capacity reconciliation reports and repairs ledger drift but never silently deletes unexpired notes.
23. Retained idempotency tombstones block accidental note-ID reuse through a unique `note_id_digest` constraint until the configured retention cleanup removes them.

## API And HTTP Behavior

24. Every JSON mutation requires `Content-Type: application/json`, a strict runtime schema, a configured same-origin `Origin`, and a body limit enforced before JSON parsing. Unknown fields, duplicate JSON keys, malformed JSON, invalid enums, and non-canonical base64url return the stable JSON error contract.
25. All errors use `{ "error": { "code": "...", "message": "...", "retryable": boolean } }`, `Cache-Control: no-store`, and localized client-side copy. Server internals never appear in `message`.
26. Missing, malformed, expired, consumed, wrong-password, and database-hidden notes use the exact same `404 NOTE_UNAVAILABLE` status/body. Metadata is non-consuming and returns only `requiresPassword` for active rows.
27. `/health/live` touches neither PostgreSQL nor Valkey and returns `200 {"status":"ok"}`. `/health/ready` requires PostgreSQL, migrations, configuration, and capacity; it returns `valkey:"degraded"` when only Valkey is unavailable and returns `503` for database/migration failure.
28. Note, API, metadata, health, and error responses are `no-store`; note/API/health paths bypass reverse-proxy/CDN caches. Note pages are dynamically rendered with no prefetch/metadata consumption.
29. Reverse-proxy and application logs use route templates and redact query strings, fragments, bodies, note IDs, idempotency headers/digests, passwords, ciphertext, and keys. No browser persistence, service worker, Cache API, IndexedDB, localStorage, or sessionStorage is used for note data.
30. A loopback production preview may omit `GIT_REPOSITORY_URL` and use a non-commit local build label because no Git remote exists in the handoff workspace. The source controls are hidden in that state. Any non-loopback production origin still fails closed without an HTTPS repository URL and an exact hexadecimal commit.
31. Clearnet CSP includes Cloudflare Turnstile sources only when enabled. Onion CSP excludes all third-party sources and `upgrade-insecure-requests`. HSTS applies to the `.dev` origin, not to onion transport.

## Origins, Abuse Controls, And Operations

31. Canonical origins come only from `PUBLIC_BASE_URL` and optional `ONION_URL`; `Host`, `X-Forwarded-Host`, browser language, and client surface fields are never trusted for origin/policy decisions.
32. Client IP extraction uses only configured trusted proxy ranges. Rate-limit keys use HMAC-derived IP digests with short TTLs, never raw IP addresses. Unknown GeoIP is treated as non-CN when Turnstile is enabled, so Turnstile is required rather than bypassed.
33. Outside loopback production, the reverse proxy selects the request surface and overwrites `X-Shredit-Surface` with `clearnet` or `onion`. The Node runtime accepts that value only when the socket peer is inside `TRUSTED_PROXY_CIDRS`; mutations additionally require an exact configured browser `Origin`. Framework-derived `Host`, forwarded host, and scheme values never select the anti-abuse policy.
34. Valkey outage blocks new creation, protected opens, and required PoW/rate-limit state with retryable `503`; PostgreSQL-backed metadata and passwordless reads remain routable when safe.
35. Migrations and capacity reconciliation run once as Dokploy release commands. The application container starts only the standalone Next server. Cleanup is scheduled every five minutes with a single-worker lock.
36. Production configuration fails closed when required secrets, URLs, public commit metadata, or finite capacity limits are missing. Local tests use only local PostgreSQL/Valkey and never production credentials.
37. A create retry after `403 ANTI_ABUSE_FAILED`, `429`, `503`, `507`, or an ambiguous network failure preserves the exact fingerprint-bearing request fields, AES key, note ID, and `Idempotency-Key`, but discards one-use Turnstile/PoW material and obtains a fresh proof only after explicit user retry. A network failure before the create POST begins is an anti-abuse preparation error, not an uncertain creation result. Only `409 NOTE_ID_CONFLICT` regenerates the note ID, AES key, ciphertext, and idempotency key.
38. The owner changed the Dokploy contract on 2026-07-31: the production branch is `master`, and the standalone application listens on port `3232`. This operator decision overrides the frozen specification's earlier `main`/`3000` deployment defaults without changing the note protocol or public product behavior.

## Open Operator Decisions

The following are intentionally launch-only and must be supplied by the owner: final capacity limits; trusted proxy CIDRs and GeoIP path; onion provisioning and persistent hidden-service key; native EN/zh-CN copy review; final legal pages; and Shredit/Shred-it name/trademark review. They are configuration or publication gates, not reasons to add speculative product behavior.
