# GPW: scoped repair proposal and operator gate

This document is a **plan, not authorization**. The generated
`artifacts/gpw-quality/scoped-repair-proposal.{json,md}` is ignored by Git and
contains 15 UPDATE, 15 DEACTIVATE, 2 LINK_SOURCE, 10 NO_CHANGE controls, and
one excluded REVIEW (`gpw:499257`). The separate executable is **not**
permission to use it. No Aiven write was performed while preparing this PR.
The global GPW quality/readiness gate remains NO-GO.

## Independent source review

Run `node scripts/run-gpw-scoped-repair-proposal.mjs` against the read-only
snapshot and original manifest. Use the source-grouped
[`gpw-scoped-source-evidence-2026-10-28.md`](gpw-scoped-source-evidence-2026-10-28.md)
as the review worksheet; its short excerpts and confidence assessments are
preparation for review, **not** pre-filled approval.
For **each of the 32 modifications**, an independent reviewer must open every
cited official GPW report and record:

| Field | Required entry |
| --- | --- |
| Event ID and action | Exact proposal row, including linked same-issuer rows |
| Official source | URL, report number, publication time, issuer identity |
| Exact evidence | Text/page/attachment proving the proposed date, fiscal period, identity or deactivation; distinguish publication date from fiscal period end |
| Existing projection | Current date, identity, active flag, source priority and linked sources |
| Expected state | Exact date, identity, active flag, source link; reason for preserving the same ID |
| Independent check | Reviewer name, time, decision, and a second reviewer for destructive deactivation |
| Exceptions | Missing attachment, ambiguity, source revision or conflicting issuer event means BLOCKED |

The parser's output, the existing manifest explanation and a green replay are
**not** independent source confirmations. Do not fill approval fields from
those outputs. The 10 NO_CHANGE rows are exact-row invariants and must remain
unchanged. Linked same-issuer corrections and deactivations stay in **one
atomic transaction**, not individually cherry-picked updates.

The official [GPW report 47/2026](https://www.gpw.pl/komunikat?geru_id=499257)
is an Eurohold Bulgaria insider-transaction notification from 22 October 2026.
The report body references one RAR attachment, but the attachment endpoint
rejected a normal public read during this review. The issuer's
[public archive](https://www.eurohold.bg/archive-918.html) did not establish
the complete 22 October attachment contents. The document remains REVIEW;
no calendar date is inferred from it, and no access protection is bypassed.
It has no event ID in the source manifest, its GPW source ID is absent from
the 42 other actions, and the read-only snapshot contains no target issuer
with the report's ISIN `BG1100114062`. These are technical separation checks,
not independent proof of every proposed correction; repeat them on a fresh
snapshot before approval.

## Operator sequence after separate approval

1. Obtain signed, independent source decisions for every modification and
   confirm that the excluded REVIEW has no newly discovered dependency on the
   scoped rows. Do not proceed if any decision is missing or conflicting.
2. Choose a maintenance window. Stop the central GPW timer and any other job
   or API path capable of writing these issuer events; verify no sync is
   running. The scheduled sync's advisory lock alone is not proof that all
   application write paths are idle. Keep the synchronization pause in force
   until post-write verification finishes.
3. Make an encrypted, access-controlled PostgreSQL custom-format backup of
   the affected tables and their provenance/history, plus a database-level
   recovery point. Restore the backup into a separate isolated database and
   compare row counts, checksums and the 42 target event IDs. No backup or
   restore test may overwrite production.
4. Capture a **fresh** read-only, repeatable-read Aiven snapshot immediately
   before the proposed write. Rebuild the manifest and scoped proposal. Require
   exact event IDs, issuer IDs, full-row fingerprints, source links, priorities,
   history, and no new identity collisions. Any drift requires renewed review;
   do not silently update the approved manifest.
5. The separately authorized production executor acquires an operator lock,
   use a single `SERIALIZABLE` transaction, lock all affected event/source rows,
   recheck all preconditions and the 10 NO_CHANGE rows **inside** that
   transaction, and apply all 32 modifications or none. Preserve stable IDs,
   write date history and projection provenance, and reject new conflicting
   active identities. A serialization failure means rollback and fresh review,
   not an unbounded retry.
6. Before commit, compare the intended after-state, including unchanged WZA
   and dividend rows, with the approved source matrix. Commit only if every
   check passes. After commit, verify no old active duplicates, expected
   history/source links, API, public calendar HTML and ICS against the same
   corrected dates. Record the final row fingerprints.
7. If verification fails before commit, roll back the transaction. If it fails
   after commit, keep GPW synchronization paused and decide between a carefully
   reviewed inverse transaction and the tested backup restore. Never replay an
   old snapshot over later independent writes. Re-enable synchronization only
   after the corrected state is validated and operators approve it.

## Minimal approval and execution checklist (for a later, separately authorized window)

1. Generate a **blank** 42-row template using
   `node scripts/run-gpw-scoped-approval-template.mjs`.
   Copy it outside the repository. For each of the 32 proposed modifications,
   an independent human enters `APPROVE`, reviewer/time, official `sourceUrl`,
   the exact source excerpt and a reason. Every DEACTIVATE also needs a distinct
   second reviewer/time and an explanation of the valid event that remains
   active (or why no same-identity event should remain). For each of the 10
   NO_CHANGE controls, enter `CONFIRM_UNCHANGED` and reviewer/time. `REJECT`,
   `NEED_MORE`, blank fields and any `gpw:499257` entry block execution.
   Merely copying a parser claim is not independent approval.
2. Operator records a backup proof **outside the repo**, with these exact
   fields: `schemaVersion:1`, `snapshotFingerprint`, `operator`,
   `backup:{path,sha256}`, `restoreDrill:{passed:true,snapshotFingerprint,
   targetEvents:42,completedAt}`, and `syncPause:{allWritersStopped:true,
   operator,sources:["GPW_REPORT_SCHEDULES","GPW_WZA","GPW_DIVIDENDS"],pausedAt}`.
   The restore drill must be on a separate **loopback** PostgreSQL database
   and role both named `mexo_gpw_test`. Supply its URI through
   `MEXO_GPW_RESTORE_TEST_DATABASE_URL`; the executor reads the restored
   market rows and compares them with the approved snapshot **before**
   connecting to Aiven. The backup file must remain accessible so its SHA-256
   can be checked. The pause fields are a human attestation, not a substitute
   for actually stopping all GPW writers. Never set them true in advance.
3. Provision a dedicated, non-superuser `mexo_gpw_repair` role with only SELECT
   on market rows/sync state, UPDATE on `corporate_events`, and INSERT on the
   three source/history/projection tables. No DELETE, user data or transaction
   permissions. Supply its Aiven URI only through
   `MEXO_GPW_REPAIR_DATABASE_URL` and a verified CA through
   `POSTGRES_CA_CERT_BASE64` or `POSTGRES_CA_CERT_PATH`. No application DB
   fallback exists. This role has **not** been created by this PR.
4. With GPW writers stopped and the verified backup restored separately,
   capture a fresh read-only snapshot (`gpw-reprojection-snapshot.mjs`) and
   confirm it matches the approved manifest and all review/backup fingerprints.
   Snapshot age must be at most 10 minutes; restore drill at most 24 hours;
   pause confirmation at most 10 minutes. If data has drifted, renew review
   rather than forcing a replay.
5. Run `node scripts/run-gpw-scoped-repair.mjs --manifest <manifest.json> --snapshot
   <snapshot.json> --decisions <reviewed.json> --proof <operator-proof.json>`.
   This is the **default read-only dry-run**. Its result must report 15 UPDATE,
   15 DEACTIVATE, 2 LINK_SOURCE, 10 NO_CHANGE and the excluded REVIEW.
6. Only after separate explicit authorization, repeat the same command with
   `--apply --operator <operator ID> --confirm-fingerprint <fresh snapshot SHA-256>`.
   The operator ID must match the operator proof. The executor
   rechecks TLS, role privileges, sync locks, live ESPI report rows, all
   issuer/event/source/history rows and collisions inside one SERIALIZABLE
   transaction. It locks `corporate_events` during apply and rechecks the
   source/provenance rows under SERIALIZABLE isolation, verifies
   the post-state before commit and rolls back on any failure. An unchanged
   repeat cannot duplicate changes: its old baseline is rejected as drift.
7. Inspect API, public calendar and ICS after commit while sync remains paused;
   if there is a problem, use the separately reviewed rollback/restore plan.
   Only then may the operator resume GPW synchronization.

This scoped readiness is **not** a statement that the full GPW calendar is
complete. The global NO-GO remains unchanged. There is no merge, deploy,
production sync pause, role provisioning or Aiven write in this PR.
