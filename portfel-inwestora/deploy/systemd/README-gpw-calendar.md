# GPW calendar timer (prepared, not installed)

The timer invokes the existing central ESPI/WZA/dividend/report projections every two hours. PostgreSQL's session advisory lock prevents overlapping timer runs across processes; source lanes retain their persisted locks, cooldowns, and bounded historical cursors. The command logs source and projection status without printing connection details.

Before enabling it on any server, review the read-only calendar audit for representative months and run `scripts/preview-gpw-report-reprojection.mjs --dry-run` page by page against a safe database copy. Resolve ambiguous projections manually. A parser update increments the report projection version, so subsequent timer runs revisit previously successful stored source documents in bounded batches. No annual URL or date needs to be added to the issuer registry for the official GPW/ESPI discovery lane.

The service expects `DATABASE_URL` and any required `POSTGRES_CA_CERT_BASE64` or `POSTGRES_CA_CERT_PATH` in `/etc/mexo/gpw-calendar-sync.env`, owned by the deployment administrator and unreadable by other users. The file is not part of this repository. Confirm the server's Node path, service user and application directory before installing the unit files. No timer is enabled by this change.

Public calendar and authenticated GPW views read the shared `corporate_events` catalog. The public page now reports incomplete historical source backfills; it does not imply every GPW issuer has announced a schedule.

## Read-only acceptance before activation

Keep this timer disabled until a reviewed release is installed. Use the read-only audit (it begins a PostgreSQL `READ ONLY` transaction) for November and December 2026 and a future month, and inspect the source-specific dry-run plan for suspicious rows:

```sh
node scripts/audit-public-gpw-calendar.mjs --month=2026-11
node scripts/audit-public-gpw-calendar.mjs --month=2026-12
node scripts/preview-gpw-report-reprojection.mjs --dry-run --limit=50
```

The source audit also supports `--source-ids=gpw:...` and reports parsed events and dividend reprojection decisions. It does not apply those decisions. Compare report dates and dividend entitlements/payments with the linked official issuer notices. Review `duplicateGroups`, `excluded`, ambiguous rows, projection errors, and the bounded backlog. A zero-error build alone is not evidence that the calendar data are complete.

If a PDF attachment is unavailable, the source remains in `PARSE_ERROR` for retry. The body of an official report can establish that its *own* shareholder amendment was non-binding, but its old-date projection is withdrawn only when a separate, later official report confirms the proposed new payment date and amount. The withdrawal is restricted to exclusively attributed payment-only rows and retains a previous-row audit snapshot. Do not infer the contents of the inaccessible attachment or automatically retire events also supported by another official source.

## Non-production rehearsal

Restore a disposable database copy that has no live credentials or production writes. From the tested release's `portfel-inwestora` directory, point `DATABASE_URL` only at that copy, configure a trusted Aiven-compatible CA if required, and run the sync script once with `--run`. Run it again to verify idempotency. Check the two month audits, projection-change history, DB connection count and the four source-state cursors. Simulate an unavailable GPW page and a failed PDF download: neither may erase last-good events, and the failed source must be retried. The process should exit nonzero on an unrecovered source/projection error. Do not use the production database for this rehearsal.

## Later production setup (separate approval required)

1. Confirm the actual Node executable supports `--experimental-strip-types` and the alias loader, and that `ubuntu` can read the checked-out release in `/opt/mexo/repo/portfel-inwestora`. Keep a rollback release and database backup before any projection update.
2. Have the infrastructure owner create `/etc/mexo/gpw-calendar-sync.env` outside Git, owned by root, group-readable only by the service group (`0640` or stricter). Put only the required `DATABASE_URL` and one of `POSTGRES_CA_CERT_BASE64` or `POSTGRES_CA_CERT_PATH` there. Do not print their values or place them in systemd command arguments. Restrict the CA file's permissions similarly.
3. Install the reviewed service/timer units, run `systemd-analyze verify` on both, then perform one supervised `systemctl start mexo-gpw-calendar-sync.service` and inspect redacted journal counters. The session advisory lock and persisted per-source locks prevent overlap; the script limits work to three projection batches per lane and one PAP backfill page per run.
4. Only after the supervised run passes the read-only audits, enable the two-hour timer. `Persistent=true` means one missed run starts after boot, not a burst of every missed interval. Monitor `systemctl status`, `journalctl -u mexo-gpw-calendar-sync.service`, source-state cursors, error counts, active event duplicates and database connections. Allow the 370-day bounded repair cursor to finish before claiming historical completeness.
5. Rollback: disable the timer first, restore the previous application release, retain all source reports and `corporate_event_projection_changes`; review audit snapshots before selectively reverting a projection. Never bulk-delete events or replay an old database over new user data.

This repository change does not install, start, enable, or deploy the timer, and does not modify production data.

Read-only Oracle preflight on 22 October 2026 confirmed `/usr/bin/node` v24.21.0, the expected application directory, and that this timer is `not-found`/`inactive`; `/etc/mexo/gpw-calendar-sync.env` is absent. Those findings are not approval to activate it. The release and non-production rehearsal above still have to pass first.
