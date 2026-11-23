import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hasUnresolvableEtfVenue,
  needsEtfPriceSourceResolution,
  rankBenchmarkSearchResults,
} from "../src/lib/benchmark-search.ts";
import { ETF_PRICE_SOURCE_EXCHANGE_CODES } from "../src/lib/etf-price-venues.ts";
import { YAHOO_SUFFIX_BY_OPENFIGI_EXCHANGE } from "../src/lib/server/yahoo-backup.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

/** An ETF listing as OpenFIGI returns it: a venue code and no price-provider id. */
const openFigiListing = (symbol, exchangeCode, name = "VANG FTSE AW USDD") => ({
  symbol,
  name,
  kind: "etf",
  marketCurrency: "USD",
  provider: "eodhd",
  source: "api",
  subtitle: `Venue ${exchangeCode}`,
  instrumentIdentity: {
    ticker: symbol,
    name,
    instrumentType: "ETF",
    exchange: exchangeCode,
    exchangeCode,
    currency: undefined,
  },
});

test("a fund listed on many OpenFIGI venues shows the one that can get a price series", () => {
  // The real VWRD answer from production: one London line among MTF codes.
  const listings = ["B2", "B4", "E1", "EP", "ER", "EZ", "LN", "PZ"].map((code) =>
    openFigiListing("VWRD", code)
  );

  const results = rankBenchmarkSearchResults("VWRD", listings);

  assert.equal(results.length, 1);
  assert.equal(results[0].instrumentIdentity.exchangeCode, "LN");
  assert.equal(hasUnresolvableEtfVenue(results[0]), false);
});

test("the working venue wins regardless of the order the provider answered in", () => {
  const listings = [openFigiListing("VWRD", "LN"), openFigiListing("VWRD", "B2")];

  assert.equal(
    rankBenchmarkSearchResults("VWRD", listings)[0].instrumentIdentity.exchangeCode,
    "LN"
  );
  assert.equal(
    rankBenchmarkSearchResults("VWRD", [...listings].reverse())[0].instrumentIdentity.exchangeCode,
    "LN"
  );
});

test("a typed fund name lists workable tickers before tickers that only trade on dead venues", () => {
  // `VFPEF` sorts before `VWRD` and VWRD's London line must not be cut by the cap.
  const results = rankBenchmarkSearchResults("VANG FTSE AW USDD", [
    openFigiListing("VFPEF", "PQ"),
    openFigiListing("VFPEF", "PQ"),
    openFigiListing("VGWL", "GD"),
    openFigiListing("VWRD", "B2"),
    openFigiListing("VWRD", "LN"),
    openFigiListing("VWRL", "NA"),
  ]);

  const symbols = results.map((result) => result.symbol);

  assert.deepEqual(symbols.slice(0, 2).sort(), ["VWRD", "VWRL"]);
  // A ticker with no workable venue stays findable, once, after the workable ones.
  assert.deepEqual(symbols.slice(2).sort(), ["VFPEF", "VGWL"]);
  assert.equal(
    results.filter((result) => result.symbol === "VWRD").length,
    1,
    "VWRD's dead B2 line is dropped because London works"
  );
});

test("one ticker on two workable venues keeps both, so the user can choose the venue", () => {
  const results = rankBenchmarkSearchResults("VWRL", [
    openFigiListing("VWRL", "LN", "VANG FTSE AW USDD"),
    openFigiListing("VWRL", "NA", "VANG FTSE AW USDD"),
    openFigiListing("VWRL", "NA", "VANG FTSE AW USDD"),
  ]);

  assert.deepEqual(
    results.map((result) => result.instrumentIdentity.exchangeCode).sort(),
    ["LN", "NA"]
  );
});

test("a listing that already carries a price source needs no resolution and is never demoted", () => {
  const catalogListing = {
    ...openFigiListing("CSPX", "B2"),
    provider: "eodhd",
    providerId: "CSPX.LSE",
    source: "catalog",
  };

  assert.equal(needsEtfPriceSourceResolution(catalogListing), false);
  assert.equal(hasUnresolvableEtfVenue(catalogListing), false);
  assert.equal(needsEtfPriceSourceResolution(openFigiListing("VWRD", "LN")), true);
});

test("core index benchmarks and non-ETF results are untouched by the venue rules", () => {
  const results = rankBenchmarkSearchResults("S&P 500", [
    {
      symbol: "SPX500",
      name: "S&P 500 stock",
      kind: "stock",
      marketCurrency: "USD",
      provider: "yahoo",
      providerId: "SPX500",
      source: "api",
    },
  ]);

  assert.equal(results[0].symbol, "^GSPC");
  assert.equal(hasUnresolvableEtfVenue(results[0]), false);
  assert.ok(results.some((result) => result.symbol === "SPX500"));
});

test("the client-side venue list is exactly the server-side Yahoo venue table", () => {
  assert.deepEqual(
    [...ETF_PRICE_SOURCE_EXCHANGE_CODES].sort(),
    Object.keys(YAHOO_SUFFIX_BY_OPENFIGI_EXCHANGE).sort()
  );
});

test("adding an ETF benchmark settles its price source first and refuses a dead listing", async () => {
  const lineCharts = await readSource("src/components/PortfolioLineCharts.tsx");

  assert.match(lineCharts, /needsEtfPriceSourceResolution\(searchResult\)/);
  assert.match(lineCharts, /await resolveEtfListingPrice\(searchResult as EtfListing\)/);
  // The resolved listing, not the raw search result, becomes the benchmark.
  assert.match(lineCharts, /result = resolvedListing;/);
  assert.match(lineCharts, /resolvedListing\.priceStatus === "unavailable" \|\| !resolvedListing\.providerId/);
  assert.match(lineCharts, /createPortfolioBenchmarkDefinition\(result, benchmarkSearchMode\)/);
});
