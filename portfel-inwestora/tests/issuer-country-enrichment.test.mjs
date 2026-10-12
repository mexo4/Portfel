import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichPortfolioBookIssuerCountries,
  parseGleifIssuerCountry,
} from "../src/lib/issuer-country.ts";
import { getAssetClassAllocation } from "../src/lib/geographic-allocation.ts";
import { getPortfolioInstrumentId } from "../src/lib/operation-engine.ts";

const TOYOTA_ISIN = "US8923313071";
const REXFORD_ISIN = "US76169C1009";

const gleifPayload = ({ lei, country }) => ({
  data: [{
    type: "lei-records",
    id: lei,
    attributes: {
      lei,
      entity: {
        legalAddress: { country },
      },
      registration: { status: "ISSUED" },
    },
  }],
});

const portfolioAsset = ({ id, symbol, name, kind = "stock", provider = "eodhd", isin, country }) => ({
  id,
  symbol,
  name,
  kind,
  purchaseDate: "2025-01-02",
  quantity: 1,
  purchasePrice: 100,
  purchaseCurrency: "USD",
  feePln: 0.5,
  marketCurrency: "USD",
  purchasePriceCurrency: "USD",
  purchaseFxRateToPln: 4,
  latestPrice: 123.45,
  latestPriceDate: "2026-10-09",
  previousClose: 120,
  provider,
  isin,
  issuerCountry: country,
  createdAt: "2025-01-02T00:00:00.000Z",
});

const linkedInstrument = (portfolioId, asset, isin, metadata = {}) => ({
  id: getPortfolioInstrumentId(portfolioId, asset),
  portfolioId,
  type: "STOCK",
  assetKind: "stock",
  symbol: asset.symbol,
  name: asset.name,
  marketCurrency: asset.marketCurrency,
  provider: asset.provider,
  isin,
  metadata,
  createdAt: "2025-01-02T00:00:00.000Z",
  updatedAt: "2025-01-02T00:00:00.000Z",
});

test("GLEIF country parser requires an issued legal entity and an exact valid ISIN", () => {
  assert.deepEqual(
    parseGleifIssuerCountry(gleifPayload({ lei: "5493006W3QUS5LMH6R84", country: "JP" }), TOYOTA_ISIN),
    { country: "JP", source: "gleif-isin", lei: "5493006W3QUS5LMH6R84" },
  );
  assert.equal(parseGleifIssuerCountry(gleifPayload({ lei: "5493006W3QUS5LMH6R84", country: "JP" }), "TM"), null);
  const notIssued = gleifPayload({ lei: "5493006W3QUS5LMH6R84", country: "JP" });
  notIssued.data[0].attributes.registration.status = "LAPSED";
  assert.equal(parseGleifIssuerCountry(notIssued, TOYOTA_ISIN), null);
});

test("legacy XTB holdings are enriched through per-portfolio instrument IDs and affect Structure allocation", async () => {
  const toyota = portfolioAsset({ id: "lot-toyota", symbol: "TM.US", name: "Toyota Motor Corporation", country: "USA" });
  const rexford = portfolioAsset({ id: "lot-rexford", symbol: "REXR.US", name: "Rexford Industrial Realty" });
  const dino = portfolioAsset({ id: "lot-dino", symbol: "DNP.PL", name: "Dino Polska", provider: "stooq" });
  const etf = portfolioAsset({ id: "lot-etf", symbol: "VWRD.UK", name: "Vanguard FTSE All-World UCITS ETF", kind: "etf" });
  const portfolio = {
    id: "legacy-xtb",
    name: "XTB",
    assets: [toyota, rexford, dino, etf],
    sales: [],
    realizedAdjustments: [],
    instruments: [
      linkedInstrument("legacy-xtb", toyota, TOYOTA_ISIN),
      linkedInstrument("legacy-xtb", rexford, REXFORD_ISIN),
    ],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  };
  const originalFinancialFields = portfolio.assets.map(({ id, quantity, purchasePrice, purchaseCurrency, purchasePriceCurrency, purchaseFxRateToPln, feePln, marketCurrency, latestPrice, latestPriceDate, previousClose }) =>
    ({ id, quantity, purchasePrice, purchaseCurrency, purchasePriceCurrency, purchaseFxRateToPln, feePln, marketCurrency, latestPrice, latestPriceDate, previousClose })
  );
  const resolveCalls = [];
  const book = { portfolios: [portfolio], activePortfolioId: portfolio.id };

  const enriched = await enrichPortfolioBookIssuerCountries(book, async (isin) => {
    resolveCalls.push(isin);
    const payload = isin === TOYOTA_ISIN
      ? gleifPayload({ lei: "5493006W3QUS5LMH6R84", country: "JP" })
      : gleifPayload({ lei: "549300MSLO0DF0EMX355", country: "US" });
    return parseGleifIssuerCountry(payload, isin);
  });

  const enrichedAssets = enriched.portfolios[0].assets;
  const bySymbol = new Map(enrichedAssets.map((asset) => [asset.symbol, asset]));
  assert.deepEqual([...resolveCalls].sort(), [REXFORD_ISIN, TOYOTA_ISIN]);
  assert.equal(bySymbol.get("TM.US").issuerCountry, "JP");
  assert.equal(bySymbol.get("TM.US").issuerCountrySource, "gleif-isin");
  assert.equal(bySymbol.get("REXR.US").issuerCountry, "US");
  assert.equal(bySymbol.get("REXR.US").issuerCountrySource, "gleif-isin");

  const values = { "TM.US": 1201.46, "REXR.US": 868.09, "DNP.PL": 4800.1, "VWRD.UK": 2478.42 };
  const groups = enrichedAssets.map((asset) => ({
    key: asset.symbol,
    name: asset.name,
    symbol: asset.symbol,
    kind: asset.kind,
    totalValue: values[asset.symbol],
    lots: [asset],
  }));
  const allocation = getAssetClassAllocation(groups);
  const totalsByClass = Object.fromEntries(allocation.map(({ id, totalValue }) => [id, totalValue]));
  assert.deepEqual(totalsByClass, {
    "stock:international": 1201.46,
    "stock:usa": 868.09,
    "stock:gpw": 4800.1,
    etf: 2478.42,
  });
  const displayedAllocation = [...allocation, { id: "cash", label: "Gotówka", totalValue: 23.42 }];
  assert.equal(displayedAllocation.reduce((total, item) => total + item.totalValue, 0), 9371.49);
  assert.deepEqual(
    enrichedAssets.map(({ id, quantity, purchasePrice, purchaseCurrency, purchasePriceCurrency, purchaseFxRateToPln, feePln, marketCurrency, latestPrice, latestPriceDate, previousClose }) =>
      ({ id, quantity, purchasePrice, purchaseCurrency, purchasePriceCurrency, purchaseFxRateToPln, feePln, marketCurrency, latestPrice, latestPriceDate, previousClose })
    ),
    originalFinancialFields,
  );
  assert.equal(book.portfolios[0].assets[0].issuerCountrySource, undefined, "read-model enrichment must not mutate stored input");
});

test("a trusted issuer country already present on the linked core instrument avoids external lookups", async () => {
  const asset = portfolioAsset({ id: "lot-verified", symbol: "TM.US", name: "Toyota Motor Corporation" });
  const portfolio = {
    id: "p1",
    name: "P1",
    assets: [asset],
    sales: [],
    realizedAdjustments: [],
    instruments: [linkedInstrument("p1", asset, TOYOTA_ISIN, {
      issuerCountry: "Japonia",
      issuerCountrySource: "issuer-profile",
    })],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  };
  let calls = 0;
  const enriched = await enrichPortfolioBookIssuerCountries(
    { portfolios: [portfolio], activePortfolioId: "p1" },
    async () => { calls += 1; return null; },
  );
  assert.equal(calls, 0);
  assert.equal(enriched.portfolios[0].assets[0].issuerCountry, "Japonia");
  assert.equal(enriched.portfolios[0].assets[0].issuerCountrySource, "issuer-profile");
});

test("same ISIN in multiple real portfolios is looked up once and unresolved shares stay unresolved", async () => {
  const toyotaA = portfolioAsset({ id: "toyota-a", symbol: "TM.US", name: "Toyota Motor Corporation" });
  const toyotaB = portfolioAsset({ id: "toyota-b", symbol: "TM.US", name: "Toyota Motor Corporation" });
  const unknown = portfolioAsset({ id: "unknown", symbol: "MYSTERY", name: "Unresolved instrument" });
  const makePortfolio = (id, asset, isin) => ({
    id,
    name: id,
    assets: [asset],
    sales: [],
    realizedAdjustments: [],
    instruments: isin ? [linkedInstrument(id, asset, isin)] : [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  });
  const calls = [];
  const enriched = await enrichPortfolioBookIssuerCountries({
    portfolios: [makePortfolio("p1", toyotaA, TOYOTA_ISIN), makePortfolio("p2", toyotaB, TOYOTA_ISIN), makePortfolio("p3", unknown)],
    activePortfolioId: "p1",
  }, async (isin) => {
    calls.push(isin);
    return parseGleifIssuerCountry(gleifPayload({ lei: "5493006W3QUS5LMH6R84", country: "JP" }), isin);
  });
  assert.deepEqual(calls, [TOYOTA_ISIN]);
  assert.equal(enriched.portfolios[0].assets[0].issuerCountrySource, "gleif-isin");
  assert.equal(enriched.portfolios[1].assets[0].issuerCountrySource, "gleif-isin");
  assert.equal(enriched.portfolios[2].assets[0].issuerCountrySource, undefined);
});

test("conflicting legacy-lot and core-instrument ISINs fail closed rather than attaching the wrong issuer", async () => {
  const asset = portfolioAsset({ id: "conflicting", symbol: "TM.US", name: "Toyota Motor Corporation", isin: TOYOTA_ISIN });
  const portfolio = {
    id: "p-conflict",
    name: "Legacy XTB",
    assets: [asset],
    sales: [],
    realizedAdjustments: [],
    instruments: [linkedInstrument("p-conflict", asset, REXFORD_ISIN)],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-02T00:00:00.000Z",
  };
  let calls = 0;
  const enriched = await enrichPortfolioBookIssuerCountries(
    { portfolios: [portfolio], activePortfolioId: portfolio.id },
    async () => { calls += 1; return null; },
  );
  assert.equal(calls, 0);
  assert.equal(enriched.portfolios[0].assets[0].issuerCountrySource, undefined);
});
