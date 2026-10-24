# GPW parser and calendar audit — 2026-10-24

## Scope and safety boundary

This audit used read-only HTTP access to the public Mexo ICS feed and official issuer / GPW material. It did not connect to or modify production PostgreSQL, install a production timer, deploy, or change DNS. Production revision observed in `X-Mexo-Revision`: `ba4d065ae5fe065fbe0e8b806b9c2a6a1c55ae99`.

The parser repair in this branch covers a reproducible WZA language gap and synchronization health reporting. It is not a claim of complete GPW coverage.

## Read-only 365-day snapshot

At 2026-10-24, `GET /api/calendar/gpw.ics?categories=reports,dividends,meetings` returned HTTP 200 and 932 VEVENTs (the route publishes a 15-month window and retains cancellation tombstones). Filtering `DTSTART` to 2026-10-24 through 2027-10-24 inclusive yielded:

| Measure | Count |
| --- | ---: |
| Events in date window, including cancelled tombstones | 525 |
| Active events | 462 |
| Cancelled tombstones | 63 |
| Active summaries containing “Raport” | 413 |
| Active summaries containing “zgromadzenie” | 26 |
| Active summaries containing “dywidend” | 23 |

These are feed row counts, not an issuer-level completeness metric. A count of displayed rows cannot prove that every official source was fetched or parsed.

## Verified live examples and unresolved data

| Case | Public feed at audit time | Independent source / assessment |
| --- | --- | --- |
| Orange Polska Q3 2026 | Active Q3 on 2026-10-26; a cancelled H1 tombstone remains | [Issuer calendar](https://www.orange-ir.pl/calendar/) confirms Q3 on 26 Oct and H1 on 27 Jul. The cancelled record is not an active duplicate. |
| Alior Bank Q3 2026 | Active event on 2026-10-27 labelled H1 2026 | [Issuer calendar](https://www.aliorbank.pl/dodatkowe-informacje/relacje-inwestorskie/kalendarium.html) and [report 42/2025](https://www.aliorbank.pl/dam/jcr%3A877c68a8-f5f2-4a5b-95d1-a4a91cfc085b/Raport_biezacy_42_2025.pdf) say this is the consolidated Q3 report. The persisted projection is wrong and needs a controlled reprojection. |
| Bank Pekao Q3 2026 | Active Q3 on 2026-10-29 | [Issuer calendar](https://www.pekao.com.pl/relacje-inwestorskie/aktualnosci-i-kalendarium/kalendarium.html) agrees. |
| ORLEN Q3 2026 | Active Q3 on 2026-11-05 | [Issuer report 35/2026](https://www.orlen.pl/pl/relacje-inwestorskie/raporty-i-publikacje/raporty-biezace/2026/02/Raport-biezacy-nr-35-2026) agrees with the corrected date. |
| Herkules Q3 2026 | Active Q3 on 2026-11-26 | [Issuer correction 49/2026](https://pap-mediaroom.pl/biznes-i-finanse/herkules-sa-w-restrukturyzacji-492026-zmiana-terminu-publikacji-raportu-okresowego) agrees with the corrected date. |
| Urteste Q3 2026 | Active Q3 on 2026-11-30 | Issuer correction agrees with the corrected date; a durable official issuer link was not captured in this audit record. |
| GreenX AGM | Active ZWZ on 2026-11-11 | The event is present; do not treat it as currently missing. |
| Allegro OGM + EGM | Both absent from the active 365-day feed | [Official issuer meeting page](https://about.allegro.eu/investors/general-meetings/) and [GPW notice](https://www.gpw.pl/komunikat?geru_id=498094) confirm meetings on 18 Nov 2026, at 14:00 and 14:30 marked CEST, with record date 4 Nov. A current parser run on the GPW notice body returned no events before the fix. |
| GreenX report labels | Active generic and period-specific summaries share 2027-01-29 and 2027-07-30 | Possible stale/duplicate projections; retain for review until the exact source rows and event identities are compared. Do not delete by date alone. |
| ERG Q3 2029 | Active summary says Q3 2029 for 2026-11-19 | High-risk period/date anomaly. Preserve and flag for source review; do not silently infer a replacement. |

The official Allegro notice uses “CEST” in November. Mexo's current date-specific conversion treats the literal CEST offset as UTC+2 and produces Warsaw-local 13:00/13:30. This is an explicit conversion, not proof that the issuer intended CEST rather than CET. The source text and designation must remain available for review; the feed alone does not expose the original abbreviation as a separate field.

## Confirmed parser defect and code changes

The meeting parser normalizes Polish diacritics before matching. Its formal-notice and semantic-date expressions recognized singular `odbędzie się` (`odbedzie sie`) but not plural `odbędą się` (`odbeda sie`). Allegro's combined OGM/EGM notice uses the plural form; the formal meeting was therefore rejected before date binding. A regression test now covers the official GPW notice shape and verifies two separate identities and the two converted meeting times.

The WZA projection version advances from 7 to 8 so previously successful source documents can be re-evaluated. The report-schedule projection version advances from 8 to 9 because the live snapshot still contains an Alior period label contradicted by its official schedule. The version changes only queue work; they do not themselves write production data in this branch.

Central and opportunistic synchronization now log per-lane outcome, counts, errors, and remaining backlog. A bounded projection run with pending records is labelled `INCOMPLETE`; the scheduled runner exits non-zero when its projection queue remains after its bounded retries. Source backfill continuation is logged separately from failure because that cursor is intentionally advanced over multiple runs.

## Quality-evidence limits

No set of 150 official documents / 100 independently annotated records / 25–30 untouched holdout documents was assembled in this environment. Existing unit fixtures are not an independent evaluation set, and they must not be counted as one. Consequently no precision, recall, period accuracy, correction accuracy, or mutation-kill percentage is reported. The live Allegro reproduction is one independently checked parser defect, not a statistical estimate.

The production DB cursor state, per-source fetch failures, unmatched issuer totals, projection-version distribution, and full source-level 365-day audit could not be read: no production connection was used. Local PostgreSQL availability and integration-test execution are reported separately in the task handoff. A 200 response from the public ICS feed is not evidence that source backfill completed.

### Comparable single-document result (development case, not holdout)

For the official Allegro GPW notice above, expected output is two separate meetings (ZWZ and NWZ) on 2026-11-18. The previous production parser matched neither because it accepted only the singular Polish verb form; the updated parser test emits two distinct stable identities. The literal `CEST` times convert to 13:00 and 13:30 in `Europe/Warsaw` in November (CET is then UTC+1 while the source's literal CEST is UTC+2). The source's unusual abbreviation remains an unresolved issuer/source ambiguity. This one document was used to diagnose the implementation, so its result is a regression check only and is excluded from any independent precision/recall estimate.

### Validation executed on 2026-10-24

- Full `npm test` against an isolated native PostgreSQL 18.6 instance bound to `127.0.0.1:56432`: **621 passed, 0 failed, 0 skipped**. The PostgreSQL integration test inserted synthetic records under a random fixture identity, checked schedule projection idempotency, correction history, and preservation of a reviewed anomaly, then removed its fixture records.
- `npx tsc --noEmit`: passed.
- ESLint on all changed TS/MJS files: passed.
- Full `npm run lint`: failed on **25 existing errors and 1 warning** in unrelated UI components (including AuthCard, CashWorkspace, ConfigurableDashboard, EspiWorkspace, PortfolioLineCharts and PortfolioPerformanceResults). No global rules were disabled and no unrelated files were modified.
- `npm run build`: passed. Next.js emitted its existing Recharts `width(-1)/height(-1)` warning during static generation; it did not fail the build and is outside this GPW scope.
- `git diff --check`: passed.

The isolated PostgreSQL cluster was stopped after the test and its random fixture rows were removed. The downloaded portable binaries and cluster files remain under `%TEMP%\mexo-gpw-pg-20261024`; the shell safety policy blocked recursive cleanup. No Aiven database, production record, timer, deployment, or DNS configuration was changed.

### Release decision at audit close

- Parser/branch correctness for the independently reproduced Allegro grammar gap: **PASS as a targeted regression**.
- Full data-quality release criteria: **NO-GO**. The required independently annotated corpus (150 source documents / at least 100 verified / 25–30 untouched holdout cases), mutation score, complete source/cursor audit, and cross-view production reprojection evidence are not available. Do not present this branch as statistically validated or production-ready.
- Production reprojection: **NO-GO / not executed**. The public feed still contains the Alior H1-vs-Q3 inconsistency and omits the two Allegro meetings.
- Timer activation: **NO-GO / not executed**.
- Branch `fix/gpw-quality-audit-20261024` was pushed for review. Draft PR creation returned GitHub API 403 (`Resource not accessible by integration`); the PR form is available at <https://github.com/mexo4/Portfel/pull/new/fix/gpw-quality-audit-20261024>. It must not be merged or deployed until the corpus and production data gates are met and the user explicitly approves.

## Safe later production procedure — not executed

1. Before release, take an encrypted Aiven backup using the approved secure channel; verify its checksum and perform a restore test into an isolated native PostgreSQL database. Never put a connection URI or dump in the repository or logs.
2. On that isolated restore, run parser/projection tests, the read-only `scripts/preview-gpw-report-reprojection.mjs --dry-run` in bounded batches, and verify every planned deactivation against source evidence. Run the loopback-only PostgreSQL integration test suite. Do not point a write-capable test at production.
3. Review the full source-cursor, unmatched, parse-error, pending, duplicate, and history-change report. Stop on any unexplained identity/date change, incomplete attachment parse, or failed source.
4. Only after explicit approval, deploy the reviewed commit and verify `/api/system/revision`. Do not enable a timer at this step. Keep the prior managed Oracle release available for rollback.
5. Run one operator-controlled sync batch at a time via the managed-release launcher. Re-run the read-only preview before each batch; compare active events, cancellation state, period/date, sources, and `corporate_event_history`. Continue only while each batch is understood and the durable cursors advance without skipped pages.
6. Verify the same event IDs, sources, local dates/times, statuses, and cancellation state through the API, authenticated calendar, public `/kalendarz-gpw`, and ICS. Re-fetch ICS after cache expiry. Confirm the source backfill cursor and all projection pending counts are complete before declaring the calendar caught up.
7. Monitor source errors, pending counts, and event-history changes. If a batch is suspect, stop the sync first; preserve the backup and audit output. Restore the prior application release for code issues. For data issues, use the verified backup or a reviewed event-history-based correction plan—do not assume code rollback reverses database projections.
8. Activate any future timer only after the user approves the GO decision, a successful staged run, verified backup/restore, complete source and projection cursors, and a tested rollback. This timer was not installed or enabled by this audit.
