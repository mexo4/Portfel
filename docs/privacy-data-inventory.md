# Mexo user-data inventory (schema checked for Public Release 2.0)

This inventory describes tables defined by `src/lib/server/db.ts`. Recheck the live schema and migration history before deployment; this repository inventory is not a production database inspection.

## Account-owned data

| Relation | Ownership / deletion | Export |
| --- | --- | --- |
| `users` | root row; deletion cascades | Safe account fields and decoded profile/legacy portfolio JSON; excludes password hash |
| `auth_accounts` | `user_id -> users ON DELETE CASCADE` | Provider name, provider subject identifier and linked date are exported; OAuth credentials are not stored in this table |
| `sessions` | `user_id -> users ON DELETE CASCADE` | Excluded (session token hashes) |
| `email_verification_tokens`, `password_reset_tokens` | `user_id -> users ON DELETE CASCADE` | Excluded (credential tokens/hashes) |
| `account_deletion_challenges` | `user_id -> users ON DELETE CASCADE` | Excluded (short-lived verification hash) |
| `user_dashboard_layouts`, `user_dashboard_layout_scopes`, `user_performance_preferences` | `user_id -> users ON DELETE CASCADE` | Included |
| `user_calendar_subscriptions` | `user_id -> users ON DELETE CASCADE` | Scope and configuration included; raw `access_token` and `token_hash` excluded |
| `user_watchlist_items` | `user_id -> users ON DELETE CASCADE`; optional instrument FK is SET NULL | Included |
| `core_portfolios` | `user_id -> users ON DELETE CASCADE` | Included |
| `core_sub_portfolios`, `core_accounts`, `core_instruments`, `core_operations`, `core_tags`, `core_tag_assignments`, `core_benchmarks` | portfolio children cascade from `core_portfolios`; account/asset/tag links also cascade or SET NULL as declared | Included with raw stored values and IDs |
| `portfolio_asset_quotes` | `portfolio_id -> core_portfolios ON DELETE CASCADE`; stores user manual overrides and provider quote snapshots | Only manual price, listing currency, asset/portfolio IDs and timestamps are included; provider data/fallback omitted |
| `portfolio_engine_cache` | indexed by `portfolio_id` but **no FK** | Derived cache excluded and explicitly removed before account deletion |

## Shared/non-user data (must not be removed with an account)

`market_cache`, corporate event instruments/events/sources/checks/history/projection changes, ESPI reports/attachments/sync state, and `auth_rate_limit_buckets` / maintenance are shared system data. They have no ownership relation to an account and are not in user export or account deletion. User-submitted issuer/watchlist links remain scoped by their declared user/portfolio rows.

## Referential observations

- All declared user-root tables found in the schema inventory have `ON DELETE CASCADE` to `users`.
- The portfolio child tables found have `ON DELETE CASCADE` to `core_portfolios`, except `portfolio_engine_cache`, which has no FK and is explicitly removed inside the same account-deletion transaction.
- Instrument relation from watchlist and operation uses `ON DELETE SET NULL`, but instruments themselves are portfolio-owned and cascade with the portfolio.
- Calendar feed credentials are deliberately not portable. Revoking the account removes its private subscription and feed token with the cascade.
- Deletion takes a PostgreSQL advisory transaction lock shared with admin role/deletion paths, locks the user row, validates a one-time challenge and deletes in one transaction. FK checks serialize in-flight child inserts; a child write that loses the race fails instead of recreating the deleted owner.

## Export semantics and limits

The export uses a PostgreSQL repeatable-read, read-only transaction and includes all owned portfolios, not the current SINGLE/ALL/CUSTOM screen range. JSON preserves database values without presentation rounding. `operations.csv`, `dividends.csv`, and `cashflows.csv` are derived from the same operation rows. Spreadsheet formula-leading text cells are escaped; numeric negative values remain numeric. Export is not written to server disk, is private/no-store, and is bounded to 50,000 rows per dataset, 100,000 total source rows, and 32 MiB of uncompressed data/archive. Row counts and approximate source bytes are checked inside the snapshot before pages are materialized; the final serialized archive is checked again. An over-limit request fails with HTTP 413; it never returns a partial archive. Provider market history and derived caches are excluded. Manual overrides are separately exported. A distributed PostgreSQL limiter bounds export requests per account and source address.

No live production schema query was run for this change. Operator must compare this inventory with the current Aiven schema/migrations before release.
