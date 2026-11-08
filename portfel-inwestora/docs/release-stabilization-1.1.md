# Release Stabilization 1.1

## ESPI access policy

When the source-rights rollout setting is enabled, ESPI is readable by every
authenticated account on Free, Basic, Standard, Pro, and Expert, including
Testers. Anonymous access remains denied. Until that setting is enabled,
Administrators and accounts with an existing explicit `users.espi_access`
grant retain read access; the stored flag is retained for compatibility and
cannot grant administrative authority. The admin UI does not offer a
misleading per-user ESPI switch.

The public-read setting is `NEXT_PUBLIC_ESPI_PUBLIC_READ_ACCESS=true`; absent
or false means the broad grant is closed. It is intentionally a public
build-time policy setting (not a secret). Do not enable it in production until
the operator has documented source-reuse rights for every canonical report
channel in use. Current research confirmed PAP MediaRoom's attribution terms,
but GPW's general legal notice did not itself grant republication rights; KNF's
statement that investors can access reports at public channels does not settle
redistribution rights. Therefore this PR does not assert that unrestricted
feed rights are fully cleared.

Only an authenticated account whose persisted role is `admin` can use
`POST /api/espi` to force synchronization/backfill. Normal feed reads retain
the existing bounded, shared synchronization lock and stale-while-revalidate
behavior; users do not receive a per-user copy or an unrestricted forced-sync
path.

The feed links to the original publication and attributes its canonical
channel in the feed, report detail, and dashboard widget (GPW / ESPI,
NewConnect / ESPI, or PAP MediaRoom / ESPI). PAP MediaRoom's published terms
state that content may be downloaded and used subject to copyright and source
attribution. KNF identifies PAP Biznes and issuer websites as public channels
through which investors can access ESPI information. These terms support this
attributed use of PAP MediaRoom content; they should not be read as a general
license for unrelated market-data feeds. This implementation does not expose
anonymous access.

## Isolated HTTP E2E configuration

`GPW quality audit` creates its own PostgreSQL instance/database, then creates
a per-run random HMAC key for the production-mode HTTP test process and sets
`MEXO_TRUSTED_CLIENT_IP_HEADER=x-real-ip`. The isolated build sets
`NEXT_PUBLIC_ESPI_PUBLIC_READ_ACCESS=true` solely to exercise the open-read
branch against synthetic fixtures; this is not a production or live-source
rights assertion. The HTTP harness sends an explicit
`x-real-ip` test value over loopback to model the trusted reverse-proxy
contract. No production secret or database is used, and rate limiting remains
enabled. The unit suite continues to assert fail-closed HTTP 503 for missing or
invalid production limiter configuration. The PostgreSQL E2E also checks
concurrent counters, expiry, 429, and database-failure 503 behavior.

For an operator-managed staging deployment, use a dedicated private
`MEXO_RATE_LIMIT_HMAC_KEY` (at least 32 UTF-8 bytes) and configure the selected
trusted proxy header only if the edge overwrites it and direct untrusted
ingress is blocked. This change does not modify production proxy configuration.

## Validation status

The automated HTTP contract covers real login sessions for all five plans,
Tester, and Administrator; authenticated ESPI feed/detail reads; anonymous
denial; admin-only forced synchronization; ordinary-user plan/role escalation
denial; and cross-user portfolio isolation. Its database fixtures are
synthetic and are removed after the run.

Local validation should be recorded in the PR checks. A local PostgreSQL
service is not required: the dedicated GitHub Actions job provisions an
isolated native PostgreSQL database and runs the schema/migration, entitlement,
and concurrent limiter integration tests. No staging browser/OAuth check is
claimed unless a separately configured staging environment is available.
