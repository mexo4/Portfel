import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getAssetClassAllocation,
  getConfirmedIssuerCountry,
  getStockMarketClass,
  UNKNOWN_COUNTRY_LABEL,
} from "../src/lib/geographic-allocation.ts";
import { normalizeStoredPortfolioAssets } from "../src/lib/portfolio-state.ts";

const stock = ({ symbol, value = 100, country, source, provider = "eodhd", currency = "USD" }) => ({
  key: symbol,
  name: symbol,
  symbol,
  kind: "stock",
  totalValue: value,
  lots: [{
    symbol,
    provider,
    providerId: symbol,
    marketCurrency: currency,
    issuerCountry: country,
    issuerCountrySource: source,
  }],
});

test("ordinary shares are split by GPW listing and confirmed issuer country", () => {
  const groups = [
    stock({ symbol: "DNP.PL", value: 10, provider: "stooq", currency: "PLN" }),
    stock({ symbol: "XTB.PL", value: 20, provider: "stooq", currency: "PLN" }),
    stock({ symbol: "PKN.PL", value: 30, provider: "stooq", currency: "PLN" }),
    stock({ symbol: "REXR", value: 40, country: "US", source: "issuer-profile" }),
    stock({ symbol: "TM.US", value: 50, country: "Japan", source: "issuer-profile" }),
    stock({ symbol: "ASML", value: 60, country: "Netherlands", source: "issuer-profile" }),
  ];

  assert.deepEqual(
    getAssetClassAllocation(groups).map(({ id, label, totalValue }) => ({ id, label, totalValue })),
    [
      { id: "stock:international", label: "Akcje międzynarodowe", totalValue: 110 },
      { id: "stock:gpw", label: "Akcje GPW", totalValue: 60 },
      { id: "stock:usa", label: "Akcje amerykańskie", totalValue: 40 },
    ],
  );
  assert.equal(getStockMarketClass(groups[4]).id, "stock:international");
  assert.equal(groups.reduce((sum, item) => sum + item.totalValue, 0), 210);
}
);

test("unproven legacy exchange-country metadata is not classified as issuer country", () => {
  const legacy = stock({ symbol: "TM.US", country: "USA" });
  assert.equal(getConfirmedIssuerCountry(legacy), UNKNOWN_COUNTRY_LABEL);
  assert.deepEqual(getStockMarketClass(legacy), {
    id: "stock:issuer-country-unknown",
    label: "Akcje — nieustalony kraj",
  });
});

test("allocation remains additive for SINGLE, ALL and CUSTOM portfolio scopes", () => {
  const portfolioGroups = [
    { portfolioId: "p1", ...stock({ symbol: "DNP.PL", value: 120, provider: "stooq", currency: "PLN" }) },
    { portfolioId: "p2", ...stock({ symbol: "AAPL", value: 200, country: "USA", source: "issuer-profile" }) },
    { portfolioId: "p3", ...stock({ symbol: "TM.US", value: 80, country: "Japan", source: "issuer-profile" }) },
  ];
  const getTotal = (portfolioIds) => {
    const selected = portfolioGroups.filter((group) => portfolioIds.includes(group.portfolioId));
    return getAssetClassAllocation(selected).reduce((sum, item) => sum + item.totalValue, 0);
  };

  assert.equal(getTotal(["p1"]), 120); // SINGLE
  assert.equal(getTotal(["p1", "p2", "p3"]), 400); // ALL
  assert.equal(getTotal(["p2", "p3"]), 280); // CUSTOM
});

test("US aliases normalize, and conflicting issuer metadata remains unknown", () => {
  assert.equal(getStockMarketClass(stock({ symbol: "AAPL", country: "United States of America", source: "issuer-profile" })).id, "stock:usa");
  const conflicting = {
    ...stock({ symbol: "DUAL", country: "USA", source: "issuer-profile" }),
    lots: [
      { issuerCountry: "USA", issuerCountrySource: "issuer-profile" },
      { issuerCountry: "Japan", issuerCountrySource: "broker-confirmed" },
    ],
  };
  assert.equal(getConfirmedIssuerCountry(conflicting), UNKNOWN_COUNTRY_LABEL);
  assert.equal(getStockMarketClass(conflicting).id, "stock:issuer-country-unknown");
});

test("ETF and non-stock asset classes are untouched by ordinary-stock country allocation", () => {
  const result = getAssetClassAllocation([
    { kind: "etf", totalValue: 40, lots: [{ issuerCountry: "USA", issuerCountrySource: "issuer-profile" }] },
    { kind: "crypto", totalValue: 30, lots: [] },
    { kind: "stock", symbol: "UNKNOWN", totalValue: 20, lots: [{ issuerCountry: "USA" }] },
  ]);
  assert.deepEqual(result, [
    { id: "etf", label: "ETF", totalValue: 40 },
    { id: "crypto", label: "Krypto", totalValue: 30 },
    { id: "stock:issuer-country-unknown", label: "Akcje — nieustalony kraj", totalValue: 20 },
  ]);
  assert.equal(result.reduce((sum, item) => sum + item.totalValue, 0), 90);
});

test("legacy country strings remain stored but are not promoted without trusted provenance", () => {
  const [legacy, verified] = normalizeStoredPortfolioAssets([
    {
      id: "legacy-stock",
      name: "Legacy listing",
      symbol: "TM.US",
      kind: "stock",
      purchaseDate: "2026-01-01",
      quantity: 1,
      purchasePrice: 100,
      purchaseCurrency: "USD",
      feePln: 0,
      marketCurrency: "USD",
      provider: "eodhd",
      issuerCountry: "USA",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "verified-stock",
      name: "Verified stock",
      symbol: "AAPL",
      kind: "stock",
      purchaseDate: "2026-01-01",
      quantity: 1,
      purchasePrice: 100,
      purchaseCurrency: "USD",
      feePln: 0,
      marketCurrency: "USD",
      provider: "catalog",
      issuerCountry: "United States",
      issuerCountrySource: "issuer-profile",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
  assert.equal(legacy?.issuerCountry, "USA");
  assert.equal(legacy?.issuerCountrySource, undefined);
  assert.equal(verified?.issuerCountrySource, "issuer-profile");
  assert.equal(getStockMarketClass({ kind: "stock", totalValue: 10, lots: [legacy] }).id, "stock:issuer-country-unknown");
  assert.equal(getStockMarketClass({ kind: "stock", totalValue: 10, lots: [verified] }).id, "stock:usa");
});

test("EODHD exchange-country metadata is not copied into issuer country", async () => {
  const source = await readFile(new URL("../src/lib/server/eodhd.ts", import.meta.url), "utf8");
  assert.match(source, /Country field describes the listing venue/);
  assert.doesNotMatch(source, /issuerCountry:\s*item\.country/);
});

// Independent post-implementation sample. Pool: BlackRock iShares MSCI ACWI
// latest holdings CSV, 2,160 unique equity ticker+exchange listings across 48
// issuer locations and 56 exchanges. Sampled without replacement using seed
// 20261011; a seeded random permutation was traversed until 10 distinct
// location+exchange pairs were selected. The CSV does not include ISINs.
const INDEPENDENT_RANDOM_STOCK_SAMPLE = [
  { ticker: "IMB", name: "Imperial Brands PLC", country: "United Kingdom", exchange: "London Stock Exchange", expected: "stock:international" },
  { ticker: "ADNOCDIST", name: "Abu Dhabi National Oil Company for Distribution", country: "United Arab Emirates", exchange: "Abu Dhabi Securities Exchange", expected: "stock:international" },
  { ticker: "DGX", name: "Quest Diagnostics Inc", country: "United States", exchange: "NYSE", expected: "stock:usa" },
  { ticker: "GMAB", name: "Genmab", country: "Denmark", exchange: "OMX Nordic Exchange Copenhagen", expected: "stock:international" },
  { ticker: "7453", name: "Ryohin Keikaku", country: "Japan", exchange: "Tokyo Stock Exchange", expected: "stock:international" },
  { ticker: "6869", name: "Yangtze Optical Fibre and Cable", country: "China", exchange: "Hong Kong Exchanges and Clearing", expected: "stock:international" },
  { ticker: "UHR", name: "The Swatch Group AG", country: "Switzerland", exchange: "SIX Swiss Exchange", expected: "stock:international" },
  { ticker: "AEM", name: "Agnico Eagle Mines", country: "Canada", exchange: "Toronto Stock Exchange", expected: "stock:international" },
  { ticker: "032830", name: "Samsung Life Ltd", country: "Korea (South)", exchange: "Korea Exchange", expected: "stock:international" },
  { ticker: "ICICIPRULI", name: "ICICI Prudential Life Insurance Co", country: "India", exchange: "National Stock Exchange of India", expected: "stock:international" },
];

for (const sample of INDEPENDENT_RANDOM_STOCK_SAMPLE) {
  test(`random stock sample classifies ${sample.ticker} (${sample.exchange}) from issuer location`, () => {
    const result = getStockMarketClass(stock({
      symbol: sample.ticker,
      country: sample.country,
      source: "catalog",
      provider: "eodhd",
      currency: "USD",
    }));
    assert.equal(result.id, sample.expected, `${sample.name}: ${sample.country}`);
  });
}

test("random stock sample sums to total without changing the ETF bucket", () => {
  const groups = INDEPENDENT_RANDOM_STOCK_SAMPLE.map((sample, index) => stock({
    symbol: sample.ticker,
    country: sample.country,
    source: "catalog",
    provider: "eodhd",
    currency: "USD",
    value: index + 1,
  }));
  const allocation = getAssetClassAllocation([
    ...groups,
    { kind: "etf", totalValue: 100, lots: [{ kind: "etf", instrumentType: "ETF" }] },
  ]);
  assert.equal(allocation.reduce((sum, item) => sum + item.totalValue, 0), 155);
  assert.equal(allocation.find((item) => item.id === "etf")?.totalValue, 100);
  assert.equal(allocation.find((item) => item.id === "stock:usa")?.totalValue, 3);
  assert.equal(allocation.find((item) => item.id === "stock:international")?.totalValue, 52);
});
