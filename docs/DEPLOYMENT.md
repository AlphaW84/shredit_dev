# Deployment Notes

These notes package the frozen Shredit deployment contract. They do not authorize a production deploy and do not contain production credentials.

## Local Services

Use only local PostgreSQL and Valkey. Never point local commands at a production `DATABASE_URL`.

```powershell
Copy-Item .env.example .env.local
docker compose -f docker-compose.local.yml up -d postgres valkey
pnpm install --frozen-lockfile
pnpm run db:migrate
pnpm run db:reconcile-capacity
pnpm run cleanup:expired
pnpm run dev
```

Host-side maintenance commands load `.env.local` when it exists. In containers the file is not
required: Compose or Dokploy injects the environment directly.

To verify the production-shaped standalone server on the host, build before starting it:

```powershell
pnpm run build
pnpm start
```

The build copies `.next/static` and `public` into `.next/standalone`, so `pnpm start` serves the
complete standalone package rather than an asset-less Next.js server.

For a containerized local production-shaped run:

```powershell
docker compose -f docker-compose.local.yml up -d --build
```

The full Compose startup waits for healthy PostgreSQL and a started Valkey service, runs the
one-shot `migrate` service (`db:migrate` followed by `db:reconcile-capacity`), and starts `app` only
after that service exits successfully. Valkey health does not gate application startup because
readiness deliberately supports a degraded Valkey state. The application image is built from the
`runner` target. To run the optional one-shot cleanup service manually:

```powershell
docker compose -f docker-compose.local.yml --profile maintenance run --rm cleanup
```

Check the process without consuming any note:

```powershell
Invoke-WebRequest http://127.0.0.1:3232/health/live
Invoke-WebRequest http://127.0.0.1:3232/health/ready
```

The compose file provisions disposable local volumes named `shredit-postgres-data` and `shredit-valkey-data`. Do not reuse those values for production. Stop local services with `docker compose -f docker-compose.local.yml down`; remove local volumes only when the test data is intentionally disposable.

## Dokploy Topology

```text
Dokploy application: Next.js standalone container
Dokploy service:     Valkey
External service:    PostgreSQL via DATABASE_URL
Optional service:    Tor hidden service with persistent key volume
```

The deployment path is:

```text
push to master -> Dokploy pulls Git -> Docker build -> release migrations/reconciliation -> restart -> health/readiness routing
```

Repository: `git@github.com:AlphaW84/shredit_dev.git`. Public source and commit links use `https://github.com/AlphaW84/shredit_dev` without the `.git` suffix.

Configure the Dokploy application to build the repository with `Dockerfile` target `runner`, inject the exact commit as `NEXT_PUBLIC_GIT_COMMIT`, and expose port `3232`. Keep the Docker runtime command `node --require ./scripts/inject-peer-address.cjs server.js`; bypassing the preload removes the authenticated socket-peer boundary used by IP and country policy. If Dokploy invokes the package `start` script instead, `scripts/start-standalone.cjs` pins the same `3232`/`0.0.0.0` bind while the package command retains the required preload.

## Release Commands

Build the same commit with Dockerfile target `maintenance` and run this command once as a Dokploy
release job before traffic is switched:

```text
pnpm run db:migrate && pnpm run db:reconcile-capacity
```

Use the same `maintenance` target for a separate scheduled job every five minutes:

```text
pnpm run cleanup:expired
```

Never run release or maintenance commands as a per-replica startup command. Migrations and capacity
reconciliation are one release job, and cleanup is one independently scheduled job. Ensure only one
cleanup worker runs at a time. Cleanup removes expired notes and eligible idempotency tombstones in
bounded batches. It must not silently remove unexpired notes to correct a capacity mismatch.
PostgreSQL backup and retention policy remain operator-owned; the application does not provision or
manage backups.

## Health And Proxy Contract

- `/health/live` is process liveness only and must not touch PostgreSQL or Valkey.
- `/health/ready` checks PostgreSQL, migration state, required configuration, and capacity. It returns `200` with `valkey: "ok"` or `valkey: "degraded"`; database/migration failure returns `503`.
- Configure the container health check against `/health/live` and route readiness against `/health/ready`.
- Apply cache bypass for `/n/*`, `/api/*`, and `/health/*`. All HTML, API, metadata, health, and error responses are `Cache-Control: no-store`.
- Reverse-proxy access logs must redact query strings, fragments, request bodies, note-route IDs, and `Idempotency-Key`. Application logger redaction alone is insufficient.
- Keep the application port private to the reverse proxy. Every address in `TRUSTED_PROXY_CIDRS` must identify a controlled proxy that overwrites or canonically appends `X-Forwarded-For` and overwrites/removes inbound `CF-IPCountry`, `X-Vercel-IP-Country`, `CF-Connecting-IP`, and `X-Real-IP` values. Test direct spoof attempts before enabling the CN bypass; otherwise country remains unknown and Turnstile stays required.
- On each public vhost, strip any inbound `X-Shredit-Surface` value and set it to exactly `clearnet` or `onion` after the proxy has selected that vhost. Production API requests from peers outside `TRUSTED_PROXY_CIDRS`, with a missing surface header, or with any other value are rejected. Never derive this header from an inbound `Host` or `X-Forwarded-Host` value.
- Clearnet uses HSTS and the Turnstile origins only when Turnstile is enabled. Onion responses omit HSTS enforcement, Cloudflare sources, `upgrade-insecure-requests`, and all third-party assets.

## Required Runtime Configuration

The complete variable template is in [`.env.example`](../.env.example). Production must provide at least `DATABASE_URL`, `VALKEY_URL`, `PUBLIC_BASE_URL`, `GIT_REPOSITORY_URL`, `NEXT_PUBLIC_GIT_COMMIT`, `SECURITY_CONTACT`, `SECURITY_POLICY_URL`, `ABUSE_CONTACT`, `ABUSE_POLICY_URL`, `IDEMPOTENCY_HMAC_SECRET`, `IP_HASH_SECRET`, `POW_SECRET`, and finite `MAX_ACTIVE_NOTE_BYTES`/`MAX_ACTIVE_NOTE_COUNT`. `ONION_URL` and Turnstile credentials are optional only when those features are disabled.

All secrets remain server-only. `NEXT_PUBLIC_GIT_COMMIT` is public build metadata. Local secrets take precedence over global shell values, and production values must be injected by Dokploy rather than committed.

## Git And SSH

The repository's actual remote and provider must be inspected before generating any key; never infer a URL from placeholders. If a project-specific read-only key is required, store it only at:

```text
/_codex/secrets/shredit-git-deploy_ed25519
/_codex/secrets/shredit-git-deploy_ed25519.pub
```

Use an explicit SSH command with `IdentityFile=...` and `IdentitiesOnly=yes`; never use the default SSH identity. Show only the public key and SHA-256 fingerprint in a final report. Do not push, add the key to remote settings, or grant write access from this package. `/_codex/` is local evidence/secrets storage and is excluded from deployment.

## Rollback And Incident Handling

Do not run production rollback, database access, root access, or Dokploy webhooks without separate explicit authorization. For an application-only incident, preserve the exact deployed commit, stop new traffic through the operator's normal Dokploy mechanism, and use the approved migration/rollback procedure. Do not restore note data from backups as an application feature; consumed-note recovery is outside the product contract.

## Launch Checklist

Before public traffic, the owner must set production capacity, verify trusted proxy/GeoIP behavior, provision the optional onion origin, complete native EN/zh-CN copy review, complete final legal pages, and review the Shredit/Shred-it naming risk. These are launch checks, not reasons to add scope or weaken security invariants.
