import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractOfficialGpwReport, inspectSourceDates, compareOfficialSource } from "../scripts/gpw-independent-source-check.mjs";

const source = (body, isin = "PLGSPR000014") => ({ isin, body });
const action = (beforeDate, afterDate = beforeDate) => ({
  decision: "UPDATE", eventId: "event-1", eventType: "QUARTERLY_REPORT",
  issuerIsin: "PLGSPR000014", before: { eventDate: beforeDate },
  after: { eventDate: afterDate, identity: "QUARTERLY_REPORT:Q3:2026" },
});

test("independent lane extracts the official report body and issuer, not page furniture", () => {
  const html = `<h2>Raporty Spółek ESPI/EBI</h2><div>Raport bieżący nr 12/2026</div>
    <div>GETIN HOLDING S.A. PLGSPR000014 23-10-2026 11:10:36 |</div>
    <h4>Treść raportu:</h4><div>Raport za III kwartał 2026 r. - 28.10.2026</div>
    <h4>Nazwa arkusza: Załączniki</h4><div>999</div>`;
  const result = extractOfficialGpwReport(html);
  assert.equal(result.isin, "PLGSPR000014");
  assert.equal(result.reportNumber, "12/2026");
  assert.match(result.body, /28\.10\.2026/u);
  assert.doesNotMatch(result.body, /Załączniki/u);
});

test("formal date correction requires explicit old and new publication dates", () => {
  const body = "Spółka zmienia termin publikacji raportu za III kwartał 2026 r. z 30.11.2026 na 28.10.2026. Poprzedni termin 30.11.2026; raport zostanie opublikowany w dniu 28.10.2026.";
  const result = compareOfficialSource(action("2026-11-30", "2026-10-28"), source(body));
  assert.equal(result.status, "AUTO_EVIDENCE_MATCH");
  assert.equal(compareOfficialSource(action("2026-11-29", "2026-10-28"), source(body)).status, "NEEDS_REVIEW");
});

test("a legal citation or fiscal year-end never certifies a report appointment", () => {
  // Bounded official excerpts: GPW AB 475396/499171 and DELKO 493765.
  const legal = "zgodnie z § 63 ust. 1 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 roku w sprawie informacji bieżących i okresowych";
  const fiscal = "DELKO SA informuje o zamiarze przekazywania w roku obrotowym trwającym od 01.07.2026 do 30.06.2027 skonsolidowanych raportów kwartalnych";
  assert.equal(inspectSourceDates(legal)[0].role, "LEGAL_ACT");
  assert.equal(inspectSourceDates(fiscal).find((item) => item.date === "2027-06-30")?.role, "FISCAL_PERIOD_END");
  assert.notEqual(compareOfficialSource(action("2025-06-06"), source(legal)).status, "AUTO_EVIDENCE_MATCH");
  assert.notEqual(compareOfficialSource(action("2027-06-30"), source(fiscal)).status, "AUTO_EVIDENCE_MATCH");
});

test("missing or mismatched official issuer evidence cannot pass", () => {
  const a = action("2026-10-28");
  assert.equal(compareOfficialSource(a, null).status, "SOURCE_UNAVAILABLE");
  assert.equal(compareOfficialSource(a, source("Raport za III kwartał 2026 r. - 28.10.2026", "PLDELKO00019")).status, "CONFLICT");
});

test("IDM old Q3 2025 notice cannot certify the corrected Q3 2026 keeper", () => {
  const keeper = { eventId: "corrected", issuerId: "issuer-id", eventType: "QUARTERLY_REPORT",
    after: { active: true, eventDate: "2026-11-18", identity: "QUARTERLY_REPORT:Q3:2026" } };
  const duplicate = { ...action("2026-11-18"), decision: "DEACTIVATE", issuerId: "issuer-id",
    after: { active: false, eventDate: "2026-11-18", identity: "QUARTERLY_REPORT:Q3:2025" } };
  const original = source("4_ raport kwartalny za III kwartał 2025 r. - 18-11-2026 r.");
  const correction = source("4_ raport kwartalny za III kwartał 2026 r. - 18-11-2026 r.");
  assert.equal(compareOfficialSource(duplicate, original, [keeper]).status, "NEEDS_REVIEW");
  assert.equal(compareOfficialSource(duplicate, correction, [keeper]).status, "AUTO_EVIDENCE_MATCH");
});

test("abbreviated quarter and short fiscal-year labels need their own source clause", () => {
  const q3 = action("2026-11-05");
  assert.equal(compareOfficialSource(q3, source("- za III kw. 2026 roku - 5 listopada 2026 r.")).status,
    "AUTO_EVIDENCE_MATCH");
  const h1 = { ...q3, eventType: "HALF_YEAR_REPORT",
    before: { eventDate: "2026-12-10" },
    after: { eventDate: "2026-12-10", identity: "HALF_YEAR_REPORT:H1:2026/2027" } };
  assert.equal(compareOfficialSource(h1, source("Skonsolidowany raport za I półrocze roku obrotowego 2026/27 - publikacja dnia 10 grudnia 2026 r.")).status,
    "AUTO_EVIDENCE_MATCH");
  assert.equal(compareOfficialSource(q3, source("Raport za III kwartał 2025 r. - 5 listopada 2026 r.")).status,
    "NEEDS_REVIEW");
});

test("a report row using 'w dniu' remains an explicit appointment", () => {
  const result = compareOfficialSource(action("2026-11-24"), source(
    "skonsolidowany raport kwartalny za III kwartał 2026 r. - w dniu 24.11.2026 r."));
  assert.equal(result.status, "AUTO_EVIDENCE_MATCH");
});

test("all 32 proposed mutations and ten unchanged controls remain in the committed matrix", () => {
  const matrix = readFileSync(new URL("../docs/gpw-scoped-repair-matrix-2026-10-28.md", import.meta.url), "utf8");
  const rows = matrix.split(/\r?\n/u).filter((line) => /^\| (?:UPDATE|DEACTIVATE|LINK_SOURCE|NO_CHANGE) \|/u.test(line));
  assert.equal(rows.length, 42);
  assert.equal(rows.filter((line) => line.startsWith("| NO_CHANGE |")).length, 10);
  assert.equal(rows.filter((line) => !line.startsWith("| NO_CHANGE |")).length, 32);
  assert.ok(!rows.some((line) => line.includes("gpw:499257")));
});
