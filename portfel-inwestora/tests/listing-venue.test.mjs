import assert from "node:assert/strict";
import test from "node:test";

const {
  attachListingVenues,
  getStoredListingVenue,
  getVenueLookupSymbol,
  venueFromExchangeCode,
  venueFromSymbol,
} = await import("../src/lib/listing-venue.ts");
const { getAssetClassAllocation, getAssetClassGroup } = await import("../src/lib/geographic-allocation.ts");
const { resolveListingVenues } = await import("../src/lib/server/listing-venues.ts");
const { buildClassLookup, listVenueLookupSymbols } = await import("../src/lib/server/portfolio-structure.ts");

const lot = (symbol, extra = {}) => ({ symbol, kind: "stock", name: symbol, provider: "catalog", marketCurrency: "USD", ...extra });
const group = (symbol, extra = {}, kind = "stock") => ({
  key: symbol, name: symbol, symbol, kind, totalValue: 10,
  lots: [lot(symbol, { kind, ...(kind === "etf" ? { instrumentType: "ETF" } : {}), ...extra })],
});

test("exchange codes of the providers name the same exchanges", () => {
  assert.equal(venueFromExchangeCode("NYQ"), "nyse");
  assert.equal(venueFromExchangeCode("NMS"), "nasdaq");
  assert.equal(venueFromExchangeCode("NGM"), "nasdaq");
  assert.equal(venueFromExchangeCode("XNYS"), "nyse");
  assert.equal(venueFromExchangeCode("London Stock Exchange"), "lse");
  assert.equal(venueFromExchangeCode("US"), null, "the country alone names no exchange");
  assert.equal(venueFromExchangeCode("UN"), null, "a Bloomberg code needs a FIGI");
  assert.equal(venueFromExchangeCode("UN", true), "nyse");
  assert.equal(venueFromExchangeCode("UW", true), "nasdaq");
});

test("a symbol suffix names an exchange, except .US", () => {
  assert.equal(venueFromSymbol("PKN.PL"), "gpw");
  assert.equal(venueFromSymbol("DNP.WA"), "gpw");
  assert.equal(venueFromSymbol("IMB.UK"), "lse");
  assert.equal(venueFromSymbol("SAP.DE"), "xetra");
  assert.equal(venueFromSymbol("VWCE.XETRA"), "xetra");
  assert.equal(venueFromSymbol("ASML.NL"), "euronext-amsterdam");
  assert.equal(venueFromSymbol("AAPL.US"), null);
  assert.equal(venueFromSymbol("BRK.B"), null);
  assert.equal(venueFromSymbol("TM"), null);
});

test("only dollar tickers without a known exchange are looked up", () => {
  assert.equal(getVenueLookupSymbol(group("TM.US")), "TM");
  assert.equal(getVenueLookupSymbol(group("AAPL")), "AAPL");
  assert.equal(getVenueLookupSymbol(group("BRK.B")), "BRK-B");
  assert.equal(getVenueLookupSymbol(group("PKN.PL", { marketCurrency: "PLN" })), null);
  assert.equal(getVenueLookupSymbol(group("SAP.DE", { marketCurrency: "EUR" })), null);
  assert.equal(getVenueLookupSymbol(group("XYZ", { marketCurrency: "EUR" })), null);
  assert.equal(getVenueLookupSymbol(group("MSFT", { instrumentIdentity: { exchange: "NASDAQ" } })), null);
  assert.equal(getVenueLookupSymbol(group("MSFT", { instrumentIdentity: { exchange: "US" } })), "MSFT");
});

test("stocks are listed by the exchange they trade on, not by the company's country", () => {
  const toyota = group("TM.US", { issuerCountry: "Japan", issuerCountrySource: "issuer-profile" });
  const apple = group("AAPL.US");
  const unknown = group("ZZZ.US");
  const listed = attachListingVenues([toyota, apple, unknown], { TM: "nyse", AAPL: "nasdaq" });

  assert.deepEqual(listed.map((item) => getAssetClassGroup(item)), [
    { id: "stock:nyse", label: "Akcje NYSE" },
    { id: "stock:nasdaq", label: "Akcje NASDAQ" },
    { id: "stock:foreign", label: "Akcje zagraniczne" },
  ]);
  assert.equal(listed[2], unknown, "a group without an answer is passed through");
  assert.deepEqual(attachListingVenues([unknown], {}), [unknown]);
  assert.equal(getAssetClassGroup(group("IMB.UK", { marketCurrency: "GBP" })).label, "Akcje LSE");
});

test("saved listing data wins over a looked-up answer, and disagreeing lots say nothing", () => {
  const saved = { ...group("PKN.PL", { marketCurrency: "PLN" }), listingVenue: "nyse" };
  assert.equal(getAssetClassGroup(saved).id, "stock:gpw");
  const mixed = { lots: [lot("A", { instrumentIdentity: { exchange: "NYSE" } }), lot("A", { instrumentIdentity: { exchange: "NASDAQ" } })] };
  assert.equal(getStoredListingVenue(mixed), null);
});

test("ETFs are split into those listed on the GPW and the others", () => {
  const allocation = getAssetClassAllocation([
    { ...group("ETFBW20TR.PL", { marketCurrency: "PLN" }, "etf"), totalValue: 30 },
    { ...group("VWCE.DE", { marketCurrency: "EUR" }, "etf"), totalValue: 70 },
    { ...group("VOO.US", {}, "etf"), totalValue: 5 },
  ]);
  assert.deepEqual(allocation, [
    { id: "etf:foreign", label: "ETF-y zagraniczne", totalValue: 75 },
    { id: "etf:pl", label: "ETF-y polskie", totalValue: 30 },
  ]);
});

test("the server answers only with confirmed dollar listings and remembers them", async () => {
  const asked = [];
  const fetchExchange = async (symbol) => {
    asked.push(symbol);
    if (symbol === "QQA") return { exchangeName: "NYQ", currency: "USD" };
    if (symbol === "QQB") return { exchangeName: "LSE", currency: "GBp" };
    if (symbol === "QQC") throw new Error("offline");
    return null;
  };
  const symbols = ["QQA", "QQA", "QQB", "QQC", "QQD", "../etc", "toolongticker"];
  assert.deepEqual(await resolveListingVenues(symbols, fetchExchange), { QQA: "nyse" });
  assert.deepEqual(asked.sort(), ["QQA", "QQB", "QQC", "QQD"]);

  asked.length = 0;
  assert.deepEqual(await resolveListingVenues(["QQA", "QQB"], fetchExchange), { QQA: "nyse" });
  assert.deepEqual(asked, [], "both answers come from the cache");
});

test("the structure over time uses the same classes, also for holdings sold in full", () => {
  const sale = { symbol: "TM.US", kind: "stock", name: "Toyota", marketCurrency: "USD", provider: "catalog", allocations: [{ lotId: "x" }] };
  assert.deepEqual(listVenueLookupSymbols([lot("AAPL.US")], [sale]).sort(), ["AAPL", "TM"]);
  const classOf = buildClassLookup([], [sale], { TM: "nyse" });
  assert.equal(classOf("stock:TM.US", { kind: "stock", label: "Toyota" }).label, "Akcje NYSE");
});
