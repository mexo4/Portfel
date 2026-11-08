# Mexo Public Release Hardening 1.0

## Scope and safety

This change is prepared for review only. It has not been merged or deployed,
and it has not connected to or modified production Aiven. Database schema guards
are idempotent and run through Mexo's existing schema initialization when the
application is next started. Run the acceptance checks below against an isolated
staging database before release.

## Plans, roles, and per-user access

`subscription_plan`, `user_role`, `tester_access`, and `espi_access` are separate
fields. New users start as `free`, role `user`, with Tester and ESPI access off.
Paid plans cannot be self-selected through the subscription endpoint. A trusted
administrator can grant a plan for 30 days; it does not renew automatically.
After expiry the effective plan is Free, while the assigned plan and user data
remain stored. Existing Free accounts remain Free. Existing active Pro rows
without an expiry retain their legacy Pro resource-limit behavior to avoid
silently removing access during this transition.

| Plan | Target price / 30 days | Confirmed limits | Product entitlements |
| --- | ---: | --- | --- |
| Free | 0 zł | 1 portfolio, 99 assets per portfolio | Existing core behavior; feature matrix requires product approval |
| Basic | 3,99 zł | Pending | Pending; not purchasable |
| Standard | 6,99 zł | Pending | Pending; not purchasable |
| Pro | 11,99 zł | Legacy active Pro: no server-enforced portfolio/asset cap | New feature matrix pending; no payment flow |
| Expert | 14,99 zł | Pending | Pending; not purchasable |

Pending limits fall back conservatively to the existing Free limits for new
resource creation. Existing data is never deleted and remains viewable. The
pending values are intentionally not guessed; product must approve the full
Basic/Standard/Pro/Expert matrix before those differences are enabled.

Tester is an explicit per-user flag and permits currently implemented test
features/limits; it is not a plan or an administrative role. ESPI is separately
controlled by `espi_access` and is not implicitly granted by Tester or admin
status. Admin role controls administrative actions independently of plan. The
current code does not enforce admin-only access for the Cash workspace: although
the historical product note described Cash as reserved for admins, the existing
workspace and its write APIs are not gated that way. This PR does not silently
change that behavior; product must decide whether Cash needs a separate
entitlement before public release.

### First administrator bootstrap

Email-based runtime allowlists/default admins were removed. Before staging or
production adoption, an infrastructure operator must independently verify the
intended account and its immutable database user ID, then grant that ID through
an audited privileged database session. Do not substitute an email in this SQL
or run it until the identity has been independently checked:

```sql
SELECT id, email, user_role FROM users WHERE id = '<VERIFIED_USER_ID>' FOR UPDATE;
```

After independently confirming the result, run a separate audited statement:

```sql
BEGIN;
UPDATE users SET user_role = 'admin', updated_at = now()::text
WHERE id = '<VERIFIED_USER_ID>';
COMMIT;
```

The `SELECT` result must be reviewed before the `UPDATE`; abort if the selected
row is not the intended user. This manual bootstrap is not performed by this PR.
Subsequent role, Tester, ESPI, and plan changes are available to persisted admins
for other users; the API rejects self-modification.

### Migration and rollback

Schema initialization adds nullable activation/expiry/grant-source fields and
safe `user`/false defaults for role and per-user access. The rate-limit storage
and its cleanup marker are created idempotently. Reads normalize unknown legacy
plan values to Free and unknown roles to user; supported legacy Free/Pro values
are preserved. No ownership or portfolio records are rewritten.

Before staging rollout, take and verify a database backup. Rollback is an
application rollback to the previous release. Keep the added columns/tables:
they are backward-compatible and contain access/audit state. Do not drop them
as part of routine rollback. If incorrect grants were made, an authorized
operator must review and correct those user IDs; do not reset plans or roles
globally. No production rollback or migration was run by this PR.

## Authentication abuse controls

Sensitive auth routes use fixed-window counters in PostgreSQL, shared among
application processes. IP and normalized account identity are HMACed; raw IPs,
emails, passwords, and tokens are not saved by the limiter. Exceeded policies
return 429 with `Retry-After`; missing database/proxy identity fails closed with
503. Configure a private `MEXO_RATE_LIMIT_HMAC_KEY` of at least 32 UTF-8 bytes
consistently across instances. It is independent of `DATABASE_URL`; production
does not fall back to a database credential or a development key. Configure
`MEXO_TRUSTED_CLIENT_IP_HEADER` as only `x-real-ip` or `cf-connecting-ip`; the
selected edge proxy must overwrite that header and block direct untrusted
ingress. The value is validated as an IPv4/IPv6 address. Never trust a
client-supplied `x-forwarded-for` chain. Missing/short secret, unsupported proxy
header, or missing/invalid address fails closed as HTTP 503 before a DB query.
The policy values live in `src/lib/server/auth-rate-limit.ts` and should be
reviewed against observed staging traffic before public rollout.

As defense in depth, an operator can add a Cloudflare rate-limit rule in
Log/Managed-Challenge mode first, scoped to the auth paths above and grouped by
source IP (for example, 60 requests per 10 minutes). Validate OAuth redirects
and legitimate password resets before changing the action to block. Do not use
this edge rule as a substitute for the per-IP and per-identity application
limits, and do not enable it from this PR.

## Response headers

Next.js sends `Content-Security-Policy-Report-Only` plus nosniff, referrer,
clickjacking, permissions, and production HSTS headers. CSP is deliberately
Report-Only initially to discover required Next.js, chart, and Google OAuth
origins without breaking login. Collect reports and tighten the policy in a
separate reviewed change. HSTS is one year for the current host only; it does
not include subdomains or preload. This PR does not change Cloudflare or Nginx.
At staging, check that the edge preserves these headers and does not add
conflicting duplicates.

## FX quality

FX responses identify their provider and effective date. Same-day provider
rates are `confirmed`; dated values carried within the configured seven-day
window are `historically-carried`; older values are `stale`; explicitly
approximate recovery values are `fallback`; missing values are `unavailable`.
Historic valuation does not substitute today's rate for a missing historical
fixing. PLN identity conversion remains 1:1. Historical performance quality
checks use dated FX availability and expose incompleteness rather than
presenting unsupported return/risk figures as reliable. Existing operations
and saved transaction values are not rewritten.

## Charts and crypto communication

Recharts responsive containers now have non-zero initial dimensions where the
first render may occur before layout measurement. Crypto remains disabled for
new additions; existing holdings and history remain untouched, and public
landing/pricing copy no longer advertises the disabled workflow as available.

## Staging acceptance checklist

1. Use an isolated PostgreSQL database and confirm schema initialization can be
   repeated without errors; verify existing Free/Pro fixtures and values remain.
2. Confirm new users receive Free/user/no-Tester/no-ESPI access; verify admin,
   Tester, ESPI, and paid grants independently in the account UI and APIs.
3. Confirm self-service paid-plan requests are rejected and Free downgrade does
   not delete any resources; test a paid expiry using a fixture clock/date.
4. Exercise auth limits from two app instances behind the actual trusted proxy;
   verify 429 and `Retry-After`, generic login/reset responses, and no secrets in
   logs. Confirm proxy header overwrite and HMAC env parity.
5. Inspect Report-Only CSP reports during Google OAuth, chart, and app workflows;
   do not enforce CSP until reports are reviewed.
6. Test same-day, carried, stale, fallback, and unavailable FX against dated
   fixtures and verify all affected return metrics show their quality status.
7. Open charts on desktop/mobile, hidden tabs, and fullscreen; confirm no
   Recharts -1 × -1 warnings.
8. Confirm crypto cannot be newly searched/added while existing historical
   crypto remains visible and unchanged.

The detailed paid feature/limit matrix, whether Cash is admin-only, initial
admin identity, and final CSP allowlist remain explicit operator/product
decisions. No payment processor or automatic entitlement webhook is included.

## Validation status for the hardening branch

The automated PostgreSQL integration test is
`tests/public-release-hardening-postgres.integration.test.mjs`. It refuses every
connection except loopback PostgreSQL using the dedicated
`mexo_hardening_test` role and database. It creates a random temporary schema,
places legacy Free/Pro rows in that schema, runs the real idempotent schema
initializer twice, checks the migrated defaults and new-account defaults, then
starts two separate Node processes to contend on the same PostgreSQL rate-limit
bucket. The schema is dropped in cleanup. The test is skipped unless
`MEXO_HARDENING_TEST_DATABASE_URL` is explicitly set.

For an isolated local run, from `portfel-inwestora`:

```powershell
docker compose -f compose.public-release-test.yml up -d --wait
$env:MEXO_HARDENING_TEST_DATABASE_URL = 'postgresql://mexo_hardening_test:mexo_hardening_local_only@127.0.0.1:55440/mexo_hardening_test'
npm run test:public-release:postgres
Remove-Item Env:MEXO_HARDENING_TEST_DATABASE_URL
docker compose -f compose.public-release-test.yml down
```

This container is local-only test infrastructure, unrelated to production. If
Docker is unavailable, these database checks remain unexecuted; do not point
the test variable at Aiven or any shared database. Current workspace validation
found Docker CLI installed but its Docker Desktop daemon unavailable, and no
local PostgreSQL client/service. Therefore PostgreSQL migration, real multi-
process counter atomicity, and DB-failure integration scenarios have not been
run in this environment. The opt-in integration test additionally checks
admin-only role grants, Tester/ESPI persistence, 30-day entitlement metadata,
expiry back to effective Free without portfolio changes, rejected self-service
paid-plan escalation, HTTP 429 plus `Retry-After`, and HTTP 503 on a database
failure. The normal unit suite separately checks fail-closed HTTP 503 behavior
without connecting to a database. Full local validation: `npm test` — 820 total,
818 passed, 0 failed, 2 skipped; `npm run lint`, `npx tsc --noEmit`, and
`npm run build` passed. The opt-in PostgreSQL test was skipped because no local
database endpoint was available; it is ready for local/staging execution.

Entitlement audit: the `pending` feature decision only gates features explicitly
checked through `canAccessFeature` (advanced analytics, benchmarks, investment
tools, and separately ESPI); portfolio/asset viewing and normal operation
flows do not use that feature gate. Pending plan quotas conservatively resolve
to the existing Free create limits; existing data is retained and remains
readable. ESPI menu and API use the persisted `espi_access` flag, not Tester.
No cash-specific UI or server entitlement gate exists today: dividend/cash
screens and their authenticated portfolio APIs are accessible under the same
base account/ownership checks. The historical admin-only Cash note needs a
product decision before changing public behavior. Admin account-management API
requires persisted `user_role=admin`; self-service subscription rejects paid
tiers; admin entitlement updates reject changing the actor's own access.

Not executed in this workspace: browser UI flows, Google OAuth through the
production-like proxy, and CSP Report-Only collection. Those require a running
staging app plus configured OAuth and trusted proxy. No production settings,
database, Cloudflare rules, or deployment were changed.
