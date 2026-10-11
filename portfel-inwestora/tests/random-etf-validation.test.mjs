import assert from "node:assert/strict";
import test from "node:test";
import { mergeQuoteIntoPortfolioAsset } from "../src/lib/api.ts";
import { getAssetClassAllocation, getPortfolioInstrumentClass } from "../src/lib/geographic-allocation.ts";

// Independent post-implementation sample. Source pool: the public iShares UK
// official product-data catalog (913 distinct ETF ISINs with local tickers).
// The sample was selected without replacement after the base tests passed.
// Seed: mexo-etf-validation-2026-10-11-v1; sorted ISIN pool + FNV-1a-seeded
// Mulberry32 PRNG.
const randomOfficialEtfSample = [
  { name: "iShares MSCI Europe SRI UCITS ETF", isin: "IE00BGDPWW94", ticker: "ISED", exchange: "Euronext Amsterdam", currency: "EUR", providerQuoteType: "ETF" },
  { name: "iShares Core FTSE 100 UCITS ETF", isin: "IE0005042456", ticker: "ISF", exchange: "London Stock Exchange", currency: "GBP", providerQuoteType: "ETF" },
  { name: "iShares Global Corp Bond UCITS ETF", isin: "IE00BDFK3G24", ticker: "CRHG", exchange: "London Stock Exchange", currency: "GBP", providerQuoteType: "ETF" },
  { name: "iShares MSCI USA Climate Transition Aware UCITS ETF", isin: "IE000YG82CF0", ticker: "UCTD", exchange: "Euronext Amsterdam", currency: "USD", providerQuoteType: "ETF" },
  { name: "iShares $ Treasury Bond 20+yr UCITS ETF", isin: "IE00BMWB9526", ticker: "DTMXX", exchange: "Cboe Europe", currency: "MXN", providerQuoteType: null },
  { name: "iShares MSCI World Information Technology Sector Advanced UCITS ETF", isin: "IE000LO4MAC0", ticker: "WSTI", exchange: "Euronext Amsterdam", currency: "USD", providerQuoteType: "ETF" },
  { name: "iShares US Mortgage Backed Securities UCITS ETF", isin: "IE00BZ6V7883", ticker: "IMBS", exchange: "London Stock Exchange", currency: "USD", providerQuoteType: "ETF" },
  { name: "iShares Core MSCI Europe UCITS ETF", isin: "IE000MAO75G5", ticker: "CEBZ", exchange: "Xetra", currency: "EUR", providerQuoteType: "ETF" },
  { name: "iShares Asia Pacific AC ex-Japan Domestic Focus UCITS ETF", isin: "IE0005PO8S74", ticker: "ADOM", exchange: "Euronext Amsterdam", currency: "USD", providerQuoteType: "ETF" },
  { name: "iShares iBonds Dec 2032 Term $ Corp UCITS ETF", isin: "IE00049LEBV0", ticker: "32ID", exchange: "Euronext Amsterdam", currency: "USD", providerQuoteType: "ETF" },
];

test("independent random ETF sample flows safely into Structure allocation", async (t) => {
  assert.equal(new Set(randomOfficialEtfSample.map((item) => item.isin)).size, 10);

  for (const item of randomOfficialEtfSample) {
    await t.test(`${item.ticker} / ${item.exchange} / ${item.currency}`, () => {
      // Simulate a legacy stock-kind lot carrying verified catalog/provider
      // metadata. Classification must not rewrite identity or financial data.
      const originalLot = {
        id: item.isin,
        name: item.name,
        symbol: item.ticker,
        kind: "stock",
        marketCurrency: item.currency,
        purchaseCurrency: item.currency,
        quantity: 1,
        purchasePrice: 100,
        purchaseDate: "2025-01-02",
        purchasePriceCurrency: item.currency,
        feePln: 0,
        provider: "yahoo",
        providerId: item.ticker,
      };
      const lot = item.providerQuoteType
        ? mergeQuoteIntoPortfolioAsset(originalLot, {
            symbol: item.ticker,
            name: item.name,
            price: 100,
            marketCurrency: item.currency,
            provider: "yahoo",
            providerId: item.ticker,
            instrumentType: item.providerQuoteType,
            fetchedAt: "2026-10-10T15:00:00.000Z",
          })
        : originalLot;
      const group = {
        kind: lot.kind,
        instrumentType: lot.instrumentType,
        name: item.name,
        lots: [lot],
        totalValue: 123.45,
      };

      const expectedClass = item.providerQuoteType ? "etf" : "unverified";
      assert.equal(getPortfolioInstrumentClass(group), expectedClass);
      assert.deepEqual(getAssetClassAllocation([group]), [
        {
          id: expectedClass,
          label: expectedClass === "etf" ? "ETF" : "Niezweryfikowany typ",
          totalValue: 123.45,
        },
      ]);
      assert.equal(lot.symbol, item.ticker);
      assert.equal(lot.marketCurrency, item.currency);
      assert.equal(lot.quantity, 1);
      assert.equal(lot.purchasePrice, 100);
      assert.equal(lot.kind, "stock", "legacy asset kind must not be rewritten as part of classification");
    });
  }
});
