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
