# GPW quality-audit runbook

This runbook describes read-only quality controls for the GPW calendar.  None
of the commands below synchronizes a live source, writes a production event,
starts a timer, or runs a reprojection.

## Deterministic gate

Run these commands from `portfel-inwestora` after changing parser, projection,
API or ICS code:

```powershell
npm run gpw:audit
npm run gpw:anomalies
npm run gpw:benchmark
npm run gpw:mutation
npm run gpw:e2e
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
