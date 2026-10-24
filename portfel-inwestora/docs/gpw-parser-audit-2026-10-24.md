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

## Follow-up validation before PR (2026-10-24)

### Parser repairs found by adversarial source checks

The official [Herkules report 49/2026](https://pap-mediaroom.pl/biznes-i-finanse/herkules-sa-w-restrukturyzacji-492026-zmiana-terminu-publikacji-raportu-okresowego) exposed a wrapped correction pattern not covered by the earlier short-form unit case. The source puts the previously scheduled date after a multi-clause phrase (“miał być przekazany do publicznej wiadomości w dniu 19 listopada”), then gives the new date in a following physical line. Candidate segmentation emitted three fragments; in addition, the prior-date grammatical context was capped at 40 characters. The parser now joins only a bounded correction row, stops at a new report/section, and evaluates the explicit prior-schedule cue in a separate bounded 220-character window. It emits Q3 2026 on 26 November with 19 November as the previous date. The full PAP source was added as a source-linked fixture; expected values were transcribed from the publication.

False-positive review also found that a shareholder-eligibility list in a follow-up notice could be mistaken for a newly convened meeting. Such lists are now excluded as WZA convening evidence, while explicit convening notices remain eligible.

The parser recognizes additional report-correction grammar for a “new term” replacing a prior appointment, a date described as displaced, and old-vs-new date wording where the old schedule sentence spans a line wrap. These rules require grammatical anchors on both sides of a date pair; no issuer/ticker exception was added. Regression coverage includes Herkules, Eko Export, ORLEN, Urteste, DGA, MCR, NPL Nova and ZPC Otmuchów cases already in the source fixtures.

### Source-linked sample evaluation (descriptive only)

The checked-in corpus now contains **57 source-linked documents and 70 annotated expected events**: A development 9, B validation 7, C-labelled holdout 10, D prospective 11, E validation 10, F prospective 10. Five documents are explicitly marked ambiguous. The evaluator performs one-to-one event matching and reports type, date, period/year, and correction-field accuracy rather than deriving recall from row counts alone.

On this known sample, all 57 documents matched their annotations (70/70 event rows; 0 unmatched extras and 0 omissions). Descriptive category metrics were:

| Category | Expected / parsed | Precision / recall | Type | Date | Period | Year | Correction fields |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Reports | 27 / 27 | 1.00 / 1.00 | 27/27 | 27/27 | 27/27 | 26/26 | 12/12 |
| General meetings | 19 / 19 | 1.00 / 1.00 | 19/19 | 19/19 | n/a | n/a | n/a |
| Dividends | 24 / 24 | 1.00 / 1.00 | 24/24 | 24/24 | n/a | n/a | n/a |

These are **not independent-quality estimates**. The dataset is much smaller than the requested 150 documents / 100 verified documents, its groups have already influenced parser development, and the C label is not an untouched holdout. D/E/F were used to find/fix failures; they are known regression data now. Therefore no statistically credible release precision/recall or final holdout score is claimed. A genuine untouched set of 25–30 individually annotated source documents is still required.

The deterministic formatting/property matrix covers 1,200 variants (fixed seed `20261024`) of report-row ordering, spacing, separators and date formats. A new seeded-output mutation-sensitivity test applies 10 representative faults to the annotation oracle (Q1/Q3 swap, fiscal-year shift, wrong date, omitted event, duplicate projection, removed correction, stale date overwrite, merged WZA pair, merged dividend installments, and an unsupported event); all 10 are rejected. This is **oracle sensitivity coverage**, not a source-code mutation score and not proof that every implementation mutant is killed.

### Synchronization health and local persistence test

The sync-health model now distinguishes per-batch outcome, source availability, freshness, bounded historical-backfill progress/cursor, overlap repair, projection queue status, unmatched/review counts, and explicit coverage evidence. Coverage remains `UNASSESSED` unless a complete independent source inventory for a date window is supplied; an empty queue or successful batch cannot assert full calendar completeness. The scheduled runner logs those dimensions separately and treats bounded backfill continuation separately from failure. This code was not run against production and no timer was installed.

A fresh native PostgreSQL 18.6 cluster was created under a random `%TEMP%` directory, bound only to `127.0.0.1`, with a dedicated `mexo_gpw_test` database and eight connections. The integration test passed: 3 source reports fetched, 2 first-pass projection inserts, repeated synchronization inserted 0 new projections, duplicate counters advanced, the corrected Q3 date generated history, and an existing reviewed anomaly remained active. The cluster was stopped after the test. The standard `npm test` run did not implicitly use any ambient database URL; its opt-in PostgreSQL test was skipped there and then run explicitly against this isolated cluster. No Aiven URL was read or used.

### Current validation and gate status

Final validation after all follow-up changes: `npm test` completed with **636 passed, 0 failed, 1 opt-in PostgreSQL test skipped** because the regular suite was run without a database URL. The PostgreSQL integration test was then run explicitly against a fresh, isolated native PostgreSQL 18.6 instance and passed **1/1**. `npx tsc --noEmit` and `npm run build` passed. ESLint on every changed implementation, script, fixture, and test file passed. Full `npm run lint` failed on **25 pre-existing errors and 1 warning** in unrelated UI files; no unrelated files or lint rules were changed. The build prints the existing Recharts `width(-1)/height(-1)` warning, outside this GPW task. `git diff --check` passed.

**Decision remains NO-GO** for declaring the whole GPW dataset complete, production reprojection, production backfill, timer activation, PR creation, or deploy. The fixes are targeted and all available known fixtures pass, but the release gates still lack a 100-document independently adjudicated corpus, a true untouched holdout, full source cursor/data-quality access from production, and a complete native-PostgreSQL crash/resume/reprojection comparison. No PR, merge, deploy, Aiven write, production backfill, timer change, or DNS change was performed.
