# GPW reprojection manifest — read-only source review

The bounded source/projection comparison can be turned into a reviewable,
machine-readable manifest without changing Aiven:

```sh
node scripts/run-gpw-reprojection-manifest.mjs
```

The command reads the ignored `artifacts/gpw-quality/projections.json` snapshot
and writes ignored `artifacts/gpw-quality/reprojection-manifest.json` and `.md`.
It has no PostgreSQL client, SQL statement, synchronization call, or apply mode.
The JSON contains `actions` with stable event IDs, the snapshot's current state,
source-supported state, official GPW URLs, proposed action, confidence, and
originating finding/anomaly; it also contains one assessment per 9 source
findings and 34 calendar anomalies. An unrecognized event, changed source
provenance, or conflicting proposal becomes `REVIEW`, never a guessed fix.

The source decisions are traceable to
[`gpw-incomplete-report-label-source-review.md`](gpw-incomplete-report-label-source-review.md).
The manifest proposes `UPDATE` for an incomplete but genuine report label,
`DEACTIVATE` for a source-disproved event or a source-reviewed obsolete logical
duplicate, `LINK_SOURCE` where the announced event already exists, and
`NO_CHANGE` for the precise surviving side of a reviewed collision. These are
**proposals**, not deletion instructions. In particular, same issuer and date
alone never authorize deactivation. An official document with an inaccessible
attachment and no supported calendar event remains `REVIEW`.

The current source review resolves the calendar meaning of 8 of the 9 bounded
findings and provides a concrete proposal for each of the 34 anomaly records.
`gpw:499257` remains unresolved as an ESPI ingestion/attachment-access issue.
The manifest reports `safeToApply: false` even when all source proposals are
classified. Before an operator may apply any change, an isolated PostgreSQL
replay must verify current Aiven row IDs, active state, source ownership and
priority, unique identity, idempotency, history, interruption/resumption,
rollback, and the application/API/ICS results. No production reprojection is
authorized by this document or by the manifest generator.

Read-only Aiven checks on 27 October 2026 found `gpw:499072` and `gpw:499122`
ingested but not projected (status/version null), although their Q3 events
already existed from earlier schedules. `gpw:499304` was marked `NO_EVENT` at
report-schedule projection version 10 despite its explicit Getin Q3 date
correction. `gpw:499171` was `SUCCESS` at version 10 while earlier imprecise AB
projections remained active. `gpw:499257` had no ESPI row. Thus the first two
are not missing calendar events, but source linkage is incomplete; the Getin
date requires controlled update of the existing logical event. A version bump
alone is not a safe repair and must follow the isolated replay.
