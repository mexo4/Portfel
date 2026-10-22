# GPW calendar timer (prepared, not installed)

The timer invokes the existing central ESPI/WZA/dividend/report projections every two hours. PostgreSQL's session advisory lock prevents overlapping timer runs across processes; source lanes retain their persisted locks, cooldowns, and bounded historical cursors. The command logs source and projection status without printing connection details.

Before enabling it on any server, review the read-only calendar audit for representative months and run `scripts/preview-gpw-report-reprojection.mjs --dry-run` page by page against a safe database copy. Resolve ambiguous projections manually. A parser update increments the report projection version, so subsequent timer runs revisit previously successful stored source documents in bounded batches. No annual URL or date needs to be added to the issuer registry for the official GPW/ESPI discovery lane.

The service expects `DATABASE_URL` and any required `POSTGRES_CA_CERT_BASE64` or `POSTGRES_CA_CERT_PATH` in `/etc/mexo/gpw-calendar-sync.env`, owned by the deployment administrator and unreadable by other users. The file is not part of this repository. Confirm the server's Node path, service user and application directory before installing the unit files. No timer is enabled by this change.

Public calendar and authenticated GPW views read the shared `corporate_events` catalog. The public page now reports incomplete historical source backfills; it does not imply every GPW issuer has announced a schedule.
