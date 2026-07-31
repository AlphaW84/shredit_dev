# Shredit Project Rules

This file records the repository and release rules for `shredit.dev`. It is subordinate to the user instructions and `SHREDIT_PROJECT_SPEC.md` v1.1, and is the local operational authority for implementation work.

## Source Of Truth

The precedence order is:

1. User instructions and any repository `AGENTS.md` instructions.
2. `SHREDIT_PROJECT_SPEC.md` v1.1.
3. This file.
4. The QSite Checker and 21st Design System instructions.
5. Detailed implementation decisions in `docs/IMPLEMENTATION_DECISIONS.md`.

`AGENTS.md` was searched for at the repository root and below on 2026-07-26 and was not present. That absence is recorded rather than treated as permission to weaken the specification.

Do not edit `SHREDIT_PROJECT_SPEC.md` or expand its product scope. If a protocol detail is not explicit, choose deterministic security-preserving behavior, test it, and record it in `docs/IMPLEMENTATION_DECISIONS.md`.

## Product Contract

- Product: `Shredit`; domain: `shredit.dev`; slogan: `Read once. Shred forever.`
- Public, account-free creation of plain-text-only notes.
- Plaintext limit: `64 KiB` UTF-8; default expiry: `7 days`; choices: `1 hour`, `24 hours`, `7 days`, `30 days`, `Never`.
- AES-256-GCM is performed in the browser through Web Crypto. The key is only in the URL fragment and never in an HTTP request.
- PostgreSQL is external through `DATABASE_URL`; Valkey is the anti-abuse/rate-limit service.
- Optional Argon2id password gate is a server access gate, not a second encryption key.
- Clearnet CN traffic can bypass Turnstile but never rate limits. Onion traffic bypasses Turnstile and uses PoW/separate quota policy.
- Supported interface locales are `en` and `zh-CN`; Russian is not an interface locale. Agent reports are written in Russian.
- No accounts, files, Markdown, downloads, read receipts, sender deletion links, recovery, editing, analytics, trackers, ads, remote fonts, or behavioral profiling.

Approved privacy wording is qualified and concrete. Keep `Anonymous by design.*` adjacent to the exact Tor limitation footnote from the specification. Never use `Absolutely anonymous`, `zero trace`, `unbreakable`, `guaranteed privacy`, or `audited` as product claims. `Open source - available for audit.` means source availability only.

## Project Language And Reporting Rule

Site language: `EN`, with the supported `zh-CN` interface locale.

All user-facing chat updates and final reports must be written in Russian. Every project-local Markdown todo file is a report even when its filename does not contain `_ru`; its headings, actions, reasons, conditions, and notes must be written in Russian. If the agent creates an English or site-language report for reuse by future work, publication, SEO, GEO, or external tooling, it must also create a Russian translated copy next to it using the same base name with `_ru` before the extension.

Before delivering any Markdown todo file or any report whose filename contains `_ru`, run the QSite Checker Russian-language gate for all changed files and require `RussianRatio > 80`. Exactly `80` does not pass. English is allowed only for technical terms, brands, identifiers, paths, URLs, search queries, and code fragments. Renaming English prose, wrapping ordinary English prose as code, or expanding an allowlist to conceal it is prohibited.

## Project Todo And Completed Work Rule

- Keep only current unfinished tasks in `/_codex/todo/todo_ru.md`. Write headings, actions, reasons, conditions, and notes in Russian. Do not keep completed, removed, rejected, or superseded rows in the active file.
- Use `P0`, `P1`, and `P2` for the visible active backlog. Use `P2+` only when the user explicitly assigns a task to the hidden `когда-нибудь потом` backlog; `P2+` is lower urgency than `P2`.
- Show only `P0`/`P1`/`P2` details by default. When `P2+` exists, show only its count and never its task details unless the user explicitly asks to see `P2+`.
- Never execute, schedule, research, or advance `P2+` automatically. A generic `продолжай` or `выполни все задачи` command does not include `P2+`; require an explicit command naming the deferred task.
- When a task is completed, remove it from `todo_ru.md` immediately and append a short handoff row to `/_codex/todo/done_ru.md` with its stable ID, status `DONE`, completion date, concise result, source/evidence, and useful notes.
- Treat `done_ru.md` as append-only completed-work history. It must not contain unfinished tasks, future actions, or a second active backlog.
- Deduplicate both files, keep `/_codex/` local-only, and never deploy either file.
- Treat both files as Russian reports. After every edit, run the QSite Checker Russian-language gate for both changed files and require `RussianRatio > 80` before handoff.

## Quality Gates

QSite Checker is the release-readiness process. The project-local proxy bundle is the runtime authority for this repository. Before any external request, run its deterministic validator and operational preflight; do not use a direct fallback when the proxy is unavailable:

```powershell
& .\_codex\proxy-flow\check-proxy-flow.ps1 -ProjectRoot .
& .\_codex\proxy-flow\invoke-proxy-preflight.ps1 `
  -ProjectRoot . `
  -TargetClass ExternalProduction `
  -Protocol Http `
  -TargetHost <actual-credential-free-hostname>
```

The target class, protocol, and hostname must describe the actual pending operation; the template above is not continuing authorization. Run `/_codex/proxy-flow/test-proxy-flow.ps1` after changing the bundle or this contract. The canonical project-local reference is `/_codex/proxy-flow/protocol-aware-proxy-flow.md`. The QSite Checker global reference is upstream provenance only; project execution must not depend on a global skill path.

Run analytics-isolation checks even though analytics are intentionally absent:

```powershell
& C:\Users\JZ\.codex\skills\qsite-checker\scripts\check-analytics-qa-isolation.ps1 -ProjectRoot D:\Codex\shredit.dev
```

Before interpreting results, read the project-local `/_codex/proxy-flow/protocol-aware-proxy-flow.md` for proxy work and the applicable QSite reference flows for analytics isolation, security review, and other selected checks. Treat those references as procedure guidance, not permission to add out-of-scope product features.

Applicable checks are security code review, secret/dependency scans, API/runtime security, headers/CSP/cache, route inventory, encoding, dependency hygiene, local Next.js rebuild, design/content readiness, external-browser QA, deployment contract, Git identity contract, local health checks, and active TODO/report tracking. The final report must be Russian, list security findings first in `Critical`, `High`, `Medium`, `Low` order, and must not say `PASS` for an unmeasured required check.

Intentional `N/A / out of scope` items are GA4, Yandex Metrica, conversion goals, advertising, trackers, Trustpilot, Topvisor, SEO/GEO cluster layer, GitHub article layer, IndexNow, GSC/Yandex Webmaster, public indexing, and SEO-oriented pages. The reason is that Shredit is a no-tracker privacy utility and public responses use `noindex`, `noarchive`, and `nosnippet`. Do not create accounts, keys, scripts, paid operations, or unsupported pass claims for these items.

Use the official 21st.dev MCP only for focused component evidence (`search`, `get_component`, `get_theme`, and `generate` only when necessary). Never send secrets, connection strings, credentials, logs, or the repository wholesale. The local token source and `docs/DESIGN.md` are canonical. If MCP is unavailable, record the exact reason and do not claim MCP evidence.

## Deployment Rules

- Git repository: `git@github.com:AlphaW84/shredit_dev.git` (public URL: `https://github.com/AlphaW84/shredit_dev`).
- Deploy provider: Dokploy. Path: Git push to `master` -> Dokploy build -> one release migration/reconciliation step -> restart.
- Production branch is `master`.
- The application is built directly by Dokploy from Git. Do not add GHCR, signed-image comparison, or production JavaScript comparison workflows.
- PostgreSQL is external and operator-managed. The app does not provision it or manage backup policy; the note database has backups disabled by operator decision.
- Valkey is a separate Dokploy service. `ONION_URL` is optional and uses a persistent hidden-service key volume only when enabled.
- Run `pnpm run db:migrate` and `pnpm run db:reconcile-capacity` once as release commands before traffic. Schedule `pnpm run cleanup:expired` every five minutes under a single-worker lock.
- Runtime is a standalone Next.js server from the multi-stage `node:22-bookworm-slim` image, non-root, port `3232`. Health checks use `/health/live`; readiness uses `/health/ready` and permits a non-sensitive degraded Valkey state.
- Production startup/readiness fails closed when required configuration or finite capacity limits are absent. Production secrets are injected by Dokploy, never committed.
- Never upload files directly to production. Never invoke a Dokploy webhook or production deploy from this task. Production deployment requires a separate explicit user authorization.
- Do not use the default SSH identity. Use a dedicated project key with `IdentitiesOnly=yes` and an explicit `IdentityFile` if Git access is later requested.

## QA Environment

Use local PostgreSQL and Valkey only. Never use a production `DATABASE_URL` for local migrations or tests. Stop only a process previously started for this project, remove `.next`, reinstall from the lockfile, run formatter/lint/typecheck/unit/integration/security/build checks, and leave the local production server running when the implementation task requires it.

Browser QA uses external Edge/Chrome/Playwright only. Do not use Codex Browser Use, in-app browser tabs, hidden webviews, or `agent.browsers` for localhost QA. Required viewports are `1440x900`, `1024x768`, `390x844`, and `320x700` in both locales, including long text/password/link, clipboard denial, error, keyboard, focus, overflow, and anti-abuse states.

## Secrets, Logs, And Evidence

- `.env`, `.env.local`, private keys, production logs, credentials, and generated evidence stay local and are never committed.
- Service materials belong under `/_codex/`; `/_codex/` is ignored and must not be included in a Docker build context or deployment artifact.
- Never log plaintext, ciphertext, passwords, AES keys, note IDs, fragments, full URLs, query strings, request bodies, raw `Idempotency-Key`, IP addresses, or idempotency digests. Reverse-proxy logs must redact these too.
- Local secrets override global secrets. `NEXT_PUBLIC_GIT_COMMIT` is public build metadata; all other secrets remain server-only.
- Evidence placeholders are under `/_codex/evidence/`. They are not test results and must not be described as passed checks.

## Launch-Only Items

These are owner/operator gates, not reasons to weaken or expand the implementation: Shredit/Shred-it name and trademark review; production capacity values; trusted proxy CIDRs and GeoIP database; onion provisioning; native EN/zh-CN copy review; and final Privacy, Terms, Abuse, and Security public copy.

Production deploy is intentionally out of scope for this implementation pass. The final report must state: `Production deploy не выполнялся. Remote repository не изменялся. Локальный сервер оставлен запущенным.`

## Protocol-Aware Production Proxy Flow

- **Project proxy endpoint:** `http://127.0.0.1:55083` (local HTTP proxy; no external or production connection is authorized without the protocol-specific route below).
- Every connection from the agent machine to production, deploy infrastructure, Git, webhooks, external APIs, search services, FTP/SFTP, SSH, databases, and other external resources must use this documented proxy.
- **Target classification:** before the first connection, classify the exact target as true local development or external/production. Record the classification in reusable evidence when the operation is part of QA, deploy, security, or release work.
- **Protocol classification:** identify HTTP(S), Git HTTPS, SSH-family, PostgreSQL/Prisma, or other raw TCP before selecting a client. A route valid for one protocol is not evidence for another.
- **Proxy listening preflight:** verify that `127.0.0.1:55083` is listening immediately before the external operation. A previous PASS is not continuing authorization. Stop and report a blocker if it is unavailable.
- **Credential redaction:** never expose passwords, tokens, private keys, connection strings, proxy credentials, or other secrets in commands, process listings, chat, screenshots, or reports.
- `HTTP_PROXY` and `HTTPS_PROXY` are not proof that a non-HTTP client is proxied.

### Transport Matrix

- **HTTP(S):** pass `http://127.0.0.1:55083` explicitly with `curl --proxy`, `Invoke-WebRequest -Proxy`, or an explicit proxy agent supported by the client.
- **Git HTTPS:** use command-scoped or project-local proxy configuration. Never rely on an undocumented global fallback.
- **SSH route / direct SSH ban:** SSH, Git SSH, SFTP, rsync, and Paramiko use `ProxyCommand`, a preconnected HTTP CONNECT socket, or a documented SOCKS5 route. Direct SSH, direct `paramiko.connect`, and raw SSH-family clients without a proxy socket are prohibited.
- **Raw TCP warning / direct production DB ban / database tunnel route:** `HTTP_PROXY` and `HTTPS_PROXY` do not route PostgreSQL, Prisma, or raw TCP. Never run a local `psql`, `PrismaClient`, migration, or read-only diagnostic directly against a production `DATABASE_URL`. Prefer diagnostics on the application host reached through proxied SSH; otherwise use an explicit local TCP port-forward whose SSH upstream is proxied, and point PostgreSQL/Prisma only at that local forwarded endpoint.
- **Other raw TCP:** use an explicit SOCKS, CONNECT, or TCP tunnel. If no proxy-capable route exists, stop that operation and report the blocker.
- **Skill wrapper / no proxy chain:** a skill-specific proxy wrapper takes priority for that skill path and must not be combined with a second outer proxy, nested tunnel, or double proxy chain.
- **No direct fallback:** if the complete route cannot be proved before connecting, stop only that network operation and report the blocker. A direct fallback is always prohibited.

### Localhost Exception

- **Localhost/tunnel distinction:** true development endpoints on `localhost`, `127.0.0.1`, and `0.0.0.0` run directly without the project proxy. A local tunnel endpoint may be accessed directly only when its upstream transport is already proven to use this proxy. This exception never applies to a production IP, hostname, or production database connection string.

### Operational Evidence

- HTTP(S) evidence records the target classification and the client's explicit proxy option or proxy agent.
- SSH-family evidence records the `ProxyCommand`, SOCKS route, or preconnected CONNECT socket without secret values.
- Database/raw-TCP evidence records either execution on the application host reached through proxied SSH or a local forwarded port whose upstream SSH route is proxied.
- Store reusable proxy-flow evidence only under `/_codex/proxy-flow/`; do not commit or deploy it. If the transport cannot be proved before connecting, do not connect.

### Project-Local Proxy-Flow Tooling

- Canonical procedure snapshot: `/_codex/proxy-flow/protocol-aware-proxy-flow.md`.
- Deterministic rules validator: `/_codex/proxy-flow/check-proxy-flow.ps1`.
- Operational target, protocol, and listener preflight: `/_codex/proxy-flow/invoke-proxy-preflight.ps1`.
- Regression/self-test for `PASS`, `WARNING`, `MISSING`, and the localhost exception: `/_codex/proxy-flow/test-proxy-flow.ps1`.
- Local evidence and operator handoff: `/_codex/proxy-flow/README_ru.md`.
- These project-local files are the execution paths for Shredit. A global QSite installation may be used only as an explicitly reviewed upstream source when intentionally synchronizing this snapshot; it is not a runtime dependency.

## Analytics QA Isolation Rule

- **Analytics inventory:** no analytics vendors or measurement IDs are installed; GA4 and Yandex Metrica are not installed.
- **Environment coverage:** the same isolation is mandatory for local/localhost, preview/staging, and production QA.
- **Isolated browser context:** every automated run uses a fresh isolated Playwright context/profile and never reuses the owner's normal browser profile, cookies, or storage.
- **Project-side suppression:** client code has no analytics collection and suppresses future vendors on localhost and when `window.__PLAYWRIGHT_QA__ === true` or `navigator.webdriver === true`; do not mask `navigator.webdriver`.
- **Pre-navigation opt-out:** before the first navigation, use `addInitScript`, set `window.__PLAYWRIGHT_QA__ = true`, set discovered `ga-disable-G-...` flags, and store known consent as `denied`.
- **Server QA header:** not supported because analytics are not installed; this header must disable analytics, never bypass authentication or authorization.
- **Network denylist:** before the first navigation, block or abort GA4/Google Analytics endpoints (`google-analytics.com`, `googletagmanager.com`) and Yandex endpoints (`mc.yandex.ru`, `mc.yandex.com`, `yastatic.net/s3/metrika`).
- **Request ledger:** record every analytics request attempted, aborted, and completed with URL, vendor, resource type, and disposition.
- **PASS criterion:** zero completed analytics collection requests on local, preview/staging, and production targets.
- **Failure handling:** any completed analytics collection request invalidates the run as `ANALYTICS_ISOLATION_FAILURE`; fix the guard and rerun.
