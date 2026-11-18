// Offline replay of the report-schedule reprojection over a snapshot of the stored calendar. Nothing is written
// anywhere: it reads two JSON files, runs the current parser, publication policy and retirement planner exactly as
// synchronizeGlobalReportSchedules would, and reports what would change.
//
//   node --experimental-strip-types --import ./tests/register-alias-loader.mjs scripts/simulate-gpw-report-reprojection.mjs \
//     --reports reports.json --events events.json [--today 2026-11-18] [--out report.json]
//
// reports.json: [{ id, source_id, source_url, published_at, source_title, title, body_text, issuer_name, market }]
// events.json:  [{ id, ticker, event_type, event_date, event_identity, status, active, sources: [url] }]
//
// The end state is an approximation of the database after the sync (one row per issuer/type/identity, later
// documents override earlier ones); it is meant to count classes of change and to check the invariants of the
// repair, not to replace a replay against PostgreSQL.
import { readFileSync, writeFileSync } from "node:fs";
import { getCorporateEventIdentityKey, getReportScheduleNonPublicationDates, parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { assessReportPublicationBatch } from "../src/lib/report-schedule-publication.ts";
import { planPeriodEndRetirements, planReportScheduleReprojection, planSharedRowRetirements } from "../src/lib/report-schedule-reprojection.ts";

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const reports = JSON.parse(readFileSync(arg("--reports"), "utf8"));
const events = JSON.parse(readFileSync(arg("--events"), "utf8"));
const today = arg("--today", new Date().toISOString().slice(0, 10));
const REPORT_TYPES = new Set(["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT"]);

// One stable key per official document: the GPW komunikat id when the URL has one, else the URL itself.
const sourceKey = (url) => String(url ?? "").match(/geru_id=(\d+)/)?.[1] ?? String(url ?? "");
const incomplete = (identity) => { const [, period, year] = identity.split(":"); return !period || !year; };

const stored = events.filter((event) => event.active && REPORT_TYPES.has(event.event_type))
  .map((event) => ({ ...event, sourceKeys: (event.sources ?? []).map(sourceKey) }));
const tickerBySource = new Map();
for (const event of stored) for (const key of event.sourceKeys) if (!tickerBySource.has(key)) tickerBySource.set(key, event.ticker);
// A document without stored rows (never projected, or NO_EVENT) still belongs to its issuer's instrument.
const tickerByIssuer = new Map();
for (const report of reports) {
  const ticker = tickerBySource.get(sourceKey(report.source_url));
  if (ticker && report.issuer_id) tickerByIssuer.set(report.issuer_id, ticker);
}

const invariants = (rows) => {
  const byDate = new Map();
  const byIdentity = new Map();
  for (const row of rows) {
    const a = `${row.ticker}|${row.event_type}|${row.event_date}`;
    byDate.set(a, new Set([...(byDate.get(a) ?? []), row.event_identity]));
    const b = `${row.ticker}|${row.event_identity}`;
    byIdentity.set(b, new Set([...(byIdentity.get(b) ?? []), row.event_date]));
  }
  return {
    activeRows: rows.length,
    incompleteIdentity: rows.filter((row) => incomplete(row.event_identity)).length,
    incompleteIdentityNotMarkedUnverified: rows.filter((row) => incomplete(row.event_identity) && row.status !== "UNKNOWN").length,
    futureIncompleteIdentity: rows.filter((row) => incomplete(row.event_identity) && row.event_date >= today).length,
    sameTypeAndDateWithDifferentIdentities: [...byDate.values()].filter((identities) => identities.size > 1).length,
    oneIdentityOnSeveralDates: [...byIdentity.values()].filter((dates) => dates.size > 1).length,
  };
};

const reportByKey = new Map(reports.map((report) => [sourceKey(report.source_url), report]));
const readCache = new Map();
// What another stored document yields today (body text only; a document that may carry PDFs is not judged).
const readOther = (key) => {
  if (readCache.has(key)) return readCache.get(key);
  const other = reportByKey.get(key);
  let reading;
  if (other) {
    try {
      const found = parseCorporateEventDocument(`${other.source_title}
${other.title}
${other.body_text}`).filter((event) => REPORT_TYPES.has(event.eventType));
      reading = { published: assessReportPublicationBatch(found, { sourcePublishedAt: other.published_at }).filter((d) => d.publish).map((d) => d.event) };
    } catch { reading = undefined; }
  }
  readCache.set(key, reading);
  return reading;
};

const before = invariants(stored);
const state = new Map(stored.map((row) => [row.id, { ...row }]));
const counts = { reports: 0, retired: {}, created: 0, moved: 0, ambiguous: 0, held: 0, yearWithdrawn: 0, conflicts: 0, parseErrors: 0 };
const detail = { ambiguousFuture: [], retired: [], yearWithdrawn: [], created: [], moved: [] };

for (const report of [...reports].sort((left, right) => String(left.published_at).localeCompare(String(right.published_at)))) {
  counts.reports += 1;
  const key = sourceKey(report.source_url);
  const text = `${report.source_title}\n${report.title}\n${report.body_text}`;
  let parsed;
  try { parsed = parseCorporateEventDocument(text).filter((event) => REPORT_TYPES.has(event.eventType)); }
  catch { counts.parseErrors += 1; continue; }
  const decisions = assessReportPublicationBatch(parsed, { sourcePublishedAt: report.published_at });
  const published = decisions.filter((decision) => decision.publish).map((decision) => decision.event);
  const held = decisions.filter((decision) => !decision.publish).map((decision) => decision.event);
  const ticker = tickerBySource.get(key) ?? tickerByIssuer.get(report.issuer_id) ?? report.issuer_name;
  const own = [...state.values()].filter((row) => row.sourceKeys.includes(key));
  const plan = planReportScheduleReprojection(
    own.map((row) => ({ id: row.id, event_type: row.event_type, event_identity: row.event_identity,
      event_date: row.event_date, source_urls: row.sourceKeys })),
    published, key, true,
    { held, nonPublicationDates: getReportScheduleNonPublicationDates(text) }
  );
  // Rows kept only because other sources are linked to them (the same notice stored via gpw.pl and PAP).
  const shared = own.filter((row) => plan.ambiguousIds.includes(row.id) && row.sourceKeys.length > 1)
    .map((row) => ({ id: row.id, event_type: row.event_type, event_identity: row.event_identity, event_date: row.event_date, source_urls: row.sourceKeys }));
  const readings = new Map(shared.flatMap((row) => row.source_urls).filter((other) => other !== key).map((other) => [other, readOther(other)]));
  for (const id of planSharedRowRetirements(shared, key, published, readings)) {
    plan.ambiguousIds.splice(plan.ambiguousIds.indexOf(id), 1);
    plan.deactivateIds.push(id);
    plan.retirementReasons[id] = "ALL_SOURCES_REPUBLISH_UNDER_OTHER_IDENTITY";
  }
  counts.held += plan.heldIds.length;
  counts.ambiguous += plan.ambiguousIds.length;
  for (const id of plan.ambiguousIds) {
    const row = state.get(id);
    if (row && row.event_date >= today) detail.ambiguousFuture.push(`${row.ticker} ${row.event_type} ${row.event_identity} ${row.event_date} (${key})`);
  }
  for (const id of plan.deactivateIds) {
    const row = state.get(id);
    const reason = plan.retirementReasons[id];
    counts.retired[reason] = (counts.retired[reason] ?? 0) + 1;
    detail.retired.push(`${row.ticker} ${row.event_type} ${row.event_identity} ${row.event_date} <- ${reason} (${key})`);
  }
  for (const id of plan.deactivateIds) state.delete(id);
  // Rows of any provenance that are exactly the closing day of the period they name.
  const nonPublication = getReportScheduleNonPublicationDates(text);
  const periodEndIds = planPeriodEndRetirements(
    [...state.values()].filter((row) => row.ticker === ticker)
      .map((row) => ({ id: row.id, event_type: row.event_type, event_identity: row.event_identity, event_date: row.event_date, source_urls: row.sourceKeys })),
    nonPublication, published);
  for (const id of periodEndIds) {
    const row = state.get(id);
    counts.retired.PERIOD_END_OF_NAMED_PERIOD = (counts.retired.PERIOD_END_OF_NAMED_PERIOD ?? 0) + 1;
    detail.retired.push(`${row.ticker} ${row.event_type} ${row.event_identity} ${row.event_date} <- PERIOD_END_OF_NAMED_PERIOD (${key})`);
    state.delete(id);
  }
  // Apply the published events: update the row of the same identity, relabel a same-day row of this very
  // document with an incomplete identity, or create a new row.
  for (const event of published) {
    const identity = getCorporateEventIdentityKey(event);
    const sameIdentity = [...state.values()].find((row) => row.ticker === ticker && row.event_type === event.eventType && row.event_identity === identity);
    const decision = decisions.find((candidate) => candidate.event === event);
    if (decision?.yearWithdrawn) {
      counts.yearWithdrawn += 1;
      detail.yearWithdrawn.push(`${ticker} ${event.eventType} ${identity} ${event.eventDate} (${key})`);
    }
    if (sameIdentity) {
      if (sameIdentity.event_date !== event.eventDate) {
        if (sameIdentity.sourceKeys.includes(key) || event.isScheduleChange) {
          counts.moved += 1;
          detail.moved.push(`${ticker} ${identity} ${sameIdentity.event_date} -> ${event.eventDate} (${key})`);
          sameIdentity.event_date = event.eventDate;
        } else counts.conflicts += 1;
      }
      if (!sameIdentity.sourceKeys.includes(key)) sameIdentity.sourceKeys.push(key);
      continue;
    }
    const sameDay = [...state.values()].filter((row) => row.ticker === ticker && row.event_type === event.eventType && row.event_date === event.eventDate);
    const enrichable = sameDay.length === 1 && sameDay[0].sourceKeys.length === 1 && sameDay[0].sourceKeys[0] === key &&
      (incomplete(sameDay[0].event_identity) || !decision?.yearWithdrawn && !incomplete(identity));
    if (enrichable) { sameDay[0].event_identity = identity; counts.created += 0; continue; }
    if (decision?.yearWithdrawn && sameDay.length > 0) continue; // the calendar already holds that report on that day
    const id = `new:${key}:${identity}:${event.eventDate}`;
    state.set(id, { id, ticker, event_type: event.eventType, event_date: event.eventDate, event_identity: identity,
      status: decision?.yearWithdrawn ? "UNKNOWN" : "CONFIRMED", active: true, sourceKeys: [key], created: true });
    counts.created += 1;
    detail.created.push(`${ticker} ${identity} ${event.eventDate} (${key})`);
  }
}

const after = invariants([...state.values()]);
const remaining = [...state.values()];
detail.remainingIncomplete = remaining.filter((row) => incomplete(row.event_identity))
  .map((row) => `${row.ticker} ${row.event_type.replace("_REPORT", "")} ${row.event_identity.split(":").slice(1).join(":") || "(none)"} ${row.event_date} ${row.status ?? ""} [${row.sourceKeys.join(",")}]`);
const groups = new Map();
for (const row of remaining) groups.set(`${row.ticker}|${row.event_type}|${row.event_date}`, [...(groups.get(`${row.ticker}|${row.event_type}|${row.event_date}`) ?? []), row]);
detail.remainingSameDayDifferentIdentity = [...groups.values()].filter((rows) => new Set(rows.map((row) => row.event_identity)).size > 1)
  .map((rows) => rows.map((row) => `${row.ticker} ${row.event_type.replace("_REPORT", "")} ${row.event_date} ${row.event_identity.split(":").slice(1).join(":") || "(none)"} [${row.sourceKeys.join(",")}]`).join("  vs  "));
const named = ["LPP", "PKN", "GTN", "IDM", "OTS", "CTX", "SVE", "ENT", "PHR", "ERG", "GRX", "ALG"];
const spotlight = Object.fromEntries(named.map((ticker) => [ticker,
  [...state.values()].filter((row) => row.ticker === ticker && row.event_date >= "2026-09-01")
    .sort((left, right) => left.event_date.localeCompare(right.event_date))
    .map((row) => `${row.event_date} ${row.event_type.replace("_REPORT", "")} ${row.event_identity.split(":").slice(1).join(":") || "(no period/year)"}${row.status === "UNKNOWN" ? " [do weryfikacji]" : ""}`)]));
const result = { today, before, after, counts, spotlight, detail };
if (arg("--out")) writeFileSync(arg("--out"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ today, before, after, counts, spotlight }, null, 2));
