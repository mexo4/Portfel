# GPW calendar: read-only release audit, 23 October 2026

This is an acceptance record for the calendar code, **not** a claim that the
production calendar is already repaired. The queries below used the existing
Aiven connection in a PostgreSQL `BEGIN READ ONLY` transaction. No source
reports, projections, user records or timer configuration were changed.

## Source-to-calendar checks

- Official GPW/ESPI source reports are retained centrally; issuer matching is
  independent of the requesting user. Public `/kalendarz-gpw`, authenticated
  GPW calendars and ICS read the shared `corporate_events` and
  `corporate_event_sources` catalog (with their own date windows and filters).
- The generic GPW schedule discovery lane scans the rolling 370-day source
  history in bounded, persistent pages. It does not need an annual list of
  hard-coded URLs. The read-only source cursor was page 87 and its backfill was
  **not complete**. The dividend lane was also incomplete (page 133).
- In stored official documents, the corrected parser recognizes LPP Q3
  (3 Dec 2026), GreenX annual (30 Sep 2027) and its fiscal quarters, and the
  mBank Q3 change (29 to 28 Oct 2026). Budimex's preliminary 28 July figures
  are no longer mistaken for its 21 August half-year report. These are parser
  results; the production projections have **not** been updated.
- Other stored but not yet projected official schedules include Instal Kraków
  Q3 (20 Nov), VRG Q3 (26 Nov), Betacom H1 (11 Dec), Grodno H1 (15 Dec),
  Komputronik H1 (15 Dec) and Intersport H1 (17 Dec). The reader must not be
  described as complete until a later approved reprojection and source
  backfill have finished.
- The official PKO BP, KGHM and PZU November schedules were independently
  confirmed from issuer publications, but their matching source documents
  were not yet present in the sampled Aiven source catalog. The bounded
  backfill must reach those older notices; do not insert synthetic calendar
  records to fill the gap.

## Current stored calendar, before any production repair

| Month | Stored event rows | Public-eligible rows | Displayed reports | Meetings | Record dates | Payment dates | Duplicate groups |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Nov 2026 | 58 | 53 | 30 | 13 | 1 | 10 | 1 |
| Dec 2026 | 18 | 14 | 5 | 0 | 4 | 7 | 1 |
| Sep 2027 | 10 | 6 | 6 | 0 | 0 | 0 | 0 |

The duplicate group in November is the Instal Kraków 6 Nov payment. It is an
existing stored-data issue, not a reason to delete source history. The
source-specific dividend planner identifies the superseded projection and
retains a before-image in `corporate_event_projection_changes` when later run
with write authorization. Grupa Kęty's two real installments are protected;
the earlier 49.05 proposal is distinct from the final 48.97 decision and is
planned for retirement only with formal corroboration. Ambiguous rows stay
active for human review, not automatic guessing.

Some official attachments are currently inaccessible (for example an
attachment to P.A. Nova's proposal). A failed or skipped report PDF now leaves
the source `PARSE_ERROR` and eligible for a 24-hour retry even if the body
provided some dates; existing valid events are not withdrawn because of an
incomplete parse. This is an explicit coverage limitation, not evidence that
every GPW issuer's future timetable is available.

## Later production procedure (requires separate approval)

1. Freeze and back up the relevant Aiven tables and preserve the deployed
   release for rollback. Install the two commits together; do not execute this
   procedure from the present development worktree.
2. Use `scripts/audit-public-gpw-calendar.mjs` for Nov/Dec 2026 and selected
   2027 months. Run the bounded report preview with `--dry-run`, including
   `--source-ids` for known corrections. Review every `ambiguousIds` and the
   dividend source/final/amendment plans against linked official notices.
3. On a disposable database copy, run `scripts/run-gpw-calendar-sync.mjs
   --run` twice under Node 24 with the application alias loader. Verify
   idempotency, valid installments, read/API/ICS output, connection closure,
   failure/retry behavior and the projection-change audit. This cannot be
   substituted with a write to production for testing.
4. After the rehearsal and an approved deployment, run one supervised sync
   against Aiven, review newly created/retired rows and month audits, and let
   the bounded source cursor/backlog finish over successive runs. Only then
   install and enable the two-hour systemd timer, following
   `README-gpw-calendar.md` (including its external secret file, Node path,
   service user and rollback checks).
5. Verify the public month, authenticated All view and ICS independently.
   Do not claim complete GPW coverage until all source cursors finish and
   remaining `PARSE_ERROR`/`UNMATCHED` items are reviewed.

The timer was **not installed or enabled** by this audit; no production
backfill, reprojection, deploy or database write was run.
The live public page could not be loaded from the available browser session
(network connection timeout); the public route and ICS shared-catalog paths
were reviewed in code and covered by the existing route/serialization tests.
This is not a claim of a live post-deploy UI acceptance test.
