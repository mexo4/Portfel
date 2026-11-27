import assert from "node:assert/strict";
import test from "node:test";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { applyAutomaticGpwDividends } from "../src/lib/automatic-gpw-dividends.ts";
import { buildDividendOperation, getPortfolioDividends } from "../src/lib/dividend-engine.ts";
import { createInvestmentPortfolio, normalizePortfolioBook } from "../src/lib/portfolio-state.ts";
import { getPortfolioInstrumentId } from "../src/lib/operation-engine.ts";

// ORLEN current report 23/2026 of 9 June 2026: the dates stand in a list, each before its label.
const ORLEN_REPORT = [
  "Treść raportu:",
  "ORLEN S.A. („Spółka”) informuje, że Zwyczajne Walne Zgromadzenie ORLEN S.A. w dniu 9 czerwca 2026 roku postanowiło przeznaczyć kwotę 9.287.536.392,00 PLN na wypłatę dywidendy w wysokości 8,00 PLN na 1 akcję.",
  "Zwyczajne Walne Zgromadzenie ORLEN S.A. ustaliło:",
  "- 18 czerwca 2026 roku jako dzień dywidendy oraz",
  "- 25 czerwca 2026 roku jako dzień wypłaty dywidendy.",
  "Dywidendą objęte są wszystkie akcje Spółki (1 160 942 049 akcji).",
].join("\n");
const ENGLISH = "\nMESSAGE (ENGLISH VERSION)\n... as of 9 June 2026 decided ...\n- 18 June 2026 as the dividend day and\n- 25 June 2026 as the dividend payment date.\n";

const dividendsOf = (text) => parseCorporateEventDocument(text).filter((event) => event.eventType === "UPCOMING_DIVIDEND");

test("dates listed before their labels are read as the record and the payment day", () => {
  for (const text of [ORLEN_REPORT, `ORLEN SA (23/2026) Decyzja ZWZ ORLEN S.A. w sprawie wypłaty dywidendy\n${ORLEN_REPORT}${ENGLISH}`]) {
    const [event, ...rest] = dividendsOf(text);
    assert.equal(rest.length, 0);
    assert.deepEqual([event.recordDate, event.paymentDate, event.dividendPerShare], ["2026-06-18", "2026-06-25", 8]);
  }
});

test("a payment before the record day is not published", () => {
  const [event] = dividendsOf("Dywidenda 8,00 zł na akcję. Dzień dywidendy: 25 czerwca 2026 r. Dzień wypłaty dywidendy: 9 czerwca 2026 r.");
  assert.equal(event.recordDate, "2026-06-25");
  assert.equal(event.paymentDate, undefined);
});

const portfolioWith = (operations) => {
  const base = createInvestmentPortfolio("Główny", { assets: [], sales: [], realizedAdjustments: [] });
  const asset = { id: "pkn", name: "ORLEN", symbol: "PKN.PL", kind: "stock", purchaseDate: "2025-03-10", quantity: 20, purchasePrice: 64, purchaseCurrency: "PLN", feePln: 0, marketCurrency: "PLN", provider: "stooq", latestPrice: 120, createdAt: "2025-03-10T10:00:00.000Z" };
  const book = normalizePortfolioBook({ schemaVersion: 2, portfolios: [{ ...base, assets: [asset] }], activePortfolioId: base.id, migratedAt: "2026-01-01T00:00:00.000Z" });
  const portfolio = book.portfolios[0];
  portfolio.operations = [...(portfolio.operations ?? []), ...operations(portfolio)];
  return book;
};
const withExtra = (build) => portfolioWith((portfolio) => build(portfolio));

const wrongPosting = (portfolio, { automatic = true } = {}) => ({
  ...buildDividendOperation({
    id: `auto-dividend:${portfolio.id}:orlen`, portfolioId: portfolio.id, accountId: portfolio.accounts[0].id,
    instrumentId: getPortfolioInstrumentId(portfolio.id, { kind: "stock", symbol: "PKN.PL" }),
    quantity: 20, dividendPerShare: 8, currency: "PLN", exchangeRate: 1, withholdingTax: 0, domesticTax: 30.4,
    exDividendDate: "2026-11-27", recordDate: "2026-06-25", paymentDate: "2026-06-09", country: "PL", notes: "",
    metadata: automatic ? { automaticDividend: true, automaticDividendEventId: "orlen" } : {},
    createdAt: "2026-11-27T10:00:00.000Z",
  }),
});

const event = { id: "orlen", eventType: "UPCOMING_DIVIDEND", status: "CONFIRMED", ticker: "PKN", companyName: "ORLEN", recordDate: "2026-06-18", paymentDate: "2026-06-25", eventDate: "2026-06-18", dividendPerShare: 8, dividendCurrency: "PLN" };
const dividends = (result) => getPortfolioDividends(result.portfolioBook.portfolios[0], { PLN: 1 }).map((item) => [item.paymentDate, item.exDividendDate, item.netAmount]);

test("an automatic entry with impossible dates is booked again on the right day, once", () => {
  const book = withExtra((portfolio) => [wrongPosting(portfolio)]);
  const result = applyAutomaticGpwDividends({ portfolioBook: book, events: [event], today: "2026-11-27" });

  assert.equal(result.repairedCount >= 1, true);
  assert.equal(result.addedCount, 1);
  // No ex-dividend day in the notice: the entry shows the payment day, never the booking day.
  assert.deepEqual(dividends(result), [["2026-06-25", "2026-06-25", 129.6]]);

  const again = applyAutomaticGpwDividends({ portfolioBook: result.portfolioBook, events: [event], today: "2026-11-28" });
  assert.deepEqual([again.addedCount, again.repairedCount], [0, 0]);
  assert.equal(again.portfolioBook, result.portfolioBook);
});

test("before the right payment day the wrong entry is removed and nothing is booked yet", () => {
  const book = withExtra((portfolio) => [wrongPosting(portfolio)]);
  const result = applyAutomaticGpwDividends({ portfolioBook: book, events: [event], today: "2026-06-20" });

  assert.deepEqual(dividends(result), []);
  assert.equal(result.addedCount, 0);
});

test("an event that still has impossible dates books nothing and keeps the old entry", () => {
  const book = withExtra((portfolio) => [wrongPosting(portfolio)]);
  const result = applyAutomaticGpwDividends({ portfolioBook: book, events: [{ ...event, recordDate: "2026-06-25", paymentDate: "2026-06-09" }], today: "2026-11-27" });

  assert.equal(result.addedCount, 0);
  assert.equal(dividends(result).length, 1);
});

test("an entry the user edited is left alone", () => {
  const book = withExtra((portfolio) => [wrongPosting(portfolio, { automatic: false })]);
  const result = applyAutomaticGpwDividends({ portfolioBook: book, events: [event], today: "2026-11-27" });

  assert.equal(result.repairedCount, 0);
  assert.equal(dividends(result).some(([paymentDate]) => paymentDate === "2026-06-09"), true);
});

test("an empty ex-dividend day is not turned into today", () => {
  const operation = buildDividendOperation({ id: "d", portfolioId: "p", accountId: "a", instrumentId: "i", quantity: 1, dividendPerShare: 1, currency: "PLN", exchangeRate: 1, withholdingTax: 0, domesticTax: 0, exDividendDate: "", recordDate: "2026-06-18", paymentDate: "2026-06-25", country: "PL", notes: "" });
  assert.equal(operation.metadata.exDividendDate, undefined);
});
