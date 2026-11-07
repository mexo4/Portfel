# GPW quality-audit runbook

This runbook describes read-only quality controls for the GPW calendar.  None
of the commands below synchronizes a live source, writes a production event,
starts a timer, or runs a reprojection.

## Evidence horizons and source access

Keep two independent claims separate. `sourcePublicationHorizon` describes
the official GPW publication dates actually paginated and inspected. The
`futureEventHorizon` is the requested calendar window; a few days of ESPI
publications do **not** prove complete knowledge of all future events in that
window. `sources.json` records both explicitly.

For a bounded, resumable official-source pass:

```powershell
npm run gpw:audit:sources -- --from=2026-10-19 --to=2026-10-23 --max-documents=250 --resume
node scripts/gpw-holdout-intake.mjs
```

The checkpoint and source/holdout artifacts are ignored by Git. Resuming
reuses completed source HTML and records attachment failures; only transient
network failures receive bounded retries. A PAP/ESPI anti-bot challenge, an
unavailable attachment or an attachment-count limit is `PARTIAL`, never a
successful full-document parse. Do not bypass a CAPTCHA. A title-only source
lead in `holdout-intake.json` is **not** a verified event or gold label; two
independent annotations are required before it can validate the parser.

`SOURCE_REVIEW_CANDIDATE` means a novel-looking official document was found
by source-side lexical intake. Review the official body and attachments before
calling it a parser error or changing production events.

## Deterministic gate

Run these commands from `portfel-inwestora` after changing parser, projection,
API or ICS code:

```powershell
npm run gpw:audit
npm run gpw:anomalies
npm run gpw:benchmark
npm run gpw:mutation
npm run gpw:e2e
npm run gpw:readiness
```

Each command writes a JSON report and a Markdown report below
`artifacts/gpw-quality/`.  The directory is ignored by Git and is uploaded as
a CI artifact for the dedicated GPW workflow.

For a read-only completeness check against an operator-exported source and
projection snapshot, use the same command with JSON arrays (or `{ "items":
[...] }` objects):

```powershell
npm run gpw:audit -- --source-inventory=C:\safe-export\inventory.json `
  --source-events=C:\safe-export\source-events.json `
  --projection-events=C:\safe-export\projection-events.json `
  --cache-events=C:\safe-export\calendar-cache.json
```

The snapshot mode only reads those files and emits findings. It does not open
a database connection, fetch the internet, invalidate a cache, or repair a
projection. `--source-events` and `--projection-events` are deliberately
required together so a partial comparison cannot be misrepresented as a clean
result.

`PASS_WITH_LIMITATIONS` is deliberate: it means the deterministic fixture
scope passed, **not** that the complete GPW market or a production projection
was audited.  Inspect the `scope`, `limitations`, and `qualityGate` fields
before using a report as evidence.

## Independent source review

`docs/gpw-source-review-queue-2026-10-24.json` is an intake queue, not a gold
set.  A source may become independent evaluation evidence only after all of
the following are recorded outside parser output:

1. Canonical official URL and source identifier.
2. Source-body hash and fetch status.
3. Expected events transcribed from the official document, including a short
   supporting excerpt or structured evidence.
4. Two independent annotations and, if needed, a documented adjudication.
5. A frozen parser revision chosen before evaluating that document.

Do not change the parser after seeing a holdout result and then call a rerun on
the same document an independent test.  Move failed holdout documents into a
development corpus and use a fresh holdout for the next evaluation.

## Isolated native PostgreSQL contract test

The database integration test is intentionally opt-in.  It will only accept a
dedicated loopback database named `mexo_gpw_test`; it rejects non-loopback
hosts and any other database name before writing.

On a machine with a separately installed native PostgreSQL instance, create a
throwaway local database and set its URL only in the current shell:

```powershell
$env:MEXO_GPW_TEST_DATABASE_URL = 'postgresql://<local-user>@127.0.0.1:<port>/mexo_gpw_test'
npm run gpw:e2e:postgres
Remove-Item Env:MEXO_GPW_TEST_DATABASE_URL
```

Never point this variable at Aiven, Oracle, a shared development database, or
a production URL.  The command does not provision PostgreSQL, use Docker, or
fall back to `DATABASE_URL`.

The separate `npm run gpw:http:e2e` runs a real local Next.js server and writes
only to that same dedicated `mexo_gpw_test` database. It checks login, calendar
API/HTML/ICS, a corrected date, stale-cache invalidation and stable source
identity. Both commands refuse non-loopback hosts or another database name.
Authenticated GPW read routes in this application may opportunistically sync;
**do not** treat a GET on production as read-only evidence. The HTTP E2E is
therefore deliberately isolated, not pointed at Aiven or Oracle.

## Reprojection decision

After producing a read-only Aiven projection snapshot, run
`node scripts/run-gpw-reprojection-manifest.mjs` to produce a source-backed
action manifest. `LINK_SOURCE`, `UPDATE`, `DEACTIVATE` and `REVIEW` are proposed
actions, not applied changes. The manifest fails closed when any source
identity or attachment is unresolved. It is not authorization for an Aiven
write: a complete isolated replay with idempotency, interruption/resumption,
API/ICS verification and human approval must precede any production repair.

`npm run gpw:readiness` reports separate code-review, parser, reprojection,
synchronization, source-completeness and deployment decisions. A parser fixture
PASS, a passing build or a production revision endpoint never substitutes for
independent source coverage. `npm run gpw:quality:gate` exits nonzero while its
strict independent-evidence requirements are unmet; that is an expected NO-GO,
not a reason to weaken the gate.

### Read-only snapshot and isolated replay

The historical decision manifest is a bounded, source-reviewed set of 43
proposals, **not** a generic parser rule. Its event IDs are preconditions for a
specific Aiven snapshot, while `gpw-reprojection-replay.mjs` is the reusable
transactional executor. The snapshot SHA-256 and manifest SHA-256 must match.
Never reconstruct expected source decisions from the same parser under test.

1. Run `node scripts/run-gpw-reprojection-manifest.mjs` against the existing
   ignored projection audit artifacts. Examine all `REVIEW` actions.
2. Set `MEXO_GPW_AUDIT_READONLY_DATABASE_URL` in the current shell from the
   local, untracked Aiven configuration. Do **not** print it. Run
   `node scripts/gpw-reprojection-snapshot.mjs`. This command has no `DATABASE_URL`
   fallback and verifies a `REPEATABLE READ READ ONLY` transaction. It copies
   only public GPW market rows, not users or portfolios, into an ignored
   artifact. An expiring snapshot must be regenerated before any future use.
3. Build locally. Point `MEXO_GPW_TEST_DATABASE_URL` only to a dedicated
   loopback PostgreSQL database **and role** named `mexo_gpw_test`; run
   `npm run gpw:reprojection:replay`. The replay rejects all other hosts, roles
   and database names. Run `node --experimental-strip-types --import ./tests/register-alias-loader.mjs scripts/run-gpw-reprojection-replay.mjs`.
   It seeds public market rows into that isolated DB,
   tests drift, source priority, identity collision, interruption, rollback,
   resume and idempotency (including rejection of an altered post-state), then
   verifies local API, page and ICS. The script
   deletes only its own isolated fixtures. It cannot write Aiven.
4. Run `npm run gpw:readiness`. A 42/43 local replay remains `NOT_READY`
   for a production reprojection while the remaining `REVIEW` is unresolved.

Artifacts `reprojection-snapshot.{json,md}` and
`reprojection-replay.{json,md}` are ignored by Git. Treat them as operational
evidence, not release authorization. Do not publish a snapshot containing
market row IDs or source bodies without reviewing its contents.

### Independent holdout annotation (30 documents)

Run `node scripts/gpw-holdout-intake.mjs` after a bounded official-source
audit. The resulting ignored `holdout-intake.json` freezes 30 issuer-diverse
candidates, their URLs, body hashes and seed. Two different reviewers must
read the official body and accessible attachments **independently**. Each
submits a JSON file with `reviewerId`, `reviewedAt`, `intakeSeed` and one entry
per document: `id`, `sourceBodyHash`, a source-based `reviewNote`, and
`expectedEvents`. An event label needs `eventType`, `eventDate`, optional
fiscal/status/correction fields and `sourceEvidence` quoting or precisely
locating the relevant official passage. An empty array explicitly means no
calendar event. These review files are not generated from `sources.json` and
are not committed until disclosure/rights are checked.

Run `node scripts/run-gpw-holdout-validation.mjs --review-a=<path> --review-b=<path>`.
Missing reviewers yield `ANNOTATION_PENDING`; different conclusions yield
`ANNOTATION_DISAGREEMENT` with no precision/recall. Only exact consensus is
scored against parser output by event type. A disagreement requires a separate
documented adjudication. The current 30-document intake contains ten
`attachmentReadIncomplete` records; even after two reviews it must remain
`SOURCE_PARTIAL_HOLDOUT_BLOCKED` until complete official documents are
obtained and a new frozen intake is prepared. Preserve `PARTIAL` for inaccessible attachments and
report availability failures separately from extraction errors. The short
source-publication window never proves 365-day market completeness.

### Future operator-only production repair plan — not activated here

Even after every review is resolved, no script in this branch applies the
manifest to Aiven. An operator must separately authorize the exact snapshot,
decisions, maintenance window and write procedure. Before a future repair:

1. Take and verify a recoverable Aiven backup, with restore instructions and
   a test restore in an isolated database. Record the production revision and
   pause competing GPW sync jobs only for the approved maintenance window.
2. Re-read affected rows under a consistent transaction and compare every
   event, source, history and projection-change precondition to the approved
   fingerprint. Any new source, changed row, missing event, duplicate identity
   or unresolved review means **abort**, regenerate the manifest and repeat
   human review. Never force a stale snapshot through.
3. If a separate apply tool is later approved, use one bounded `SERIALIZABLE`
   transaction with row locks/advisory coordination, official source-priority
   checks, stable IDs and provenance records. Recheck uniqueness and API/ICS
   results before commit. Do not delete old events or rewrite unrelated rows.
4. Retain before/after row images and a targeted inverse plan. If validation
   fails before commit, roll back the transaction. If a later defect is found,
   use the verified backup or reviewed inverse plan after checking for newer
   source updates; a blind restore could erase legitimate subsequent data.
5. Re-enable sync only after verification and observation. A full-calendar
   quality claim still requires independent holdout and broad source coverage.

## Prepared post-deployment check — not activated

The repository also contains a read-only public-calendar audit script.  It is
for a human-approved future release check only.  Before enabling a schedule,
review its source range, rate limits, timeout behavior, and result retention.
It must report anomalies; it must not automatically rewrite parser code,
projected events, cache rows, or source cursors.

## Interpretation and escalation

- `PARSER_ERROR` with `CONFIRMED` evidence: reproduce on an official source
  excerpt, fix a general semantic rule, and add a regression case.
- `REQUIRES_REVIEW`: preserve the source evidence; do not alter a calendar
  event automatically.
- `SYNCHRONIZATION_ERROR`, `REPROJECTION_ERROR`, or cache findings: diagnose
  using a read-only export first.  A production repair needs a separately
  approved operational change.
- Missing/partial sources: retain the last verified event and schedule a
  bounded retry; do not invent a date from prior publication patterns.
