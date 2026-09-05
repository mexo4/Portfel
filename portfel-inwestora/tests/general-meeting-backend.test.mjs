import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { shouldApplyEvent } from "../src/lib/server/corporate-events.ts";

const source = (publishedAt) => ({
  sourceType: "PAP_ESPI",
  sourceUrl: `https://pap.example/${publishedAt}`,
  sourcePublishedAt: publishedAt,
});

const meeting = (overrides = {}) => ({
  eventType: "GENERAL_MEETING",
  eventDate: "2026-10-30",
  isScheduleChange: false,
  generalMeetingType: "NWZ",
  isCancellation: false,
  eventIdentity: "general-meeting:NWZ:2026-10-30",
  ...overrides,
});

const stored = (overrides = {}) => ({
  id: "event-1",
  event_date: "2026-10-30",
  event_identity: "general-meeting:NWZ:2026-10-15",
  status: "CHANGED",
  active: true,
  general_meeting_type: "NWZ",
  source_published_at: "2026-09-10T10:00:00.000Z",
  source_priority: 400,
  source_type: "PAP_ESPI",
  updated_at: "2026-09-10T10:00:00.000Z",
  ...overrides,
});

test("a newer official cancellation wins, while an older one cannot override newer state", () => {
  const cancellation = meeting({ isCancellation: true, generalMeetingAction: "CANCELLATION" });
  assert.equal(
    shouldApplyEvent(stored(), source("2026-09-12T10:00:00.000Z"), cancellation),
    true
  );
  assert.equal(
    shouldApplyEvent(stored(), source("2026-09-08T10:00:00.000Z"), cancellation),
    false
  );
});

test("a stale convening cannot resurrect a cancelled meeting, but a later formal notice may", () => {
  const cancelled = stored({
    status: "CANCELLED",
    active: false,
    source_published_at: "2026-09-12T10:00:00.000Z",
    source_priority: 500,
  });
  assert.equal(
    shouldApplyEvent(cancelled, source("2026-09-11T10:00:00.000Z"), meeting()),
    false
  );
  assert.equal(
    shouldApplyEvent(cancelled, source("2026-09-13T10:00:00.000Z"), meeting()),
    true
  );
});

test("WZA reuses central ESPI synchronization and preserves each report source", async () => {
  const provider = await readFile(
    new URL("../src/lib/server/corporate-events.ts", import.meta.url),
    "utf8"
  );
  const start = provider.indexOf("export class StoredPapEspiGeneralMeetingProvider");
  const end = provider.indexOf("const defaultProviders", start);
  const implementation = provider.slice(start, end);

  assert.ok(start >= 0);
  assert.match(provider, /synchronizePapEspi\(\)/);
  assert.match(implementation, /getStoredEspiReportsForCorporateEvents/);
  assert.match(implementation, /sourceUrl: report\.sourceUrl/);
  assert.match(implementation, /batches/);
  assert.doesNotMatch(implementation, /fetchWithSystemTrust|fetchPapDocument/);
});

test("a newly added WZA provider bootstraps even when the aggregate instrument check is fresh", async () => {
  const provider = await readFile(
    new URL("../src/lib/server/corporate-events.ts", import.meta.url),
    "utf8"
  );

  assert.match(provider, /getGeneralMeetingBootstrapInstrumentIds/);
  assert.match(provider, /source_type = 'PAP_ESPI'/);
  assert.match(provider, /source_url = \$2/);
  assert.match(provider, /!generalMeetingBootstrapIds\.has\(instrument\.id\)/);
  assert.match(provider, /awaitedRefreshIds\.has\(instrument\.id\)/);
  assert.match(provider, /await Promise\.all\(awaitedRefreshes\)/);
});

test("WZA persistence keeps identity/history, meeting fields and cancelled inactive state", async () => {
  const [provider, db] = await Promise.all([
    readFile(new URL("../src/lib/server/corporate-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/db.ts", import.meta.url), "utf8"),
  ]);

  assert.match(provider, /event_date = ANY\(\$2::text\[\]\)/);
  assert.match(provider, /\[parsed\.previousEventDate, parsed\.eventDate\]/);
  assert.match(provider, /existing\.event_identity \|\| eventIdentity/);
  assert.match(provider, /general_meeting_type = COALESCE/);
  assert.match(provider, /registration_date = COALESCE/);
  assert.match(provider, /active = \$17/);
  assert.match(provider, /INSERT INTO corporate_event_history/);
  assert.match(provider, /if \(isCancellation\) return 500/);
  assert.match(provider, /parsed\.isCancellation\s*\? "CANCELLED"/);
  assert.match(provider, /isParsedEventActive\(parsed\)/);
  assert.match(db, /general_meeting_type TEXT/);
  assert.match(db, /registration_date TEXT/);
});

test("source failures update checks without deleting last valid corporate events", async () => {
  const provider = await readFile(
    new URL("../src/lib/server/corporate-events.ts", import.meta.url),
    "utf8"
  );
  const refreshStart = provider.indexOf("const refreshCanonicalInstrument");
  const refreshEnd = provider.indexOf("const toCorporateEvent", refreshStart);
  const refresh = provider.slice(refreshStart, refreshEnd);

  assert.match(refresh, /const successful = results\.filter/);
  assert.match(refresh, /for \(const result of successful\)/);
  assert.doesNotMatch(refresh, /DELETE FROM corporate_events/);
  assert.doesNotMatch(refresh, /SET active = FALSE/);
});
