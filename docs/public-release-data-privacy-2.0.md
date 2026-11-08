# Mexo Public Release 2.0 — privacy and account lifecycle

Status: implementation branch / pre-release. This document is not legal advice and does not establish production GDPR compliance. No production Aiven query, write, migration, account deletion, backup, restore, or deploy was performed for this change.

## Architecture

- `GET /api/account/export` authenticates from the server session, derives the owner ID only from that session, applies the distributed PostgreSQL export limiter, reads one `REPEATABLE READ READ ONLY` snapshot, and returns an in-memory ZIP with private/no-store headers. It does not accept a user ID, write a file to `public/`, or log exported content.
- `POST /api/account/deletion/reauth` verifies the current password for password accounts. Google-only accounts use an OAuth step-up bound to the authenticated user and linked Google subject. The Google ID token must include a recent `auth_time`; an old or missing claim fails closed. Google authorization requests the claim through OIDC `claims` and the callback compares it to the short-lived step-up start time.
- Successful step-up creates a random, ten-minute, one-time challenge. Only its SHA-256 hash is stored in `account_deletion_challenges`; the raw challenge is in a Secure/HttpOnly/SameSite=Strict cookie. `DELETE /api/account` requires exact same-origin metadata, the live session, and that challenge. It serializes administrator lifecycle actions, removes the user root in one transaction, and clears the session/challenge cookies after commit. FK cascades remove owned rows; `portfolio_engine_cache` is explicitly deleted because it has no owner FK. Shared market/event/ESPI data is retained.
- `GET /privacy` and `/terms` resolve an explicitly registered approved version or a prominently marked draft. Approval/publication registries are empty; draft documents are not presented as governing legal documents.

## User-data inventory and export format

The checked-in schema inventory is [privacy-data-inventory.md](privacy-data-inventory.md). It distinguishes user-owned tables from shared market data/cache. Export covers account/profile and plan fields; legacy portfolio JSON; `core_portfolios` and its accounts, sub-portfolios, instruments, operations, tags/assignments, benchmarks; manual quote overrides; watchlist; dashboard and performance preferences; calendar subscription settings; and linked identity provider/subject identifiers.

The ZIP contains UTF-8 files, JSON preserving stored values, operation CSVs for all operations/dividends/cashflows, and a `manifest.json` with schema/exporter versions, export UUID, UTC generation time, paths, row counts, and byte counts. The manifest describes the other archive entries (it does not recursively include its own byte size). Source currencies are retained; export never converts or rounds stored finance values. CSV strings beginning with spreadsheet formula characters are prefixed safely while numeric strings (including negative financial amounts) remain numeric text. Automatic provider quotes in the legacy portfolio snapshot are excluded, explicit manual prices remain, and manual quote overrides are exported from their dedicated table. Calendar feed token values, session/password/reset/verification hashes, OAuth credentials, provider quote snapshots, derived caches and shared market/ESPI data are excluded.

The export is bounded to 50,000 rows per source dataset, 100,000 total source rows, and 32 MiB of source/serialized/ZIP content. Limits are checked within the consistent snapshot before row pages are materialized and after serialization/compression. An over-limit export returns HTTP 413, never a partial archive. The endpoint uses a PostgreSQL-backed account/IP limiter and returns 503 if limiter dependencies are unavailable.

## Account deletion and session invalidation

The UI requires a separate explicit confirmation after reauthentication and gives the user an opportunity to download the export. Password and Google-only users cannot bypass step-up. The deletion token is bound to the user by its database row and lookup, expires after ten minutes, and is consumed transactionally on an accepted attempt; a last-admin block also consumes it, so a new step-up is needed after handoff. Sessions, auth accounts, verification/reset tokens, portfolios and FK-owned rows cascade. The one unlinked derived cache has an explicit deletion. Database errors roll back the transaction and do not produce a success response. If only one admin remains, self-deletion is blocked until privilege transfer; concurrent admin lifecycle operations share the database advisory lock.

Account deletion removes active PostgreSQL records but cannot rewrite already-made backups or guarantee processor-side erasure. Backup retention, legal retention exceptions, processor deletion commitments and the exact completion timeline must be confirmed by the operator/counsel before launch. No retention periods or legal exceptions are invented in the UI.

## Legal documents and publication workflow

Legal drafts are versioned in `src/lib/legal-documents.ts`. The active public document is approved only when an explicit approved document and matching approval record (version, date, approver) are supplied. Do not fill these fields with invented names or dates. Operator/counsel must provide controller identity/contact, legal bases, retention schedule, subprocessors, transfer details, complaint rights/contact, service-provider identity, complaint procedure, consumer terms and effective dates. Keep the pages in draft until reviewed and approved.

## Backup/restore drill

`npm run test:privacy:backup-restore` is a destructive-capable test utility but is strictly restricted to loopback PostgreSQL with database and role exactly `mexo_privacy_test`. It initializes the actual Mexo schema inside one uniquely named synthetic schema, inserts synthetic user/portfolio/account/instrument/operation records, dumps only that schema with `pg_dump`, inspects the custom-format archive, restores into a newly created database named `mexo_privacy_restore_test`, compares owned table counts, stable operation IDs, the exact values PostgreSQL stores, currencies, and foreign-key references, then drops only the target database it created and removes its synthetic schema/temp dump. It refuses to overwrite a pre-existing restore database. It must never receive production/staging credentials.

The CI workflow provisions a disposable native PostgreSQL 16 service, runs integration tests, installs PostgreSQL client tools and runs this restore drill. This proves the isolated fixture flow only; it is not evidence that Aiven production backups or disaster recovery were tested.

## Staging checklist

1. Create a disposable PostgreSQL database with no route/network path or credentials shared with Aiven production. Set `MEXO_PRIVACY_TEST_DATABASE_URL` only to a loopback test instance for the dump/restore script.
2. Deploy the branch to isolated staging over HTTPS. Configure the normal session secret, database TLS, and a dedicated `MEXO_RATE_LIMIT_HMAC_KEY` (not `DATABASE_URL`); configure exactly one trusted proxy IP header only where Nginx/Cloudflare overwrites it. Never disable distributed limiting.
3. Configure a Google OAuth client with the staging callback and origin; verify the ID token includes requested `auth_time`. Test a stale/missing `auth_time` fails closed, a fresh linked identity succeeds, a different Google subject fails, and login behavior remains unchanged.
4. Seed two synthetic users, multiple currencies, operations, dividends, calendar settings and one admin in staging. Verify export only contains owner rows and no secrets; test deletion for password and Google accounts, challenge expiry/replay, duplicate clicks, CSRF, database rollback, and last-admin behavior. Confirm the second user and shared rows remain.
5. Confirm CSP/legal publication state, rate limiting, and no-store headers; do not publish the legal drafts until operator/counsel approval.

## Tests and evidence

See the PR checks and final implementation report for exact test totals. Local PostgreSQL/Docker is not required; the isolated PostgreSQL integration and pg_dump/pg_restore checks run in the dedicated GitHub Actions service. Browser OAuth, reverse-proxy IP trust, and Aiven recovery require a configured staging environment and are not claimed as tested until performed there.

## Operator decisions and risks

- Approve controller/contact/legal content, legal bases, retention and exception wording, subprocessors/cross-border transfer disclosures, complaints and terms before publication.
- Verify production schema inventory and all FKs against Aiven migrations before deployment; repository schema inspection is not a live Aiven audit.
- Confirm backup/PITR settings, encryption/access control, a human-reviewed staging restore, and RPO/RTO targets.
- Verify Google OAuth fresh-auth claim behavior on staging; provider/client setup may affect Google-only self-service deletion. Missing/stale `auth_time` fails closed.
- Review the 32 MiB export ceiling and staff a support channel for larger accounts.
- Decide whether the last administrator must transfer privileges or use a separately controlled operator procedure.

## Rollback and migration

The only database addition is an idempotent challenge table and index created by the existing schema initializer; no production migration was run. Application rollback can leave this additive table in place. Do not remove it while deployed code may use it. If a future schema change is needed, use a forward-compatible migration first; schema rollback is separate from application rollback. Do not restore an earlier backup as routine code rollback because it can discard valid writes.
