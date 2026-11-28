// Advances on the dividend and other notices the calendar missed in November 2026. The texts are
// shortened public ESPI notices, line-wrapped as GPW publishes them.
import assert from "node:assert/strict";
import test from "node:test";

const { parseCorporateEventDocument } = await import("../src/lib/corporate-events.ts");
const { planDividendSourceReprojection, isSameDividendDistribution } = await import("../src/lib/dividend-reprojection.ts");

const dividends = (text) => parseCorporateEventDocument(text).filter((event) => event.eventType === "UPCOMING_DIVIDEND");
const summary = (event) => [event.eventIdentity, event.recordDate, event.paymentDate, event.dividendPerShare ?? null, event.dividendStatus];

const VOTUM_SECOND_ADVANCE = `Decyzja Zarządu Votum S.A. o zamiarze wypłaty drugiej zaliczki na poczet dywidendy
za 2026 r.
Zarząd Spółki Votum S.A. informuje, że w dniu dzisiejszym podjął uchwałę o przedłożeniu Radzie Nadzorczej
wniosku dotyczącego wypłaty akcjonariuszom drugiej zaliczki na poczet dywidendy za 2026 rok w kwocie 18 000 000,00
zł, co oznacza, że na jedną akcję będzie przypadać kwota 1,50 zł.
Spółka rekomenduje dzień 16 grudnia 2026 r. jako dzień, według którego ustalać się
będzie uprawnionych do zaliczki na poczet dywidendy za rok 2026, a jako termin wypłaty
zaliczki na poczet dywidendy - dzień 23 grudnia 2026 r.
Warunkiem wypłaty zaliczki jest uzyskanie zgody Rady Nadzorczej spółki w terminie
do dnia wypłaty zaliczki.`;

const textAdvance = (opening) => `Wniosek Zarządu w sprawie wypłaty zaliczki na poczet przewidywanej dywidendy z zysku
za 2026/27 rok finansowy
${opening} wypłaty zaliczki na poczet dywidendy:
- zaliczką będzie objęte 25.750.000 akcji Spółki
- kwota zaliczki, przypadająca na 1 akcję Spółki, wyniesie: 1,21 zł
- planowany dzień ustalenia akcjonariuszy uprawnionych do zaliczki: 28 grudnia 2026
r.
- planowany dzień wypłaty zaliczki: 4 stycznia 2027 r.`;
const TEXT_REQUEST = textAdvance(`Zarząd Text S.A. informuje, że w dniu 25 listopada 2026 r. podjął decyzję
o zwróceniu się do Rady Nadzorczej z wnioskiem w sprawie wyrażenia zgody na wypłatę
zaliczki na poczet przewidywanej dywidendy za rok obrotowy 2026/27, przy uwzględnieniu parametrów ustalenia i`);
const TEXT_RESOLUTION = textAdvance(`W nawiązaniu do raportu bieżącego 17/2026, Zarząd Text S.A. informuje,
że w dniu 27 listopada 2026 r., po otrzymaniu zgody od Rady Nadzorczej Spółki, podjął
uchwałę o wypłacie zaliczki na poczet przewidywanej dywidendy za rok obrotowy 2026/27,
przy uwzględnieniu parametrów ustalenia i`);

test("an advance is named by its dividend day, so a second advance of the year is a distribution of its own", () => {
  assert.deepEqual(dividends(VOTUM_SECOND_ADVANCE).map(summary),
    [["dividend:2026:advance:2026-12-16", "2026-12-16", "2026-12-23", 1.5, "PROPOSED"]]);
});

test("the board's request and the later resolution are the same advance, first proposed, then confirmed", () => {
  // „podjął\nuchwałę” is a resolution although the line breaks inside it.
  assert.deepEqual(dividends(TEXT_REQUEST).map(summary),
    [["dividend:2026:advance:2026-12-28", "2026-12-28", "2027-01-04", 1.21, "PROPOSED"]]);
  assert.deepEqual(dividends(TEXT_RESOLUTION).map(summary),
    [["dividend:2026:advance:2026-12-28", "2026-12-28", "2027-01-04", 1.21, "CONFIRMED"]]);
});

test("a conditional advance written with its own day names is read (Echo Investment)", () => {
  const notice = `Uchwała w sprawie warunkowej wypłaty zaliczki na poczet przyszłej dywidendy za rok
obrotowy 2026
Zarząd spółki Echo Investment S.A. postanowił warunkowo wypłacić akcjonariuszom Spółki zaliczkę na poczet przyszłej dywidendy
za rok obrotowy 2026 na następujących zasadach:
Łączna kwota przeznaczona na wypłatę Zaliczki Dywidendowej wyniesie 165.076.232,80
PLN tj. 0,40 PLN na 1 akcję.
Zaliczka Dywidendowa zostanie wypłacona w dniu 16 grudnia 2026 r. _Data Wypłaty Zaliczki
Dywidendowej_.
Do Zaliczki Dywidendowej będą uprawnieni akcjonariusze posiadający akcje Spółki w
dniu 9 grudnia 2026 r. tj. na 7 dni przed Datą Wypłaty Zaliczki Dywidendowej.
Zaliczka Dywidendowa zostanie wypłacona pod warunkiem uzyskania zgody Rady Nadzorczej
w terminie do Daty Wypłaty Zaliczki Dywidendowej.`;
  assert.deepEqual(dividends(notice).map(summary),
    [["dividend:2026:advance:2026-12-09", "2026-12-09", "2026-12-16", 0.4, "PROPOSED"]]);
});

test("a recommendation with both days but only a total amount is a proposed dividend (Atlanta Poland)", () => {
  const notice = `Deklaracja w sprawie wypłaty dywidendy z zysku netto za rok obrotowy 2025/2026.
ATLANTA POLAND SA informuje, iż w dniu 17 listopada 2026 Zarząd Spółki podjął uchwałę w przedmiocie przedstawienia
Radzie Nadzorczej Spółki wniosku dotyczącego sposobu rozporządzenia zyskiem netto, poprzez: a_ przeznaczenie
kwoty 5 178 118,40 zł na wypłatę dywidendy dla akcjonariuszy. Ponadto Zarząd rekomendował,
aby dzień dywidendy został ustalony na dzień 5 marca 2027 roku, natomiast termin wypłaty
dywidendy na dzień 2 kwietnia 2027 roku.`;
  assert.deepEqual(dividends(notice).map(summary),
    [["dividend:2026:single", "2027-03-05", "2027-04-02", null, "PROPOSED"]]);
  // Without both days nothing is published: a date alone could be any date of the notice.
  assert.deepEqual(dividends(notice.replace(", natomiast termin wypłaty\ndywidendy na dzień 2 kwietnia 2027 roku", "")), []);
});

test("an advance a subsidiary pays its own shareholders stays out (Stalexport Autostrada Małopolska)", () => {
  const notice = `Zarząd Stalexport Autostrady S.A. _dalej: Emitent_ informuje, że Zarząd Stalexport Autostrada
Małopolska S.A. _spółki zależnej Emitenta_ podjął uchwałę w sprawie wypłaty akcjonariuszom Stalexport Autostrada
Małopolska S.A. zaliczki na poczet przewidywanej dywidendy:
a_ wypłata zaliczki nastąpi w terminie od dnia 30.11.2026 r. do dnia 31.12.2026 r.;`;
  assert.deepEqual(dividends(notice), []);
});

test("a final dividend that deducts a paid advance is not taken for an advance", () => {
  const notice = `Zwyczajne Walne Zgromadzenie Spółki podjęło uchwałę w sprawie podziału zysku za rok 2025:
dywidenda wynosi 5,00 zł na jedną akcję, pomniejszona o wypłaconą zaliczkę na poczet dywidendy w kwocie 2,00 zł na jedną akcję,
do wypłaty pozostaje 3,00 zł na jedną akcję. Dzień dywidendy 10 czerwca 2026 r., termin wypłaty dywidendy 20 czerwca 2026 r.`;
  const events = dividends(notice);
  assert.ok(events.length > 0);
  for (const event of events) assert.match(event.eventIdentity, /^dividend:2025:(?:single|\d)$/);
});

const stored = (id, identity, record, payment, sources) => ({
  id, event_identity: identity, event_date: record, record_date: record, payment_date: payment,
  dividend_installment: null, dividend_per_share: 1, status: "CONFIRMED", source_published_at: "2026-10-01T10:00:00.000Z",
  source_urls: sources,
});

test("re-reading the second advance takes it off the first advance it was linked to by mistake", () => {
  const first = "https://www.gpw.pl/komunikat?geru_id=1";
  const second = "https://www.gpw.pl/komunikat?geru_id=2";
  const october = stored("october", "dividend:2026:single", "2026-10-21", "2026-10-28", [first, second]);
  const plan = planDividendSourceReprojection([october], dividends(VOTUM_SECOND_ADVANCE), second, true, false);
  assert.deepEqual([plan.detachIds, plan.deactivateIds, plan.retainedIds], [["october"], [], []]);
  // A download that failed is no evidence: the link stays.
  assert.deepEqual(planDividendSourceReprojection([october], dividends(VOTUM_SECOND_ADVANCE), second, false, false).detachIds, []);
});

test("an advance stored under the year's single identity is still that advance when its days agree", () => {
  const source = "https://www.gpw.pl/komunikat?geru_id=2";
  const [advance] = dividends(VOTUM_SECOND_ADVANCE);
  const legacy = stored("legacy", "dividend:2026:single", "2026-12-16", "2026-12-23", [source]);
  assert.equal(isSameDividendDistribution(legacy, advance), true);
  assert.equal(isSameDividendDistribution({ ...legacy, record_date: "2026-10-21", payment_date: "2026-10-28" }, advance), false);
  // Before this rule the re-read would have retired the row the same transaction had just updated.
  assert.deepEqual(planDividendSourceReprojection([legacy], [advance], source, true, false).retainedIds, ["legacy"]);
});
