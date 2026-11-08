# Privacy, backup and restore readiness — operator runbook

Status: PRE-RELEASE DRAFT. No production backup or restore was run as part of this implementation. No production Aiven data was read or modified.

## Required controls before launch

1. Confirm Aiven point-in-time recovery / backup retention settings in the provider console and record the account, region, retention policy, last successful backup timestamp and restore procedure. Do not infer these from application deployment rollback.
2. Assign the operator responsible for backup verification and a second reviewer. Keep backup encryption keys separate from the database and restrict access.
3. Create a disposable PostgreSQL database in an isolated non-production project/account. Verify host, database, role and environment label before any restore.
4. Take a custom-format dump only from the designated staging/isolated database. Never paste connection URIs or credentials into command history, logs, or issue comments. Prefer `PGSERVICE`/secret manager or an interactive password prompt.
5. Restore into a fresh isolated database, never with `--clean` against a shared or production target. Run `pg_restore --list` first, then restore as a dedicated test owner.
6. Compare schema, row counts by table, FK checks, application login, account export, portfolio read, and a known synthetic operation. Drop the disposable target only after recording results.
7. Record start/end timestamps, last recoverable transaction timestamp, elapsed restore time, checks performed, and reviewer sign-off.

Example shape (replace names with explicitly isolated staging resources; credentials must come from a protected environment, not inline):

```sh
pg_dump --format=custom --no-owner --no-acl --file=mexo-staging.dump "$MEXO_STAGING_DATABASE_URL"
pg_restore --list mexo-staging.dump
createdb --host="$ISOLATED_TEST_PGHOST" --username="$ISOLATED_TEST_PGUSER" mexo_restore_drill
pg_restore --exit-on-error --no-owner --no-acl --host="$ISOLATED_TEST_PGHOST" \
  --username="$ISOLATED_TEST_PGUSER" --dbname=mexo_restore_drill mexo-staging.dump
```

Before commands, assert both source and target hosts are the approved isolated staging/test hosts and the target database is disposable. These examples are not authorization to dump or restore production.

## RPO and RTO evidence

- **RPO observed** = time between the latest acknowledged synthetic write in the source and the latest such write present in the restored copy. Record the timestamp and any missing writes; do not substitute provider retention settings for a restore measurement.
- **RTO observed** = elapsed time from declaring the drill outage to successful validation of the restored Mexo instance, including database restore, app configuration, and smoke checks.
- Choose launch SLO targets only after operator/product approval: RPO target `DO UZUPEŁNIENIA`, RTO target `DO UZUPEŁNIENIA`.

## Migration and rollback

Application rollback changes code/runtime only; it does **not** restore PostgreSQL to an earlier state. For an additive schema migration, prefer a forward-compatible rollback: redeploy compatible code, keep additive columns/tables, then ship a corrective migration. Before any destructive migration, require a verified backup and a rehearsed restore. A full restore can discard valid writes made after the backup; it requires an explicit incident decision and a recorded data reconciliation plan. Never automatically restore Aiven as part of application rollback.

## Account deletion retention

Direct deletion removes user/root-owned rows in one transaction, with declared cascades, and explicitly deletes `portfolio_engine_cache` rows that lack a foreign key. Shared market, corporate event, ESPI and rate-limit data remain. Backup copies are not rewritten by account deletion. The backup retention schedule and any legal retention exception must be approved and disclosed separately; current durations are `DO UZUPEŁNIENIA`.

## Operator checklist before public release

- [ ] Live schema matches `docs/privacy-data-inventory.md`; no unlisted user-owned tables or FK gaps.
- [ ] Aiven backup/PITR settings and retention are verified and recorded.
- [ ] Staging backup restore drill completed and reviewed.
- [ ] RPO/RTO targets approved and measured.
- [ ] Privacy contact, controller details, retention, legal bases, subprocessors and cross-border transfers completed by operator/counsel.
- [ ] `/privacy` and `/terms` each have a reviewed immutable version, approver, approval timestamp, and explicit publication registry entry.
- [ ] Password and Google-only account deletion step-up tested on staging; last-admin transfer procedure tested.
- [ ] Support/export process for accounts over the enforced 32 MiB export ceiling is staffed and documented.
- [ ] No production deletion/restore test performed; audit logs and access restrictions are enabled.
