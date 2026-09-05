# Security Policy

Shredit is a no-account, one-time plain-text sharing utility. The service is designed to minimize server knowledge: the browser encrypts note content with AES-256-GCM before upload, and the decryption key remains in the URL fragment. This policy describes the supported security boundary; it is not a claim of an independent audit.

## Supported Versions

Security fixes are applied to the current `master` branch and the currently deployed release selected by the operator. Older releases may be unsupported. The exact deployed commit is exposed by the public footer when the operator supplies `GIT_REPOSITORY_URL` and `NEXT_PUBLIC_GIT_COMMIT`.

## Reporting A Vulnerability

Report security issues privately to the operator-configured `SECURITY_CONTACT`. The public route `/.well-known/security.txt` and `/security` are generated from the same operator policy values. Do not include plaintext notes, passwords, fragments, full share URLs, production credentials, database addresses, or personal data in a report.

Please include:

- a concise description and impact;
- affected route, commit, or component;
- a minimal reproduction using local or synthetic data;
- timestamps and sanitized request/response details;
- any suggested mitigation.

Allow a reasonable period for triage before public disclosure. Do not test against notes or data belonging to other users, attempt denial-of-service, bypass access controls on production, or retain information obtained from an unintended disclosure.

## Security Boundaries

- The server stores opaque ciphertext, an IV, an Argon2id password hash when enabled, expiry metadata, and operational idempotency/capacity state. It must not store plaintext, AES keys, raw passwords, sender/recipient identity, IP addresses, user agents, or tracking IDs in note rows.
- The fragment is never intentionally sent to the server, logged, placed in a referrer, indexed, or included in metadata. A recipient who possesses the full link can attempt to open the note.
- Opening is an explicit one-time consume operation. A successful server response deletes the active note atomically. Browser crashes, malformed keys, or local decryption failures after consume can make a note unavailable permanently.
- The optional password is a server-side Argon2id access gate and is not a second encryption key. Share the password through a separate channel from the link.
- Turnstile, CN bypass, onion PoW, rate limits, and quotas reduce abuse; they are not confidentiality controls. Valkey degradation fails closed for operations that require anti-abuse state while safe PostgreSQL-backed reads remain available.
- Production surface headers are accepted only after constant-time verification of a server-only ingress token. Forwarded client identity and country also require a canonical chain through configured trusted upstream proxy ranges; missing evidence falls back to unknown identity/country rather than trusting browser-supplied headers.
- The onion mirror can substantially reduce network-level exposure through Tor, but cannot protect against a compromised device, identifying content, recipient actions, modified client code, or advanced traffic correlation.

## Out Of Scope

The service does not promise protection against screenshots, copied text, browser history, endpoint compromise, malicious recipients, traffic correlation, unavailable backups, or a user deliberately sharing the key/password. It does not provide accounts, recovery, sender deletion, moderation, analytics, or independent security-audit status.

## Disclosure And Changes

Do not add analytics, remote fonts, third-party error reporting, session replay, permissive CORS, cacheable note routes, or logging of secrets while addressing a security issue. Changes that affect cryptographic protocol, one-time delivery, idempotency, capacity locking, origin validation, CSP, or error enumeration require regression tests and an update to `docs/IMPLEMENTATION_DECISIONS.md`.

The production deploy path is Git-to-Dokploy on `master`. Production credentials, database access, Dokploy webhooks, and repository writes are operator actions outside this local implementation package.
