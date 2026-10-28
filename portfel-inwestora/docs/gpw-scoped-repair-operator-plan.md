# GPW: scoped repair proposal and operator gate

This document is a **plan, not authorization**. The generated
`artifacts/gpw-quality/scoped-repair-proposal.{json,md}` is ignored by Git and
contains 15 UPDATE, 15 DEACTIVATE, 2 LINK_SOURCE, 10 NO_CHANGE controls, and
one excluded REVIEW (`gpw:499257`). No Aiven write command is provided here.
The global GPW quality/readiness gate remains NO-GO.

## Independent source review

Run `node scripts/run-gpw-scoped-repair-proposal.mjs` against the read-only
snapshot and original manifest. For **each of the 32 modifications**, an
independent reviewer must open every cited official GPW report and record:

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
5. A separately authorized production executor must acquire an operator lock,
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

No production executor, migration, timer change, or Aiven mutation is part of
this PR. The separate release decision must consider the broader GPW quality
gate, which is not satisfied by these 32 scoped corrections.
