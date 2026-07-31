# Shredit Project Specification

**Status:** implementation-ready one-pass handoff. Specification only; implementation has not started.

**Version:** 1.1

**Date:** 2026-07-25

**Primary domain:** `https://shredit.dev`

**License:** `AGPL-3.0`

## 1. Implementation Contract

An implementation agent must read this document in full before writing code. It is the source of truth for product scope, security behavior, API semantics, and deployment expectations.

The implementation must not add accounts, files, Markdown, read receipts, sender management links, analytics, or speculative product features. When a value is marked as environment-controlled, make it configurable without changing the behavioral contract.

The implementation agent is expected to make the decisions already recorded here without stopping for product clarification. It must deliver a runnable repository, committed migrations, `.env.example`, Docker/Dokploy deployment files, public legal/security route stubs with clearly marked operator copy, automated tests, and the rendered-QA scripts described in section 18. It must not leave TODO placeholders for a behavior covered by this document; unresolved launch checks remain configuration or owner work, not hidden implementation choices.

## 2. Product Summary

Shredit is a public, no-account service for sharing plain-text notes that can be opened only once. A sender creates a note, receives a share link, and may add a password. The recipient must explicitly choose to open the note. Once the server hands the encrypted payload to a recipient, it is permanently removed from active storage.

The product is a focused alternative to Privnote, not a collaborative notes product, file transfer service, messaging platform, pastebin, or account system.

### Primary user jobs

1. Create a short one-time note in seconds.
2. Optionally require a separately shared password before it can be opened.
3. Share a link whose decryption key is not sent to the server.
4. Read and copy a note exactly once without accidental consumption by link previews.
5. Inspect public source code and the deployed commit without being told that the service has been independently audited.

## 3. Locked Decisions

| Area | Decision |
| --- | --- |
| Product name | `Shredit` |
| Domain | `shredit.dev` is owned and is the primary clearnet domain |
| Primary slogan | `Read once. Shred forever.` |
| Public creation | Anyone can create a note without registration |
| Content | Plain text only; no Markdown, HTML, files, images, or attachments |
| Note size | Maximum 64 KiB of UTF-8 plaintext |
| Default expiry | 7 days; the client and API use 7 days when no explicit value is sent |
| Expiry choices | 1 hour, 24 hours, 7 days, 30 days, and explicit `Never` |
| One-time action | A note is consumed only by an explicit `Open note` action |
| Password | Optional server-side access gate using Argon2id; it is not a second client-side encryption key in MVP |
| Storage | PostgreSQL is external and supplied only through `DATABASE_URL` |
| Backups | The operator disables backups for the note database; the application does not manage database backup policy |
| Rate limiting | Valkey is used for rate limiting and anti-abuse state only |
| CAPTCHA | Turnstile is configurable; traffic geolocated to `CN` bypasses it while normal rate limits remain |
| Onion | An optional onion mirror is configured by environment; it shares the same note database |
| Languages | English and Simplified Chinese (`zh-CN`) only; English is the fallback |
| Repository | Public source repository under AGPL-3.0 |
| Deployment | Direct Git-to-Dokploy build; no GHCR, signed-image workflow, or production JS comparison job is required |

## 4. Brand And Copy

### 4.1 Brand identity

- **Display name:** `Shredit` in prose, `shredit` where lowercase treatment is visually stronger.
- **Primary slogan:** `Read once. Shred forever.`
- **Supporting line:** `One link. One read. Gone.`
- **Source trust label:** `Open source - available for audit.`
- **Primary action:** `Create note`
- **Consume action:** `Open note`

### 4.2 Privacy language

Approved product wording must be concrete:

- `Encrypted in your browser. Stored as ciphertext.`
- `No account required.`
- `The decryption key stays in the link fragment and is not sent to the server.`
- `Open source - available for audit.`
- `Anonymous by design.*`
- `Privacy by design. Stronger over Tor.*`

The Tor footnote must be visible on the same surface as either privacy claim:

> Using the onion mirror through Tor can substantially reduce network-level exposure. It cannot protect against a compromised device, identifying content, recipient actions, modified client code, or advanced traffic correlation.

Do not ship claims of absolute anonymity, guaranteed anonymity, zero trace, guaranteed privacy, or completed independent audit unless those facts are demonstrably true for the deployed version.

`Anonymous by design.*` is permitted as a qualified design statement, not as a promise that every user is untraceable. Always render its footnote directly below or adjacent to the claim. Do not use the unqualified phrase `Absolutely anonymous`.

### 4.3 Voice

Direct, terse, calm, and slightly hard-edged. Avoid crypto hype, surveillance imagery, military language, legal-evasion language, and vague claims such as "military grade" or "unbreakable".

### 4.4 Brand risk

`Shred-it` is an existing document-destruction brand. Owning `shredit.dev` does not resolve possible trademark or marketplace-confusion concerns. Perform a targeted name and trademark review before public launch. This is a pre-launch gate, not a reason to change the current specification.

## 5. Scope

### 5.1 MVP includes

- Public anonymous note creation.
- Client-side encryption before upload.
- One-time note consumption after an explicit action.
- Optional password gate.
- Expiry selection with a visible default of 7 days.
- Copy link and copy password controls.
- Clearnet and optional onion links.
- EN and zh-CN localization.
- Source repository and deployed commit link.
- Rate limiting, configurable Turnstile, CN bypass, and onion anti-abuse controls.

### 5.2 Explicit non-goals

- Accounts, login, email, profiles, billing, teams, APIs for third parties, or sender dashboards.
- Files, images, Markdown, rich text, rendered URLs, previews, comments, replies, or downloads.
- Sender deletion links, status pages, read receipts, recovery, password reset, or note editing.
- Content moderation, plaintext inspection, analytics, advertising, trackers, or behavioral profiling.
- Guarantees against screenshots, copied text, compromised devices, a malicious recipient, or traffic correlation.
- A claim that a public repository equals an independent security audit.

## 6. User Experience

### 6.1 Create flow

1. The home page displays a large plaintext textarea, byte counter, optional password control, expiry selector, and `Create note` button.
2. The expiry selector starts at `7 days`. If the browser submits no expiry value, the server also treats it as 7 days.
3. The user may enable password protection. They can enter a password or generate one in the browser.
4. Before upload, the browser validates UTF-8 size, generates the note ID and encryption key, encrypts the text, and completes any required anti-abuse check.
5. The server stores only the opaque encrypted payload and returns success.
6. The result view shows the share link, a copy icon button, and, when relevant, the password with a separate copy control. The password is shown once and is never recoverable by the service.
7. The result view tells the sender to share the password through a different channel from the link.

### 6.2 Password behavior

- A generated password is 20 characters using a non-ambiguous ASCII alphabet.
- A custom password is NFC-normalized without trimming. It must be 8 to 128 Unicode code points.
- Passwords are never written to local storage, session storage, URLs, analytics, error reports, or application logs.
- The server receives a password only over HTTPS on clearnet or through the configured `.onion` origin over Tor's authenticated encrypted transport. Ordinary cleartext HTTP is never an accepted public origin. The server hashes the password with Argon2id and stores only the encoded hash.
- In MVP, the password is an access gate. It does not derive or replace the AES note key.

### 6.3 Open flow

1. Opening `/n/<id>` renders a neutral gate page and does not request or consume the payload.
2. Link previews, crawlers, GET requests, and page rendering must never consume a note.
3. The recipient supplies a password when one is required and explicitly selects `Open note`.
4. Only that POST request can atomically consume the record and return the encrypted payload.
5. The browser decrypts locally and renders the note as literal text using `textContent` and `white-space: pre-wrap`.
6. The note view includes a copy icon button. There is no download button, reply action, sender status, or second view.
7. After successful display, remove the fragment from the visible address bar with `history.replaceState`. Do not persist the text, key, or password.

### 6.4 Failure states

- Unavailable, expired, already-opened, malformed, and unknown notes use one generic unavailable state: `This note is unavailable. It may have expired or already been opened.`
- A password failure does not consume the note. The UI must not assert that the note exists; it should invite the recipient to check the password or link.
- A syntactically malformed fragment must be rejected in the browser before calling the consume endpoint.
- A valid-looking but incorrect fragment key cannot be validated by the server. If it reaches a successful consume request, decryption may fail after the note has been consumed. This is an accepted consequence of server-blind key handling and at-most-once delivery.

## 7. Cryptographic Protocol

### 7.1 Goals

- The server stores ciphertext, not plaintext.
- The AES key is not sent in an HTTP request.
- The URL path identifies the record; the URL fragment holds the browser-only decryption secret.
- The protocol is versioned from the first release.

### 7.2 Client-generated identifiers

The browser generates both values with `crypto.getRandomValues` before encryption:

- **Note ID:** 24 random bytes, encoded base64url without padding. It appears in the path and is at least 192 bits of entropy.
- **Note key:** 32 random bytes, encoded base64url without padding. It is 256 bits and appears only in the URL fragment.

The server inserts client-generated IDs with a unique constraint and never upserts. A collision returns a retryable conflict; the client generates a new ID and re-encrypts.

### 7.3 Encryption format

```text
protocolVersion = 1
plaintextBytes  = UTF-8(note text)
noteKey         = 32 random bytes
iv              = 12 random bytes
additionalData  = UTF-8("shredit:v1:" + noteId)
ciphertext      = AES-256-GCM(noteKey, iv, plaintextBytes, additionalData)
```

- Use the browser Web Crypto API only. Do not implement AES or random-number generation manually.
- AES-GCM authentication tag remains part of the returned ciphertext.
- Do not compress plaintext before encryption.
- Encode binary API fields as base64url without padding.
- Database storage is binary (`bytea`), not base64 text.

### 7.4 Link format

```text
https://shredit.dev/n/<note-id>#v1.<base64url-note-key>
```

The fragment is never intentionally copied into requests, server-side rendering, logs, referrers, analytics, metadata, or error reporting. A link generated on the onion surface uses the configured onion origin and the same path-plus-fragment format.

The client accepts only the canonical grammar `^/n/[A-Za-z0-9_-]{32}#v1\.[A-Za-z0-9_-]{43}$` after the origin is removed. The 32-character path value decodes to exactly 24 bytes and the 43-character key value decodes to exactly 32 bytes. Reject percent-encoded, padded, extra-segment, query-bearing, or version-mismatched fragments before any API request.

### 7.5 Payload limits

- `MAX_NOTE_PLAINTEXT_BYTES = 65536`.
- Enforce the plaintext limit in the browser using UTF-8 byte length, not character count.
- Reject decoded ciphertext above `65552` bytes (`65536 + 16-byte GCM tag`) on the server.
- Reject create bodies above `131072` bytes before JSON parsing.
- Never trust a client-provided size value.

## 8. One-Time Delivery Semantics

Shredit provides at-most-once payload delivery, not an exactly-once readable guarantee. Once the server successfully returns a payload for an explicit open request, the record is gone. A browser crash, network failure, invalid fragment, or local decryption failure after that point can make the note unavailable forever.

### 8.1 Passwordless consume

Use one PostgreSQL transaction. Lock the singleton capacity row first, then perform an operation equivalent to:

```sql
DELETE FROM notes
WHERE id = $1
  AND (expires_at IS NULL OR expires_at > now())
RETURNING protocol_version, iv, ciphertext;
```

If a row is returned, update the matching `note_create_idempotency` row by `note_id_digest`, set `note_deleted_at = now()`, decrement `note_capacity.active_note_count` and `note_capacity.active_payload_bytes`, and commit. If no row is returned, commit without changing counters and return the generic unavailable result. Exactly one concurrent caller can receive the payload.

### 8.2 Password-protected consume

Do not hold a database row lock while running the expensive Argon2id operation. Use this bounded two-phase flow:

1. Apply the per-note and per-IP failure/concurrency limits before verification, then read the row by ID without a long-held write lock.
2. If the row is absent, expired, or passwordless, return the generic unavailable result.
3. NFC-normalize the submitted password and verify it against the Argon2id hash in a bounded worker pool with a timeout.
4. On verification failure, leave the row untouched, increment password-attempt throttles, and return the same generic unavailable result. Do not reveal whether the ID exists.
5. On verification success, begin a transaction, lock the singleton capacity row, and atomically delete the still-active row with a predicate on ID, expiry, and the previously read password hash. If the delete returns a row, update its idempotency tombstone and decrement capacity counters in the same transaction, commit, and return the ciphertext. If no row returns, another caller or cleanup already won; return the generic unavailable result.

Do not add claim/acknowledgement leases, retry delivery, or server-side plaintext recovery in MVP.

## 9. Data Model

### 9.1 `notes` table

| Column | Type | Rules |
| --- | --- | --- |
| `id` | `text` primary key | Base64url-encoded 24-byte client-generated random ID |
| `protocol_version` | `smallint` | Currently `1` |
| `iv` | `bytea` | Exactly 12 bytes |
| `ciphertext` | `bytea` | Opaque encrypted payload including GCM tag |
| `payload_bytes` | `integer` | Derived from decoded ciphertext, never trusted from client input |
| `password_hash` | `text nullable` | Encoded Argon2id result; null means no password |
| `expires_at` | `timestamptz nullable` | Null only for explicit `Never` |
| `created_at` | `timestamptz` | Server timestamp |

Required indexes:

- Primary key on `id`.
- Index on `expires_at` for cleanup.

Required database constraints:

- `protocol_version = 1`.
- `octet_length(iv) = 12`.
- `payload_bytes = octet_length(ciphertext)` and `16 <= payload_bytes <= 65552`.
- `id` matches the base64url alphabet and has exactly 32 characters (the encoding of 24 random bytes).
- `expires_at IS NULL` is allowed only for the explicit `Never` selection; all other rows have an expiry timestamp after creation.
- `created_at` is server-generated with `now()` and cannot be supplied by the client.

Do not store plaintext, AES keys, password values, sender identity, recipient identity, read timestamps, IP addresses, user agents, or tracking IDs in the note table.

### 9.1.1 Capacity ledger

High-water checks must be atomic. Add one singleton `note_capacity` row with `id = 1`, `active_note_count`, `active_payload_bytes`, and `updated_at`.

The row has `active_note_count BIGINT >= 0`, `active_payload_bytes BIGINT >= 0` (sum of stored ciphertext bytes including GCM tags), and a primary key on `id`. Initialize it from existing active notes during the migration. Do not calculate capacity from an unlocked `COUNT(*)` in the request path.

- During creation, lock the singleton row with `SELECT ... FOR UPDATE`, reject with `507` when adding one note or its `payload_bytes` would exceed `MAX_ACTIVE_NOTE_COUNT` or `MAX_ACTIVE_NOTE_BYTES`, insert the note and its idempotency row, and increment both counters in the same transaction.
- During successful consume or expiry cleanup, delete the note and decrement both counters in the same transaction. A wrong password never changes the counters.
- Cleanup uses bounded batches and `FOR UPDATE SKIP LOCKED` or an equivalent transaction-safe strategy so concurrent cleanup workers cannot double-decrement.
- Provide a reconciliation command that recomputes the counters from active `notes` rows and reports/fixes drift. The application must not silently delete unexpired notes to correct a ledger mismatch.
- All create, consume, and expiry-cleanup transactions acquire the capacity lock before note/idempotency row locks so concurrent paths use one lock order and cannot deadlock.

### 9.2 Password hashing

Use Argon2id with configuration defaults:

```text
ARGON2_MEMORY_KIB=65536
ARGON2_TIME_COST=3
ARGON2_PARALLELISM=1
ARGON2_HASH_LENGTH=32
ARGON2_MAX_CONCURRENCY=4
ARGON2_VERIFY_TIMEOUT_MS=5000
```

Use a mature maintained Node package. Store its complete encoded result so the salt and parameters travel with the hash. Do not create a custom password hash format.

### 9.3 Create idempotency record

The create path must survive a response lost after the database commit. Add a small server-only `note_create_idempotency` table:

| Column | Type | Rules |
| --- | --- | --- |
| `key_digest` | `bytea` primary key | HMAC-SHA-256 of the client `Idempotency-Key`; never store the raw header value |
| `request_fingerprint` | `bytea` | SHA-256 of a canonical request fingerprint, including the password commitment but excluding one-use anti-abuse tokens |
| `note_id_digest` | `bytea` | HMAC-SHA-256 of the client note ID; used to prevent accidental ID reuse while the tombstone is retained |
| `created_at` | `timestamptz` | Server timestamp |
| `note_deleted_at` | `timestamptz nullable` | Set in the same transaction when the note expires or is consumed |
| `response_expires_at` | `timestamptz nullable` | The same expiry value returned by create; null for `Never` |
| `surface` | `text` | Server-derived `clearnet` or `onion`; exact surface is required for replay |

Required idempotency constraints and indexes:

- Primary key on `key_digest`.
- Unique constraint on `note_id_digest` so a retained tombstone blocks accidental note-ID reuse, even after the original note row is gone.
- `octet_length(key_digest) = 32`, `octet_length(request_fingerprint) = 32`, and `octet_length(note_id_digest) = 32`.
- `surface IN ('clearnet', 'onion')`.
- Index on `note_deleted_at` for bounded tombstone cleanup.

The client generates a fresh 24-byte `Idempotency-Key` for each new note attempt, base64url-encodes it without padding, and holds it only in memory. It is sent as a request header, never placed in the URL, browser storage, logs, metrics, or error reports. The server computes the key digest with `IDEMPOTENCY_HMAC_SECRET`. The request fingerprint uses a deterministic, length-prefixed encoding of server-derived `surface`, `id`, `protocolVersion`, `iv`, `ciphertext`, `expiresIn`, and `HMAC-SHA-256(IDEMPOTENCY_HMAC_SECRET, normalized password)`; the raw password and anti-abuse tokens are never stored in the fingerprint.

Include the server-derived `surface` in the fingerprint and require it to match on replay. The server must never trust a client-supplied surface or host header. IP changes are allowed for a replay; the onion/clearnet surface is not.

Insert the idempotency row and the note row in one PostgreSQL transaction. An exact replay of the same key, fingerprint, and surface returns the original non-secret creation response without inserting another note or consuming a new Turnstile/PoW token. Reuse of a key with a different fingerprint or surface returns `409 Conflict`. A note-ID collision with a different key returns `409 Conflict`; the browser generates a new ID, a fresh encryption key, and a fresh idempotency key, re-encrypts, and retries once.

When a note is consumed or removed by expiry cleanup, mark `note_deleted_at` in the same transaction. Keep the idempotency row while the note is active and for `IDEMPOTENCY_TOMBSTONE_RETENTION_DAYS` after deletion. Tombstone cleanup must never make a still-active note retryable. A client must never intentionally reuse a note ID or idempotency key after the tombstone retention window.

Keep `IDEMPOTENCY_HMAC_SECRET` stable for at least the tombstone-retention period plus the maximum supported retry window. Do not rotate it in place while matching tombstones exist; a future key-rotation migration must add a key-version column and support the previous secret until all corresponding tombstones are gone.

## 10. API Contract

All mutation endpoints are same-origin JSON endpoints. Do not enable permissive CORS. Require a valid `Origin` matching configured public origins and reject unexpected content types.

### 10.0 Validation and error contract

- Require `Content-Type: application/json` for JSON mutations and reject other media types with `415` before parsing.
- Enforce the 131072-byte create-body limit at the reverse proxy and at the Node request boundary before JSON parsing. Reject malformed JSON, duplicate JSON keys, unknown fields, invalid base64url, non-canonical encodings, and invalid enum values with `400`.
- Use one strict runtime schema (for example, Zod) shared by route handlers and tests. Never rely on TypeScript types as runtime validation.
- Mutations require an exact configured `Origin` for the current clearnet or onion surface. Missing or unexpected origins return `403`; do not trust `Host`, `X-Forwarded-Host`, browser language, or a client-supplied surface field.
- Error responses are always JSON, `Cache-Control: no-store`, and have this shape. The client maps stable `code` values to localized copy; server internals never appear in `message`.

```json
{
  "error": {
    "code": "NOTE_UNAVAILABLE",
    "message": "This note is unavailable.",
    "retryable": false
  }
}
```

| Status | Codes | Contract |
| ---: | --- | --- |
| `400` | `BAD_REQUEST` | Malformed JSON, invalid create-body schema, malformed `Idempotency-Key`, missing required field, or invalid password format |
| `403` | `ORIGIN_FORBIDDEN`, `ANTI_ABUSE_FAILED` | Unexpected origin or failed Turnstile/PoW verification; no note information |
| `404` | `NOTE_UNAVAILABLE` | Missing, expired, consumed, malformed, or wrong-password note access; use the exact same body and status for all of these cases |
| `409` | `IDEMPOTENCY_CONFLICT`, `NOTE_ID_CONFLICT` | Same idempotency key with a different request/surface, or a client ID collision |
| `413` | `REQUEST_TOO_LARGE` | Body exceeds the route limit before JSON parsing |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | Request is not `application/json` |
| `429` | `RATE_LIMITED`, `PASSWORD_THROTTLED` | Retryable abuse limit; include integer-seconds `Retry-After` |
| `503` | `DEPENDENCY_UNAVAILABLE` | PostgreSQL, Valkey, Turnstile, or required PoW state is unavailable; existing reads remain available when PostgreSQL is healthy |
| `507` | `STORAGE_FULL` | Atomic capacity ledger rejected creation |

The client may perform a fresh non-consuming metadata request after a protected open returns `NOTE_UNAVAILABLE`. If metadata still returns `200` with `requiresPassword: true`, keep the password field and show neutral retry guidance; if metadata returns `404`, show the terminal unavailable state. The API must never send a distinct wrong-password body that reveals note existence.

### 10.1 Create note

`POST /api/v1/notes`

Required header:

```text
Idempotency-Key: <base64url-24-byte-random-value>
```

Request body:

```json
{
  "id": "base64url-random-note-id",
  "protocolVersion": 1,
  "iv": "base64url-12-byte-iv",
  "ciphertext": "base64url-ciphertext",
  "expiresIn": "1h|24h|7d|30d|never",
  "password": "optional-password",
  "turnstileToken": "optional-token",
  "pow": {
    "challenge": "optional-signed-challenge",
    "nonce": "optional-work-nonce"
  }
}
```

Rules:

- Omitted `expiresIn` is normalized to `7d`.
- `password` is accepted only over HTTPS on clearnet or through the configured `.onion` origin over Tor's authenticated encrypted transport. It is never accepted over ordinary cleartext HTTP and is never included in a response or log.
- Omit `password` entirely for a passwordless note. `null`, an empty string, or a password that fails server-side NFC/code-point validation is invalid; an omitted field is the only representation of no password.
- The server repeats NFC normalization and the 8-128 Unicode code-point validation before hashing. Never trust browser-only validation.
- The request schema is strict. A retry after a note-ID collision generates a fresh note ID, fresh encryption key, and fresh `Idempotency-Key`.
- Anti-abuse fields are validated according to request surface and policy.
- The initial response is `201 Created` with exactly `{ "id": "...", "expiresAt": "<ISO-8601 UTC timestamp or null>" }`. The browser constructs the final URL locally from its existing fragment key.
- An exact idempotent replay returns `200 OK` with the same response body and does not create a second note. It may include `Idempotent-Replay: true` for diagnostics; this header is not required by the client.
- A missing or malformed idempotency key returns `400`. A key/fingerprint mismatch returns `409`. Neither response includes note contents, passwords, ciphertext, or whether another user's note exists.

The browser must not automatically submit a new create request after a network timeout. It keeps the form, ciphertext, note ID, encryption key, and idempotency key in memory and shows an explicit uncertain-result state: `The request may have succeeded. Retry with the same request.` The user can select `Retry creation`, which repeats the exact request. If the original transaction committed, the server replays the original response; if it did not, the same transaction creates the note once. A fresh note is generated only after the user explicitly chooses to start over.

### 10.2 Open note

`POST /api/v1/notes/:id/open`

Request body:

```json
{
  "password": "optional-password"
}
```

Successful response:

```json
{
  "protocolVersion": 1,
  "id": "note-id",
  "iv": "base64url-12-byte-iv",
  "ciphertext": "base64url-ciphertext"
}
```

The browser verifies ID and protocol version, reconstructs the specified AAD, and decrypts locally. Missing, expired, consumed, wrong-password, malformed-ID, or invalid-access results all return the exact generic `404 NOTE_UNAVAILABLE` error and never return payload data. A password failure still increments throttles without deleting the note.

### 10.3 Note metadata

GET /api/v1/notes/:id/meta

This endpoint is non-consuming and returns only the minimum gate state:

```json
{
  "requiresPassword": true
}
```

It never returns ciphertext, plaintext, keys, password hashes, expiry timestamps, or the full note URL. An active row returns `200` with exactly one boolean field. Missing, expired, consumed, malformed, and database-hidden rows return the exact generic `404 NOTE_UNAVAILABLE` body; never return `requiresPassword: false` for an unavailable row. Every response is `Cache-Control: no-store`. The route and recipient page must be dynamically rendered (`dynamic = 'force-dynamic'`, `revalidate = 0`, and `fetchCache = 'force-no-store'` or equivalent), and the reverse proxy/CDN must bypass caching. The recipient page uses this route only to decide whether to show the password field; link previews and crawlers still cannot consume the note.

### 10.4 Proof-of-work challenge

`POST /api/v1/anti-abuse/pow-challenge`

Used only where policy requires proof-of-work, initially onion requests. The client first computes a payload digest and requests a challenge:

```json
{
  "surface": "onion",
  "payloadDigest": "base64url-sha256"
}
```

`payloadDigest` is `SHA-256` over a deterministic length-prefixed encoding of the server-relevant create tuple: `surface`, `id`, `protocolVersion`, decoded `iv`, decoded `ciphertext`, and `expiresIn`. The server derives `surface` from the configured request origin, accepts the request only when the supplied value matches, and never trusts the client field for policy decisions.

The challenge response is:

```json
{
  "version": 1,
  "challengeId": "base64url-16-random-bytes",
  "expiresAtUnix": 1730000000,
  "difficultyBits": 18,
  "surface": "onion",
  "payloadDigest": "base64url-sha256",
  "signature": "base64url-32-byte-hmac"
}
```

The signed canonical bytes are the UTF-8 string `shredit:pow:v1|<challengeId>|<expiresAtUnix>|<difficultyBits>|<surface>|<payloadDigest>`. `signature` is `HMAC-SHA-256(POW_SECRET, canonicalBytes)`. Challenges expire after two minutes, are single-use in Valkey, and are bound to the exact payload digest and onion surface.

The client solves with a Web Worker using an unsigned 64-bit big-endian counter:

```text
SHA-256(UTF-8("shredit:pow:v1") || challenge-id-bytes || payload-digest-bytes || counter-uint64-big-endian)
```

until the configured number of leading zero bits is reached. The create request sends the signed challenge as `pow.challenge` and the counter as `pow.nonce` (base64url-encoded 8 bytes). The server verifies signature, expiry, surface, recomputed payload digest, leading-zero difficulty, and single use through Valkey before insertion. An exact idempotent replay bypasses consuming a second challenge; a new payload always needs a new challenge.

Proof-of-work is anti-abuse friction, not a privacy or cryptographic confidentiality feature.

### 10.5 Other routes

| Route | Behavior |
| --- | --- |
| `/` | Note creation page |
| `/n/:id` | Generic recipient gate; never consumes |
| `/privacy` | Privacy, retention, and Tor limitations |
| `/security` | Threat model, source link, commit information, vulnerability reporting path |
| `/terms` | Terms of use and responsible-use boundaries |
| `/abuse` | Abuse report contact and handling policy |
| `/.well-known/security.txt` | Public security contact policy |
| `/health/live` | Process liveness only |
| `/health/ready` | PostgreSQL, migrations, and required configuration readiness; Valkey may be degraded |

`/.well-known/security.txt` is a public `text/plain` route with at least `Contact:`, `Policy:`, `Canonical:`, and a future `Expires:` date. `Contact` and `Policy` values come from the operator's public configuration or committed legal content; do not put secrets or private database addresses in the file. It must not be localized or redirected by locale middleware.

`/health/live` returns `200 {"status":"ok"}` without touching PostgreSQL or Valkey. `/health/ready` returns `200 {"status":"ready","valkey":"ok"}` or `200 {"status":"ready","valkey":"degraded"}` when PostgreSQL, migrations, required configuration, and capacity state are healthy; it returns `503 {"status":"not_ready"}` when PostgreSQL or migrations are unavailable. Health bodies contain no note data and always use `Cache-Control: no-store`.

## 11. Expiry, Cleanup, And Capacity

### 11.1 Expiry

- Valid selections are `1h`, `24h`, `7d`, `30d`, and `never`.
- `7d` is the UI preselection and server fallback.
- Expiry begins at successful creation.
- Read paths enforce expiry even when cleanup has not yet run.
- A scheduled cleanup job hard-deletes expired rows in bounded batches every five minutes. Each batch updates the matching idempotency tombstone and capacity ledger in the same transaction.

### 11.2 Capacity

Public anonymous creation plus `Never` can exhaust storage. Capacity protection is mandatory:

- Track active ciphertext bytes and active note count in the locked singleton ledger defined in section 9.1.1.
- Configure `MAX_ACTIVE_NOTE_BYTES` and `MAX_ACTIVE_NOTE_COUNT` in production. Missing production values fail startup or readiness; the app must not silently run without a finite capacity policy.
- Reject new creations with `507 Insufficient Storage` inside the same transaction that reserves capacity and inserts the note.
- Never silently delete unexpired notes to reclaim space.
- Monitor actual PostgreSQL disk use and table bloat, not only application counters.

The implementation should rely on PostgreSQL autovacuum and document any operator maintenance needed for a high-churn delete workload. Run the capacity reconciliation command after migration and make its result visible in deploy logs without exposing note IDs or contents.

## 12. Public Abuse Controls

### 12.1 Clearnet limits

Defaults are environment-controlled:

```text
CREATE_LIMIT_PER_IP_HOUR=10
CREATE_LIMIT_PER_IP_DAY=50
PASSWORD_FAILURE_LIMIT_PER_NOTE_15M=5
PASSWORD_FAILURE_LIMIT_PER_IP_HOUR=50
```

Use only a trusted reverse-proxy source for client IP extraction. Never trust arbitrary inbound `X-Forwarded-For` headers. Valkey keys must use an HMAC of IP data with a rotating server secret and short TTL, not raw IP values.

Rate-limit algorithm contract:

- Use independent fixed-window counters for the hourly and daily create limits. The first `INCR` sets the corresponding `EXPIRE` atomically to 3600 or 86400 seconds; a request is rejected when the increment would exceed its limit.
- Normalize IPv4 and IPv6 addresses before hashing. If the trusted proxy supplies no usable address, use an `unknown-ip` bucket with stricter configured limits; never accept a browser-provided address.
- Derive keys as `HMAC-SHA-256(IP_HASH_SECRET, surface || normalizedIp || windowName)`. Keep the active and previous IP hash secrets valid for the maximum counter TTL during rotation; never store the raw address.
- Password failures use the same fixed-window approach with separate HMAC keys for note ID digest and normalized IP digest. A failure increments both the per-note and per-IP counters before Argon2 verification is allowed.
- Rate-limit responses include `Retry-After` in integer seconds and the UI maps them to the neutral throttling copy.

### 12.2 Turnstile and CN policy

- Turnstile is enabled only when configuration says it is enabled.
- Clearnet requests geolocated as `CN` bypass Turnstile by product decision, but do not bypass rate limits or body-size limits.
- Country is determined by a trusted reverse proxy or a local GeoIP database, never a browser header or UI language.
- Unknown country or GeoIP failure requires Turnstile when Turnstile is enabled.
- Turnstile verification happens server-side. Verify the token's configured hostname and action as well as its success status. Never trust a client-only success signal.

### 12.3 Onion policy

- Onion requests bypass Turnstile completely.
- Onion requests use a separate host-level Valkey token bucket because a useful client IP is unavailable.
- Onion creation initially requires the signed one-use proof-of-work challenge described above.
- Configure global onion quotas by payload weight. The cost is `ceil(ciphertextBytes / 8192)` tokens with a minimum of one; default buckets are 200 tokens per hour, 1000 tokens per day, and a burst of 20 tokens.
- Determine onion versus clearnet from the configured canonical origin selected by the trusted request host. Never allow a client field or arbitrary `Host` value to select the onion policy.
- Do not load Turnstile, analytics, remote fonts, images, or any other third-party resource on the onion surface.

Anti-abuse policy matrix:

| Request surface | Turnstile | Proof of work | Quota |
| --- | --- | --- | --- |
| Clearnet, country not `CN`, Turnstile enabled | Required and server-verified | Not required | Per-IP create limits |
| Clearnet, country `CN` | Bypassed by product policy | Not required | Per-IP create limits |
| Clearnet, Turnstile disabled | Disabled | Not required | Per-IP create limits |
| Configured onion origin | Always bypassed | Required for create | Global weighted onion bucket |

All surfaces keep body-size, password-failure, capacity, and generic origin checks. A request cannot select a cheaper policy by changing `Host`, `Origin`, or a JSON field.

If Valkey or the anti-abuse policy is unavailable, new note creation and password-protected opens fail closed with a retryable `503`. Passwordless note opens and metadata reads continue to work when PostgreSQL is available. `/health/ready` remains ready when PostgreSQL and migrations are healthy, and may expose only a non-sensitive degraded dependency flag; it must not remove the application from routing solely because Valkey is down.

## 13. Privacy And Security Controls

### 13.1 Data handling

- Do not log note text, ciphertext, passwords, keys, full URLs, query strings, or note IDs.
- Use route templates in logs rather than request paths for note routes.
- Do not use analytics, ad scripts, session replay, third-party error reporting, or remote fonts.
- Do not write secrets to browser storage. Keep keys and plaintext in memory only for the active user action.
- Do not register a service worker or use Cache API, IndexedDB, localStorage, or sessionStorage for note data, keys, passwords, or share results.
- Before any create or open action, verify that `crypto.subtle` and the required Web Crypto algorithms are available in the current origin. If the onion browser/runtime does not treat the configured origin as a secure context, show a clear unsupported-browser state and do not send plaintext or a note key.
- Do not create Open Graph content that fetches or exposes a note.

### 13.2 HTTP headers

Apply at least:

```text
Cache-Control: no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Robots-Tag: noindex, noarchive, nosnippet
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

Use a nonce-based strict Content Security Policy. On clearnet, the baseline is `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'nonce-{per-response}' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data:; font-src 'self'; worker-src 'self' blob:; manifest-src 'none'; media-src 'none'; child-src 'none'; upgrade-insecure-requests`. Include the Cloudflare sources only when Turnstile is enabled. Never use `unsafe-eval`; do not use `unsafe-inline` for scripts.

Onion responses use the same baseline without `https://challenges.cloudflare.com` and without `upgrade-insecure-requests`; no Cloudflare or other third-party source is permitted. All HTML, API, metadata, health, and error responses use `Cache-Control: no-store`. The note route, metadata route, and server components must be dynamically rendered (`dynamic = 'force-dynamic'`, `revalidate = 0`, and `fetchCache = 'force-no-store'` or equivalent). Configure the reverse proxy/CDN to bypass caching for `/n/*`, `/api/*`, and `/health/*`.

Apply HSTS to the `.dev` clearnet domain. Do not force HSTS or HTTPS semantics on an onion URL; the onion deployment may intentionally use `http://` inside Tor's authenticated encrypted transport.

### 13.3 Public origins

Never build share URLs from an untrusted `Host` or `X-Forwarded-Host` header. Use configured canonical origins:

```text
PUBLIC_BASE_URL=https://shredit.dev
ONION_URL=http://example-onion-address.onion
```

`ONION_URL` is public configuration but should be injected from server runtime configuration rather than treated as a secret. If it changes, the app may require a rebuild or server-rendered configuration update; document the chosen behavior in deployment notes.

## 14. Application Architecture

### 14.1 Required stack

- Next.js with TypeScript and App Router.
- Use Node.js `22.x` LTS and `pnpm` `10.x`; commit `package.json`, `pnpm-lock.yaml`, and the exact resolved dependency versions. Do not use canary framework releases.
- Node.js runtime only; do not use Edge runtime for database, Argon2id, or Valkey routes.
- External PostgreSQL through `DATABASE_URL`.
- Drizzle ORM and committed SQL migrations.
- Valkey for short-lived rate-limit, password-throttle, and proof-of-work state.
- Web Crypto API in the browser.
- Tailwind CSS for implementation styling.
- `next-intl` with locale-prefix disabled, or an equivalent local message system for `en` and `zh-CN`.
- Zod or an equivalent strict runtime schema validator for every external JSON body and environment schema.
- Vitest (or equivalent) for unit/integration tests and Playwright for rendered browser QA.
- Lucide icons or the selected local icon library for copy, regenerate-password, language, and external-link controls.

### 14.2 Suggested repository layout

```text
app/
  (site)/page.tsx
  (site)/n/[id]/page.tsx
  (site)/privacy/page.tsx
  (site)/security/page.tsx
  (site)/terms/page.tsx
  (site)/abuse/page.tsx
  api/v1/notes/route.ts
  api/v1/notes/[id]/open/route.ts
  api/v1/notes/[id]/meta/route.ts
  api/v1/anti-abuse/pow-challenge/route.ts
  health/live/route.ts
  health/ready/route.ts
components/
lib/
  crypto/
  database/
  rate-limit/
  anti-abuse/
  config/
drizzle/
messages/
  en.json
  zh-CN.json
middleware.ts
app/.well-known/security.txt/route.ts
scripts/
  cleanup-expired.ts
docs/
  DESIGN.md
  THREAT_MODEL.md
  SECURITY.md
.env.example
```

Use locale negotiation and a locale cookie or equivalent middleware without putting a locale segment into note links. Middleware must exclude `/api`, `/health`, `/.well-known`, static assets, and `/n/:id` from locale redirects or rewrites. The canonical share format remains exactly `/n/<id>#v1.<key>` on both clearnet and onion origins. The implementation may refine file names, but it must preserve the ownership boundaries: browser crypto stays client-side; database and anti-abuse code stays server-side; no secrets are imported by client components.

## 15. Design System Direction

### 15.1 Visual thesis

Shredit is a quiet utility with a hard edge: fast to scan, deliberately sparse, and visibly trustworthy without looking like a crypto dashboard or a military terminal.

### 15.2 Principles

1. The note composer is the first-screen product, not a marketing hero.
2. One decisive primary action per state.
3. Strong typography and real hierarchy instead of decorative cards or gradients.
4. Security information is factual and accessible, never theatrical.
5. Dense enough for repeated use, but generous enough for a large text field and mobile composition.

### 15.3 Anti-principles

- No nested cards, floating page sections, bokeh, gradient blobs, or generic SaaS dashboard styling.
- No dark cyberpunk wallpaper, padlock illustrations, stock imagery, or fake command-line visuals.
- No giant hero copy that pushes the note composer below the first viewport.
- No rounded text buttons when a familiar icon button is clearer.

### 15.4 Token and component ownership

During implementation, use the official 21st.dev MCP only for focused component evidence and variants. Do not paste generated snippets blindly. The local `docs/DESIGN.md`, semantic token source, and component APIs become the authority.

The first implementation pass must create one three-layer token system:

1. Primitive colors, spacing, radii, typography, motion, and elevation.
2. Semantic roles such as canvas, surface, text, border, action, focus, success, warning, and danger.
3. Component variants only where semantic tokens are insufficient.

Required reusable components:

- `NoteComposer`
- `ByteCounter`
- `ExpirySelect`
- `PasswordControl`
- `CopyButton`
- `GeneratedPasswordField`
- `CreateResult`
- `OpenNoteGate`
- `NoteViewer`
- `UnavailableNoteState`
- `LanguageMenu`
- `TorLink`
- `BuildInfoFooter`

Each component needs default, hover, active, focus-visible, disabled, loading, validation/error, and long-localization behavior where relevant.

### 15.5 Layout and accessibility

- Desktop, tablet, mobile, and narrow mobile are first-class targets.
- Use stable control heights and no viewport-scaled font sizes.
- Keep body text, form labels, errors, and Chinese fallback fonts readable without layout shift.
- Use semantic HTML, visible focus rings, keyboard-complete controls, 44px minimum touch targets where practical, and WCAG AA contrast for normal text.
- Respect `prefers-reduced-motion`.

### 15.6 Screen-by-screen UX contract

This section is behavioral acceptance criteria for the implementation agent. It is more authoritative than a visual mockup. Every state must remain usable with JavaScript errors, slow network, denied clipboard permission, long Chinese labels, long passwords, and a 320px-wide viewport.

#### 15.6.1 Global shell

- The site is a focused utility, not a landing page or marketing hero.
- Use one compact header of approximately 64px height. The left side contains the `Shredit` mark and slogan; the right side contains the language control and a `View source` link.
- The main content sits in a maximum 1120px shell. The active task itself is limited to approximately 760px so the textarea, gate, and revealed note remain easy to scan.
- The page has one framed tool surface at a time. Do not put cards inside cards or turn the whole page into a collection of floating panels.
- The footer may fall below the first viewport. It contains source/commit information, privacy/security links, the optional onion link, and the Tor limitation footnote.
- No analytics, remote fonts, external images, preview metadata, or third-party resources are loaded on the onion surface.
- The locale control switches between `English` and `简体中文`. Locale selection is client/server configuration, not part of the share URL.

#### 15.6.2 Create screen: `/`

The first viewport must expose the active task and its primary action at `1440x900`, `1024x768`, and `390x844`. At `320x700`, the textarea, required controls, and `Create note` button must remain reachable without horizontal scrolling.

Required order:

1. Compact heading `Create a one-time note` and the slogan `Read once. Shred forever.`
2. Factual privacy line `Encrypted in your browser. Stored as ciphertext.`
3. Qualified privacy line `Anonymous by design.*` with the Tor limitation footnote available on the same surface.
4. A labeled native textarea for `Your note`.
5. A UTF-8 byte counter immediately below the textarea.
6. An expiry select, preselected to `7 days`.
7. A `Protect with a password` switch or checkbox.
8. A conditional password control when protection is enabled.
9. A reserved anti-abuse slot with stable dimensions.
10. A full-width `Create note` submit button.

Textarea contract:

- Desktop minimum height is approximately 220px; mobile minimum height is approximately 180px.
- Preserve newlines and tabs. Do not auto-resize in a way that pushes the submit button unpredictably below the viewport.
- Enforce the 64 KiB limit using UTF-8 bytes. The counter uses a localized format such as `0 / 65,536 bytes` and has `aria-live="polite"`.
- Empty, over-limit, or invalid input is rejected before encryption. The field error is connected with `aria-describedby` and `aria-invalid`.

Expiry and password contract:

- Options are exactly `1 hour`, `24 hours`, `7 days`, `30 days`, and `Never`; `7 days` is selected on first render.
- The password switch does not clear the note text when toggled.
- The generated password is 20 characters from the approved non-ambiguous ASCII alphabet `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_`.
- Custom passwords are NFC-normalized without trimming and must contain 8 to 128 Unicode code points.
- Password controls use `autocomplete="new-password"`. Show/hide, generate, and copy are icon-only buttons with accessible names and tooltips; each has a stable 44px hit area.
- The generated or custom password is memory-only. Toggling, changing locale, reload, and navigation must not write it to browser storage.

Anti-abuse and submit contract:

- Reserve the anti-abuse area even when no widget is required, so CN bypass and a disabled Turnstile do not move the form.
- Clearnet Turnstile is rendered only when server policy requires it. CN clearnet traffic bypasses the widget while normal quotas remain. Onion creation shows the compact Web Worker proof-of-work state instead of Turnstile.
- The submit button is disabled only for empty/invalid/over-limit input, unavailable Web Crypto, unresolved required anti-abuse, or an active submission. It must not be disabled merely because optional password protection is off.
- On submit, preserve layout dimensions, show `Creating note...`, prevent double submission, generate the note ID/key and idempotency key in memory, encrypt, and send one create request.
- Preserve note text, password, selected expiry, ciphertext, key, and idempotency key after a retryable error.
- A `429`, `503`, or `507` response is concise and retryable. It must not expose server internals or clear the form.
- A lost response enters the explicit uncertain-result state described in section 10.1. The UI offers `Retry creation` with the same request and does not silently create a second note.

#### 15.6.3 Creation success screen

Replace the composer with one success surface headed `Your note is ready.` Never display plaintext in this state.

- Show the clearnet share link in a read-only, selectable value area. Use a `minmax(0, 1fr) auto` layout so the URL can wrap without moving the copy button.
- Render the copy control as a 44px icon button with an accessible name. Announce `Link copied` in a polite live region. If clipboard permission is denied, keep the value selectable and show `Copy failed. Select and copy manually.` with a retry control.
- If protected, show the password in a separate row with independent show/hide and copy controls. Do not combine the password and URL into one field or one copy action.
- Show `Share the password through a different channel from the link.` and `Keep this password. It cannot be recovered.`
- If `ONION_URL` is configured, show a separate onion link row and explain that it uses the same note/key. Do not silently replace the clearnet link.
- Show the selected expiry only as a non-sensitive confirmation; never expose a note existence/status endpoint to the sender.
- `Create another note` clears all in-memory plaintext, password, ciphertext, key, idempotency key, and result state before returning to the empty composer.
- Reloading the page cannot recover the success state because no result is persisted in local or session storage.

#### 15.6.4 Recipient gate: `/n/:id`

- Disable framework/router prefetch for note links. Rendering, GET, metadata fetch, crawler requests, and link previews never consume a note.
- Parse and validate the fragment locally before any API call. A missing or malformed fragment shows `This link cannot be opened.` and does not send the fragment to the server.
- The first viewport is neutral and contains `Ready to open?` plus `Opening the note will destroy it.`
- Use `GET /api/v1/notes/:id/meta` only to decide whether a password field is needed. The metadata response must not disclose expiry, existence, ciphertext, or state beyond `requiresPassword`.
- Passwordless notes show only the explicit `Open note` action. Protected notes show a password input with `autocomplete="current-password"` and the same explicit action.
- Focus the password field after metadata confirms it is required. For passwordless notes, focus the heading or CTA without triggering the action.
- Pressing Enter submits the gate form. During submission, preserve geometry, show `Opening note...`, and disable duplicate clicks.
- A wrong password leaves the note intact, does not reveal whether a note exists, and returns the generic `404 NOTE_UNAVAILABLE`. The client may immediately re-fetch non-consuming metadata: if the note is still active and password-protected, return focus to the password field with neutral guidance; otherwise show the terminal unavailable state.
- A transport failure before a consume response may offer an explicit `Try again`. Never auto-retry a request that may already have consumed the note.
- `404`, `410`, expired, consumed, and generic unavailable results all use the same unavailable state below.

#### 15.6.5 Revealed note screen

- After a successful consume response and successful local AES-GCM decryption, immediately call `history.replaceState` to remove the fragment from the visible address bar. Do not navigate in a way that reloads the page.
- Render the plaintext with `textContent`, `white-space: pre-wrap`, preservation of tabs/newlines, and `overflow-wrap: anywhere`. Do not use `innerHTML`, Markdown, HTML rendering, or a nested scrolling pane.
- Heading: `Note opened.` Move focus to a non-interactive heading with `tabindex="-1"` and announce the state once.
- Place one adjacent `Copy note` icon button. Announce `Note copied` or the clipboard failure message through a polite live region.
- Show the factual lifecycle line `Removed from active storage.` Do not claim that backups, screenshots, browser history, or recipient copies were erased.
- Do not offer download, reply, forward, sender status, second-open, or read-receipt controls.
- Keep plaintext and key memory-only. Clear references when leaving the screen where practical.

#### 15.6.6 Generic unavailable screen

Use one non-enumerating state for unknown, expired, consumed, invalid-access, and post-consume decryption failure:

- Heading: `This note is unavailable.`
- Body: `It may have expired or already been opened.`
- Primary action: `Create a new note`.
- Do not show a password input, `Open note` button, expiry timestamp, or explanation that distinguishes missing from consumed.
- A decryption failure after a successful consume is terminal. Say that the note cannot be restored; do not offer a retry that could never work.
- Use an icon plus text, never color alone. Move focus to the heading and announce the state.

#### 15.6.7 Shared interaction and accessibility contract

- Use semantic `form`, `label`, `textarea`, `input`, `select`, and `button` elements. Preserve logical order from header to active task to footer.
- Every icon-only control has a visible focus ring, an accessible name, and a tooltip for unfamiliar actions. Familiar symbols such as copy, eye, refresh, language, and external-link icons are preferred over rounded text pills.
- Use `aria-describedby` and `aria-invalid` for field errors. Use polite live regions for byte counts, copy confirmations, loading, and successful result messages; reserve assertive announcements for blocking errors.
- Respect `prefers-reduced-motion`. Loading indicators must not be the only indication of state.
- Long URLs, generated passwords, error text, and Chinese strings must wrap inside their containers without moving adjacent controls or causing horizontal overflow.
- Do not rely on color to communicate password errors, unavailable state, or success.

### 15.7 Responsive contract

| Target | Viewport | Outer gutter | Task width | Acceptance focus |
| --- | --- | ---: | ---: | --- |
| Desktop | `1440x900` | 32px | max 760px inside max 1120px shell | All create controls and CTA in the first viewport |
| Tablet | `1024x768` | 24px | max 760px | No cramped labels; stable anti-abuse slot |
| Mobile | `390x844` | 16px | full available width | Composer/gate and CTA visible without scrolling sideways |
| Narrow mobile | `320x700` | 12px | full available width | No horizontal overflow; copy controls remain 44px |

Responsive rules:

- Use fixed/minimum control dimensions, not viewport-scaled font sizes. Standard controls are at least 44px high; icon buttons are 44px square.
- The textarea may grow only within an explicitly bounded range. Loading, validation, Turnstile, PoW progress, and Chinese wrapping must not shift the primary action unpredictably.
- Share-link and password rows use `minmax(0, 1fr) auto`; the value column can wrap/break while the copy button remains visible.
- At narrow widths, stack labels and values but keep the primary action full width. Never reduce a long word below a readable size to avoid overflow.
- Test all screens in both locales, with a 64 KiB note, a 128-code-point password, a long base64url link, clipboard denial, 429/503/507 errors, and an active PoW state.

### 15.8 Token specification

The implementation must define these tokens in `docs/DESIGN.md` and map them to CSS variables or the selected styling layer. Values are intentionally restrained and must not be replaced with gradients or external design-system defaults.

#### 15.8.1 Primitive tokens

| Token | Value | Use |
| --- | --- | --- |
| `--color-white` | `#FFFFFF` | Primary canvas and action text |
| `--color-ink-950` | `#111111` | Main text and hard borders |
| `--color-ink-700` | `#3F4145` | Secondary text |
| `--color-ink-500` | `#6B6E73` | Hints and metadata |
| `--color-neutral-100` | `#F5F5F3` | Quiet surface |
| `--color-neutral-200` | `#E7E7E2` | Subtle separators |
| `--color-neutral-300` | `#D1D1CA` | Default borders |
| `--color-neutral-500` | `#8B8D87` | Disabled border/text |
| `--color-red-700` | `#B42318` | Destructive/error text |
| `--color-red-600` | `#C62828` | Primary action |
| `--color-red-800` | `#981B1B` | Action hover/pressed |
| `--color-yellow-400` | `#F2C94C` | Safety/warning marker, never sole status signal |
| `--color-blue-700` | `#1455CC` | Keyboard focus ring and links |
| `--color-green-700` | `#1F6B45` | Success text/status |

Do not introduce a dominant purple, dark-slate, beige, or brown theme. Keep the canvas light, the typography near-black, the action red, and supporting states distinct.

#### 15.8.2 Semantic tokens

| Semantic token | Default | Dark/high-contrast adaptation |
| --- | --- | --- |
| `--color-bg` | `--color-white` | Must preserve AA contrast and hard edges |
| `--color-surface` | `--color-neutral-100` | Same role, not a decorative card fill |
| `--color-text` | `--color-ink-950` | Main readable text |
| `--color-text-muted` | `--color-ink-700` | Supporting copy |
| `--color-border` | `--color-neutral-300` | 1px separators and fields |
| `--color-border-strong` | `--color-ink-950` | Focused/active structural border |
| `--color-action` | `--color-red-600` | Primary CTA only |
| `--color-action-hover` | `--color-red-800` | Hover/pressed CTA |
| `--color-action-text` | `--color-white` | CTA text/icon |
| `--color-focus` | `--color-blue-700` | 2px visible focus outline |
| `--color-danger` | `--color-red-700` | Blocking errors |
| `--color-success` | `--color-green-700` | Copy/result confirmation |
| `--color-warning` | `#6B4E00` | Warning text with yellow marker |

#### 15.8.3 Typography, spacing, shape, and motion

- Use only system fonts: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; no remote font request. Use `ui-monospace, SFMono-Regular, Consolas, monospace` for URLs and generated passwords.
- Body text is 16px with a 1.5 line-height. Labels and controls are 14px or larger. Page headings are compact (28px desktop, 24px mobile); do not use hero-scale type.
- Spacing primitives are 4, 8, 12, 16, 20, 24, 32, 48, and 64px. Use 16px as the default field gap and 24px between major task groups.
- Default radius is `0px`; if a browser-native affordance requires rounding, do not exceed `2px`. Avoid pill shapes.
- Borders are 1px by default and 2px for the focused primary action. Shadows are absent or limited to a 0 1px 2px neutral shadow for a genuinely floating transient.
- Motion durations are 120ms for feedback and 180ms for panel transitions with an ease-out curve. `prefers-reduced-motion: reduce` sets duration to 0ms and removes transforms.

#### 15.8.4 Component geometry tokens

| Token | Value |
| --- | ---: |
| `--control-height` | `44px` |
| `--icon-button-size` | `44px` |
| `--textarea-min-height-desktop` | `220px` |
| `--textarea-min-height-mobile` | `180px` |
| `--shell-max-width` | `1120px` |
| `--task-max-width` | `760px` |
| `--desktop-gutter` | `32px` |
| `--tablet-gutter` | `24px` |
| `--mobile-gutter` | `16px` |
| `--narrow-gutter` | `12px` |

### 15.9 Component contracts and state matrix

The component names below are stable implementation boundaries. A future agent may split files, but it must preserve these responsibilities and state semantics.

| Component | Contract | Required states and accessibility |
| --- | --- | --- |
| `NoteComposer` | Owns plaintext, expiry, optional password, encryption start, anti-abuse slot, and create submit | Empty, valid, over-limit, invalid, crypto unavailable, anti-abuse pending, creating, retryable error, uncertain result; semantic form and field-level errors |
| `ByteCounter` | Computes UTF-8 bytes from the exact textarea value | Normal, near limit, at limit, over limit; `aria-live="polite"`; never counts code points as bytes |
| `PasswordControl` | Custom/generated password input and memory-only controls | Disabled, enabled, visible, hidden, generated, invalid, clipboard failure; `new-password`; accessible icon names |
| `ExpirySelect` | Exact five-option expiry contract with `7 days` default | Default, changed, invalid server response; native select or equivalent keyboard-complete control |
| `CopyButton` | Clipboard write with selectable fallback | Idle, copying, copied, denied/error; 44px icon button, live confirmation, no silent failure |
| `CreateResult` | Displays clearnet link, optional onion link, password, expiry, and next action | Ready, copy success, copy denied, create-another; never displays plaintext or persists values |
| `OpenNoteGate` | Fragment preflight, metadata lookup, password form, explicit consume submit | Invalid link, metadata loading, passwordless ready, password-required ready, opening, wrong password, transport retry, unavailable; no auto-consume |
| `NoteViewer` | Renders consumed plaintext and copy action | Opened, copied, clipboard failure; literal `textContent`, pre-wrap, focus moved to heading |
| `UnavailableNoteState` | Generic terminal state for all non-recoverable note failures | Unavailable, post-consume decrypt failure; no password/open controls, one create-new action |
| `LanguageMenu` | Switches `en` and `zh-CN` without changing note URL or state | English, Simplified Chinese, keyboard menu behavior, no layout overflow |
| `TorLink` | Shows optional configured onion origin and limitations | Hidden when unset, visible when configured, copy/open; no third-party asset loading |
| `BuildInfoFooter` | Shows repository, exact commit, license, privacy/security links, and Tor footnote | Normal, missing optional onion, long commit hash; no claim of independent audit |

Global state rules:

- Loading states preserve control geometry and never replace a form with a spinner-only blank surface.
- Error states retain user-entered values unless the user explicitly selects `Create another note`.
- A terminal unavailable/decryption-error state clears any fragment/key reference from visible UI and never invites a consume retry.
- Copy status is announced once and then returns to idle; it must not block typing or navigation.
- All state text has separate message IDs for `en` and `zh-CN`; do not concatenate translated fragments in code.

### 15.10 Bilingual UI copy inventory

These IDs are the canonical UI copy for the first implementation. Keep English as the fallback. Use `便笺` consistently for note in Simplified Chinese; do not alternate between `便笺`, `留言`, `消息`, and `笔记`. Have a native Simplified Chinese reviewer check the final strings before launch.

| Message ID | English (`en`) | Simplified Chinese (`zh-CN`) |
| --- | --- | --- |
| `brand.slogan` | Read once. Shred forever. | 只读一次，随后销毁。 |
| `brand.supporting` | One link. One read. Gone. | 一个链接，只读一次。 |
| `nav.create` | Create note | 创建便笺 |
| `nav.source` | View source | 查看源代码 |
| `nav.language` | Language | 语言 |
| `create.title` | Create a one-time note | 创建一次性便笺 |
| `create.noAccount` | No account required. | 无需注册。 |
| `create.plainText` | Plain text only. | 仅支持纯文本。 |
| `create.encryption` | Encrypted in your browser. Stored as ciphertext. | 在浏览器中加密。服务器仅保存密文。 |
| `create.noteLabel` | Your note | 你的便笺 |
| `create.notePlaceholder` | Write your note... | 输入便笺内容... |
| `create.byteCount` | {used} / {limit} bytes | {used} / {limit} 字节 |
| `create.byteUnit` | UTF-8 bytes | UTF-8 字节数 |
| `create.maxSize` | Maximum 64 KiB | 最大 64 KiB |
| `create.passwordToggle` | Protect with a password | 使用密码保护 |
| `create.passwordOptional` | Password (optional) | 密码（可选） |
| `create.passwordPlaceholder` | Enter a password | 输入密码 |
| `create.generatePassword` | Generate password | 生成密码 |
| `create.useGeneratedPassword` | Use generated password | 使用生成的密码 |
| `create.expiration` | Expiration | 有效期 |
| `expiry.1h` | 1 hour | 1 小时 |
| `expiry.24h` | 24 hours | 24 小时 |
| `expiry.7d` | 7 days | 7 天 |
| `expiry.30d` | 30 days | 30 天 |
| `expiry.never` | Never | 永不过期 |
| `create.submit` | Create note | 创建便笺 |
| `create.submitting` | Creating note... | 正在创建便笺... |
| `create.encrypting` | Encrypting in your browser... | 正在浏览器中加密... |
| `create.checking` | Checking request... | 正在检查请求... |
| `create.tooLarge` | This note is too large. Maximum size is 64 KiB. | 便笺过大，最大支持 64 KiB。 |
| `create.uncertainTitle` | Creation status is uncertain. | 创建状态不确定。 |
| `create.uncertainBody` | The request may have succeeded. Retry with the same request. | 请求可能已成功，请使用相同请求重试。 |
| `create.retry` | Retry creation | 重试创建 |
| `result.title` | Your note is ready. | 便笺已准备好。 |
| `result.linkLabel` | Share link | 分享链接 |
| `result.copyLink` | Copy link | 复制链接 |
| `result.linkCopied` | Link copied | 链接已复制 |
| `result.copyPassword` | Copy password | 复制密码 |
| `result.passwordCopied` | Password copied | 密码已复制 |
| `result.separateChannel` | Share the password through a different channel from the link. | 请通过与链接不同的渠道发送密码。 |
| `result.keepPassword` | Keep this password. It cannot be recovered. | 请保存好密码。密码无法找回。 |
| `result.fragmentWarning` | Link contains the decryption key. Keep the part after # intact. | 链接包含解密密钥，请保留 # 后面的部分。 |
| `result.createAnother` | Create another note | 再创建一条 |
| `gate.title` | Ready to open? | 准备打开？ |
| `gate.warning` | Opening the note will destroy it. | 打开便笺后，它会被销毁。 |
| `gate.ready` | Open it only when you are ready. | 确认准备好后再打开。 |
| `gate.passwordRequired` | Password required | 需要密码 |
| `gate.passwordLabel` | Enter password | 输入密码 |
| `gate.open` | Open note | 打开便笺 |
| `gate.verifying` | Verifying password... | 正在验证密码... |
| `gate.opening` | Opening note... | 正在打开便笺... |
| `gate.invalidLink` | This link cannot be opened. | 此链接无法打开。 |
| `gate.wrongPassword` | That password did not work. Check it and try again. | 密码无效，请检查后重试。 |
| `gate.tooManyAttempts` | Too many attempts. Try again later. | 尝试次数过多，请稍后再试。 |
| `viewer.title` | Note opened. | 便笺已打开。 |
| `viewer.copy` | Copy note | 复制内容 |
| `viewer.copied` | Note copied | 内容已复制 |
| `viewer.copyFailed` | Copy failed. Select and copy manually. | 复制失败，请手动选择并复制。 |
| `viewer.removed` | Removed from active storage. | 已从活动存储中删除。 |
| `unavailable.title` | This note is unavailable. | 此便笺不可用。 |
| `unavailable.body` | It may have expired or already been opened. | 它可能已过期或已被打开。 |
| `unavailable.decryptFailure` | The note was opened, but your browser could not decrypt it. This note cannot be restored. | 便笺已打开，但浏览器无法解密。此便笺无法恢复。 |
| `unavailable.new` | Create a new note | 创建新便笺 |
| `error.passwordRequired` | Password is required. | 请输入密码。 |
| `error.passwordLength` | Password must be 8-128 characters. | 密码长度须为 8-128 个字符。 |
| `error.incorrectAccess` | Incorrect password or link. | 密码或链接不正确。 |
| `error.serviceUnavailable` | Service temporarily unavailable. Try again later. | 服务暂时不可用，请稍后再试。 |
| `error.storageFull` | Storage is full. Try again later. | 存储空间已满，请稍后再试。 |
| `error.cryptoUnavailable` | Browser encryption is unavailable in this security context. | 当前安全环境不支持浏览器加密。 |
| `error.generic` | Something went wrong. | 出错了。 |
| `privacy.key` | The decryption key stays in the link fragment and is not sent to the server. | 解密密钥保存在链接片段中，不会发送到服务器。 |
| `privacy.retention` | Notes are deleted after opening or expiration. | 便笺会在打开后或到期后删除。 |
| `privacy.linkHolder` | Anyone with the link can try to open it. | 持有链接的人都可以尝试打开。 |
| `privacy.separateChannel` | Do not share the link and password through the same channel. | 请不要通过同一渠道发送链接和密码。 |
| `privacy.anonymousClaim` | Anonymous by design.* | 以匿名性为设计目标。* |
| `privacy.torClaim` | Privacy by design. Stronger over Tor.* | 隐私设计。通过 Tor 获得更强保护。* |
| `privacy.torFootnote` | Using the onion mirror through Tor can substantially reduce network-level exposure. It cannot protect against a compromised device, identifying content, recipient actions, modified client code, or advanced traffic correlation. | 通过 Tor 使用 onion 镜像可以明显减少网络层面的暴露。但它无法防护已被入侵的设备、可识别的内容、接收者的操作、被篡改的客户端代码或高级流量关联分析。 |
| `source.audit` | Open source - available for audit. | 开源代码，可供审计。 |
| `source.commit` | Current commit: {hash} | 当前提交：{hash} |
| `source.security` | Report a security issue | 报告安全问题 |
| `tor.open` | Open onion mirror | 打开 onion 镜像 |
| `tor.noThirdParty` | No third-party resources are loaded on the onion mirror. | onion 镜像不会加载第三方资源。 |
| `legal.privacy` | Privacy | 隐私 |
| `legal.security` | Security | 安全 |
| `legal.terms` | Terms | 条款 |
| `legal.abuse` | Abuse contact | 滥用举报 |
| `legal.license` | AGPL-3.0 | AGPL-3.0 |

Do not use `Absolutely anonymous`, `zero trace`, `unbreakable`, `guaranteed privacy`, or `audited` as public product claims. The source phrase means that the repository is available for inspection; it is not a claim that an independent audit has been completed.

### 15.11 21st.dev evidence boundary

The design exploration used the official 21st.dev catalog in metadata/specification mode only. The following references are directional candidates, not copied implementation code:

- Textarea candidates: Origin UI and Coss metadata.
- Password input/field candidates: catalog entries `2814`, `2815`, and `6920`.
- Copy button candidate: catalog entry `10224`.
- Field candidate: catalog entry `11454`.
- Alert candidate: catalog entry `333`.

The 21st sketch-generation attempt reached the free-tier `generation_limit_reached` response. No visual sketch was generated or visually verified. The future implementation must use local tokens and `docs/DESIGN.md` as the authority, adapt any candidate component to this contract, and perform rendered QA before claiming a component is integrated.

## 16. Deployment And Operations

### 16.1 Dokploy topology

```text
Dokploy application: Next.js container
Dokploy service:     Valkey
Optional deployment: Tor hidden service with persistent hidden-service key volume
External service:    PostgreSQL via DATABASE_URL
```

The application does not provision or administer PostgreSQL. The operator owns database backup and retention settings and has chosen to disable backups for this note database.

### 16.2 Deployment path

```text
Git push to main -> Dokploy pulls repository -> Docker build -> migration release step -> application restart
```

GitHub Actions may run lint, tests, and build checks, but Docker images do not need to be published to GHCR. The deployment must inject the exact Git commit as a build variable and expose it in the footer with a link to the public repository commit.

Deployment container contract:

- Use a multi-stage `node:22-bookworm-slim` image, `output: "standalone"`, and run the application as a non-root user on port `3000`.
- The runtime command starts the standalone server only. Run migrations and capacity reconciliation once as a Dokploy release step before the new container receives traffic; never run migrations from every replica's startup hook.
- Dokploy must provide a container health check against `/health/live` and route readiness through `/health/ready`.
- Production startup/readiness fails closed when `DATABASE_URL`, `VALKEY_URL`, `PUBLIC_BASE_URL`, `GIT_REPOSITORY_URL`, `NEXT_PUBLIC_GIT_COMMIT`, `SECURITY_CONTACT`, `ABUSE_CONTACT`, `IDEMPOTENCY_HMAC_SECRET`, `IP_HASH_SECRET`, `POW_SECRET`, or finite capacity limits are missing. `ONION_URL` and Turnstile keys are optional only when their features are disabled.
- `GIT_REPOSITORY_URL` is the public web repository URL without a `.git` suffix. The footer builds a commit link by appending `/commit/<hash>` and must validate the commit value as a safe hexadecimal identifier before rendering it.
- Reverse-proxy access logs must redact query strings, URL fragments, request bodies, `Idempotency-Key`, and note-route IDs. Application logger redaction alone is insufficient.

### 16.3 Migrations and maintenance

- Commit every Drizzle migration to Git.
- Execute migrations once as a release/deploy step, not independently in every application replica startup.
- Provide `pnpm run db:migrate` and `pnpm run cleanup:expired`; the cleanup command also removes eligible idempotency tombstones in bounded batches.
- Provide `pnpm run db:reconcile-capacity` and run it once after migration. Cleanup must use a Valkey or PostgreSQL advisory lock so only one scheduled cleanup owns a batch at a time.
- Schedule `cleanup:expired` in Dokploy every five minutes.
- Implement graceful shutdown for the web process and health endpoints for container orchestration.

### 16.4 Required environment variables

```text
DATABASE_URL=
VALKEY_URL=
PUBLIC_BASE_URL=https://shredit.dev
ONION_URL=
GIT_REPOSITORY_URL=
NEXT_PUBLIC_GIT_COMMIT=
SECURITY_CONTACT=
ABUSE_CONTACT=
SECURITY_POLICY_URL=https://shredit.dev/security
ABUSE_POLICY_URL=https://shredit.dev/abuse

TURNSTILE_ENABLED=true
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
TURNSTILE_BYPASS_COUNTRIES=CN
TURNSTILE_BYPASS_ONION=true
GEOIP_DB_PATH=
TRUSTED_PROXY_CIDRS=

IP_HASH_SECRET=
POW_SECRET=
POW_DIFFICULTY_BITS=18
IDEMPOTENCY_HMAC_SECRET=
IDEMPOTENCY_TOMBSTONE_RETENTION_DAYS=30
CREATE_LIMIT_PER_IP_HOUR=10
CREATE_LIMIT_PER_IP_DAY=50
PASSWORD_FAILURE_LIMIT_PER_NOTE_15M=5
PASSWORD_FAILURE_LIMIT_PER_IP_HOUR=50
ONION_TOKENS_PER_HOUR=200
ONION_TOKENS_PER_DAY=1000
ONION_TOKEN_BURST=20
ONION_TOKEN_BYTES=8192

MAX_ACTIVE_NOTE_BYTES=
MAX_ACTIVE_NOTE_COUNT=
ARGON2_MEMORY_KIB=65536
ARGON2_TIME_COST=3
ARGON2_PARALLELISM=1
ARGON2_HASH_LENGTH=32
ARGON2_MAX_CONCURRENCY=4
ARGON2_VERIFY_TIMEOUT_MS=5000
```

All secrets remain server-only. `NEXT_PUBLIC_GIT_COMMIT` is intentionally public build metadata. Do not expose `DATABASE_URL`, Turnstile secret, IP hash secret, PoW secret, or Argon2 configuration as public variables.

## 17. Observability

- Log route template, status class, duration, and non-sensitive operational errors only.
- Redact all request bodies and sensitive headers by default.
- Do not log note IDs, passwords, ciphertext, URL fragments, full request URLs, raw `Idempotency-Key` headers, or idempotency digests.
- Expose health endpoints without note information.
- Track aggregate counters for create success/failure, consume success/failure, expiry cleanup, rate-limit rejection, storage rejection, Turnstile outcomes, and proof-of-work outcomes.
- Aggregate metrics must not include raw IPs, note IDs, plaintext, or browser fingerprints.

## 18. Test And QA Acceptance Gates

### 18.1 Automated tests

- Unit test AES-GCM round trip, incorrect AAD, malformed key, and protocol-version handling.
- Unit test UTF-8 boundary behavior with multibyte text at 64 KiB.
- Unit test base64url encoding and ensure fragments are never part of API URLs.
- Unit test generated password policy and custom password normalization.
- Unit test server-side password normalization, absent/null/empty semantics, strict unknown-field rejection, and environment-schema failures.
- Integration test PostgreSQL insert, expiry, cleanup, and storage-quota rejection.
- Integration test the singleton capacity ledger under concurrent creates, concurrent consume/expiry cleanup, and reconciliation drift repair.
- Integration test concurrent open requests: exactly one succeeds.
- Integration test wrong password: no consume, throttle after repeated failures.
- Integration test create idempotency: lost-response replay returns one creation, mismatched key/fingerprint returns `409`, and a replay never consumes a second anti-abuse token.
- Integration test idempotency tombstone update plus note deletion and capacity decrement in one transaction; force a rollback and verify all three remain unchanged.
- Integration test passwordless and password-protected expiration.
- Integration test Valkey outage: create fails closed, reads remain available.
- Integration test protected open with Valkey unavailable: fail closed without consuming; passwordless open still works when PostgreSQL is healthy.
- Integration test trusted-proxy IP handling and rejection of spoofed forwarded headers.
- Integration test Turnstile required, CN bypass, unknown-country fallback, onion bypass, and proof-of-work validation.
- Integration test exact PoW vectors, signature rejection, expiry, payload binding, surface binding, counter encoding, and single-use replay rejection.
- Integration test `GET /api/v1/notes/:id/meta` never consumes, returns only `requiresPassword` for active rows, returns the exact same generic `404` body for unavailable rows, and always sends no-store headers.
- Test headers, no-cache behavior, no-referrer policy, noindex note routes, and absence of external onion assets.
- Test that malformed note fragments cause no API request, router/RSC prefetch is disabled, and no service worker/browser persistence is registered.
- Test legal routes, `/.well-known/security.txt`, commit links, missing optional onion configuration, and degraded-ready behavior when Valkey is unavailable.
- Run formatting, lint, typecheck, tests, production build, and migration checks.

### 18.2 Rendered QA

Use external Chrome or Edge through Playwright only. Do not use Codex in-app browser or hidden webviews.

Capture and inspect at least:

- Desktop: `1440x900`
- Tablet: `1024x768`
- Mobile: `390x844`
- Narrow mobile: `320x700`

Verify EN and zh-CN flows on clearnet and the configured onion origin, long text, long passwords, error states, keyboard-only use, focus order, copy controls, Turnstile states, proof-of-work progress, unsupported Web Crypto state, no overlap, and no horizontal overflow.

## 19. Definition Of Done

The first implementation is complete only when all of the following are true:

1. A public visitor can create a passwordless or password-protected 64 KiB-or-smaller plaintext note.
2. The browser encrypts before upload, and the server never receives the AES note key in HTTP traffic.
3. GETs and previews never consume notes; explicit concurrent opens produce exactly one successful payload response.
4. A wrong password does not consume the note.
5. Seven days is the visible and server-enforced default expiry.
6. Expired and consumed notes are hard-deleted from active storage.
7. Clearnet, CN, and onion anti-abuse rules follow this document.
8. No secret, plaintext, password, key, note ID, or full link is logged or stored in browser persistence.
9. The public repository carries AGPL-3.0, `SECURITY.md`, `THREAT_MODEL.md`, and this specification or its migrated equivalent.
10. The deployed build visibly links to the exact public commit and says `Open source - available for audit.`
11. All automated checks pass and rendered QA has been performed with an external browser.
12. A simulated lost create response can be retried with the same idempotency key without producing a duplicate note or losing the link.
13. All API errors follow the stable JSON contract, unavailable states are non-enumerating, and note/meta/health responses bypass browser and proxy caches.
14. Capacity reservation, note deletion, idempotency tombstones, and counter updates are atomic under concurrent requests and reconciliation passes.
15. Valkey degradation fails closed only for operations that require anti-abuse state while keeping PostgreSQL-backed reads routable.
16. Runtime validation, production environment checks, legal/security routes, and the public `security.txt` route are implemented and covered by tests.

## 20. Launch Checks, Not Implementation Blockers

The implementation agent must not wait for these answers before scaffolding or completing the one-pass build. The behavioral defaults and environment hooks are already defined above. These checks decide whether the deployment is ready for public traffic, not whether the application can be implemented.

1. **Name review:** Confirm the Shredit name does not create unacceptable confusion with existing `Shred-it` branding in the target jurisdictions. This is an owner/legal decision; it does not change the application contract.
2. **Production capacity:** Set actual `MAX_ACTIVE_NOTE_BYTES` and `MAX_ACTIVE_NOTE_COUNT` values based on the external PostgreSQL capacity. The app must fail closed when values are missing or exceeded; staging may use explicit temporary values, but production values belong in Dokploy runtime configuration.
3. **Trusted proxy and GeoIP:** Verify `TRUSTED_PROXY_CIDRS` and `GEOIP_DB_PATH` for CN policy. If CN classification is unavailable, the server must use the configured unknown-country behavior (Turnstile required when enabled), never trust a browser country header, and never bypass rate limits.
4. **Onion provisioning:** Provision the onion transport and persist its hidden-service key only if the mirror is enabled. An empty `ONION_URL` is valid: hide onion links, do not load onion-only UI, and keep clearnet creation and reads fully functional.
5. **Native copy review:** Review EN and zh-CN public copy natively before publication, especially privacy, Tor limitations, password separation, and unavailable-state wording. The implementation can ship the message IDs already listed in this document before that review.
6. **Legal/public pages:** Complete the final Privacy, Terms, Abuse Contact, and Security Disclosure content before public launch. The routes and required subjects are already specified; missing final legal prose is a launch blocker, not an implementation blocker.

## 21. Recommended Next Step

The specification is now frozen as `v1.1`. This revision adds implementation-level protocol, cache, capacity, runtime, and deployment clarifications without expanding the MVP product scope. Before code generation, the implementation agent should read it end to end and treat the Definition of Done as the implementation gate; the six launch checks are verified before public traffic.

The next agent can perform one implementation pass: scaffold the Next.js repository, create the database and idempotency migrations, implement browser crypto and anti-abuse policy, build the documented design system with 21st.dev evidence, run external-browser QA, and prepare a Dokploy deployment package.
