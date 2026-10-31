# GPW independent source audit and publication policy (29 October 2026)

This is a machine audit, **not an approval or a production repair**. The scoped
32 mutations and ten NO_CHANGE controls, the excluded `gpw:499257`, reviewer
fields, and the global NO-GO gate remain unchanged. The snapshot is historical;
the audit makes no assertion that its rows still equal current Aiven rows.

## Run and result

Run `npm run gpw:audit:independent` with the existing local, ignored
`artifacts/gpw-quality/scoped-repair-proposal.json` and
`reprojection-snapshot.json`. The command reads no database and writes the
requested ignored `automated-source-audit.json` and `.md`. It fetches each
official GPW communication once per live run and saves the extracted, public
report text to an ignored local `automated-source-cache.json`. `--offline`
rechecks that cache without network; a partial or missing checkpoint is marked
SOURCE_UNAVAILABLE. The deterministic CI tests do not access GPW.

The 29 official GPW communications read on 29 October comprise the 24 primary
messages and five older cross-check messages in the proposal. All were fetched;
for the 32 proposed modifications the independent lane returned:

| Machine result | Count |
| --- | ---: |
| AUTO_EVIDENCE_MATCH | 13 |
| CONFLICT | 0 |
| NEEDS_REVIEW | 19 |
| SOURCE_UNAVAILABLE | 0 |

The ten NO_CHANGE records are reported separately. A source-specific conflict
on an old superseded schedule does not by itself overturn a newer source.
Machine matches do not fill reviewer signatures or release the scoped executor.

## Source interpretation and unresolved cases

The independent lane extracts only the official report body, issuer ISIN,
report number and publication timestamp from the GPW page. It classifies each
date mention by nearby wording, compares period/type/fiscal year and the
linked active keeper, and conservatively refuses ambiguous changes. This lane
does not call the production calendar parser. It records bounded excerpts,
not whole copied pages.

* AB S.A. `gpw:475396` and `gpw:499171`: 6 June 2025 appears in a
  Minister of Finance regulation citation, not as a report appointment.
  Both proposed deactivations remain NEEDS_REVIEW because the absence of an
  appointment in these two schedules cannot prove no other report existed.
* DELKO `gpw:493765`: 30 June 2027 marks the fiscal-year boundary. The
  corresponding deactivation remains NEEDS_REVIEW until all provenance and
  alternative publication evidence are checked. The corrected current parser
  extracts the four actual dates and no Q2 appointment from the source text.
* IDM `gpw:480817`: the official correction distinguishes Q3 2026 from the
  earlier Q3 2025 label; the source comparison matches the proposal.
* Getin Holding `gpw:499304`: the official communication replaces 30 November
  2026 with 28 October 2026 for the same Q3 report. The proposed same-ID date
  update matches the source.
* XTPL `gpw:499072` and Instal Kraków `gpw:499122`: the announcement refers to
  a report already projected on its actual date, while preliminary results are
  not a new periodic-report appointment. Both link-only proposals match.

Other NEEDS_REVIEW results are listed with precise reasons and source snippets
in the generated artifacts. They are **not** silently converted to approvals.

## Root cause and forward protection

The historical bad rows were produced at the source-document-to-projection
boundary: earlier parsing could promote context dates (legal citations,
fiscal boundaries, preliminary results) or incomplete fiscal identities into
events, and duplicate projections could survive a later correction. The
current parser already contained clause-based date-role and fiscal-year rules
plus stable-ID reprojection. Re-running it alone would not independently prove
the 32 historical repairs, which is why the source lane above is separate.

The source replay exposed two further general defects. A numbered report row
with a dotted date could be joined to the following paragraph, causing its
appointment to disappear. Also, non-calendar fiscal years expressed as
`trwający od <date> do <date>` were not bound to the individual report rows;
the closing boundary could itself become an uncertain Q2 event. The parser
now recognizes dotted appointments before joining lines, derives a fiscal
label only from a unique containing explicit range (or the FY row's own
bounds), and rejects a trailing `do <date>` as a publication appointment.
The DELKO regression test includes the annual, Q1, H1 and Q3 publications
plus a negative Q2 clause. No issuer-specific override was introduced.

The new publication policy sits between parsing and persistence. It withholds
new report candidates marked for review, lacking explicit fiscal period/year,
carrying an invalid calendar date, or giving conflicting dates for one report
identity within a batch. A different source cannot silently replace an active
report date without an explicit schedule change; that conflict is recorded as
REVIEW_REQUIRED. An incomplete attachment remains PARSE_ERROR and retryable.
Review reasons are stored on the source report, while existing confirmed
events and WZA/dividends are left untouched. The projection version is
deliberately unchanged: this code must not force a replay of the 32 disputed
historical rows without the existing approval process. New or genuinely
changed sources use the gate; the established safe reprojection rules retain
stable IDs where applicable.

This forward policy does not deactivate historical rows or decide their
corrections. Production repair still requires a fresh snapshot, backup and
restore rehearsal, stopped sync, independent decisions, operator authorization
and the existing executor's checks.
