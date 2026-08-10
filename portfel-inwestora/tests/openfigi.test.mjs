import assert from "node:assert/strict";
import test from "node:test";
import {
  groupEtfListings,
  normalizeEtfSearchQuery,
  OpenFigiInstrumentSearchProvider,
  OpenFigiSearchError,
  resolveEtfListingPriceSource,
  searchEtfInstruments,
} from "../src/lib/server/openfigi.ts";
import { searchEtfInstruments as searchEtfInstrumentsApi } from "../src/lib/api.ts";
import { buildTickerFallbackResults, searchCatalogAssets } from "../src/lib/search.ts";

const listing = ({
  ticker,
  figi,
  shareClassFIGI = "BBGSHARECLASS1",
  compositeFIGI = "BBGCOMPOSITE1",
  exchCode,
  currency,
  name = "Global Equity ETF",
  securityType = "ETP",
  securityType2 = "Mutual Fund",
}) => ({
  ticker,
  name,
  figi,
  compositeFIGI,
  shareClassFIGI,
  exchCode,
  currency,
  securityType,
  securityType2,
  marketSector: "Equity",
});

const getSingleListing = (raw) => groupEtfListings(raw.ticker, [raw])[0].listings[0];

test("groups only listings with a shared shareClassFIGI and ranks an exact ticker first", () => {
  const groups = groupEtfListings("GLOB", [
    listing({
      ticker: "GLOA",
      figi: "BBG000000001",
      exchCode: "LN",
      currency: "GBP",
    }),
    listing({
      ticker: "GLOB",
      figi: "BBG000000002",
      exchCode: "GR",
      currency: "EUR",
    }),
    listing({
      ticker: "GLOB",
      figi: "BBG000000002",
      exchCode: "GR",
      currency: "EUR",
    }),
    listing({
      ticker: "OTHER",
      figi: "BBG000000003",
      shareClassFIGI: "BBGSHARECLASS2",
      exchCode: "US",
      currency: "USD",
      name: "Other ETF",
    }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, "Global Equity ETF");
  assert.equal(groups[0].listings.length, 2);
  assert.equal(groups[0].listings[0].symbol, "GLOB");
  assert.equal(groups[0].listings[0].instrumentIdentity.figi, "BBG000000002");
  assert.equal(groups[0].listings[1].marketCurrency, "GBP");
});

test("does not group listings only because they share a composite FIGI or display name", () => {
  const groups = groupEtfListings("SAME", [
    listing({
      ticker: "SAME",
      figi: "BBG000000010",
      shareClassFIGI: "",
      compositeFIGI: "BBGCOMPOSITE-SAME",
      exchCode: "US",
      currency: "USD",
      name: "Same Display Name",
    }),
    listing({
      ticker: "SAME",
      figi: "BBG000000011",
      shareClassFIGI: "",
      compositeFIGI: "BBGCOMPOSITE-SAME",
      exchCode: "LN",
      currency: "GBP",
      name: "Same Display Name",
    }),
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].listings.length, 1);
  assert.equal(groups[1].listings.length, 1);
});

test("keeps ambiguous ETPs but excludes only explicitly classified ETN, ETC and certificates", () => {
  const groups = groupEtfListings("PRODUCT", [
    listing({
      ticker: "AMB",
      figi: "BBG000000020",
      exchCode: "US",
      currency: "USD",
      securityType2: "",
      name: "Ambiguous exchange traded product",
    }),
    listing({
      ticker: "ETN",
      figi: "BBG000000021",
      exchCode: "US",
      currency: "USD",
      securityType2: "ETN",
      name: "A name containing no classification signal",
    }),
    listing({
      ticker: "CERT",
      figi: "BBG000000022",
      exchCode: "US",
      currency: "USD",
      securityType2: "Certificate",
      name: "ETF in the name must not override provider classification",
    }),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].listings[0].symbol, "AMB");
});

test("keeps an OpenFIGI listing when v3 has no currency", () => {
  const [group] = groupEtfListings("NOCUR", [
    listing({
      ticker: "NOCUR",
      figi: "BBG000000009",
      exchCode: "US",
      currency: "",
      name: "Currency not returned ETF",
    }),
  ]);

  assert.equal(group.listings[0].instrumentIdentity.currency, undefined);
  assert.equal(group.listings[0].marketCurrency, "USD");
});

test("uses the OpenFIGI v3 ETP filter and preserves punctuation in the request body", async () => {
  let requestedUrl = "";
  let requestInit;
  const provider = new OpenFigiInstrumentSearchProvider(
    "server-only-key",
    async (url, init) => {
      requestedUrl = String(url);
      requestInit = init;
      return new Response(
        JSON.stringify({
          data: [
            listing({
              ticker: "ALPH",
              figi: "BBG000000030",
              exchCode: "US",
              currency: "USD",
              name: "Alpha ETF",
            }),
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  );

  const groups = await provider.searchEtfs("  S&P  500  ");

  assert.equal(requestedUrl, "https://api.openfigi.com/v3/filter");
  assert.equal(requestInit.headers["X-OPENFIGI-APIKEY"], "server-only-key");
  assert.deepEqual(JSON.parse(requestInit.body), { query: "S&P 500", securityType: "ETP" });
  assert.equal(groups[0].listings[0].symbol, "ALPH");
  assert.equal(normalizeEtfSearchQuery("  ETF + A/B - Łódź  "), "ETF + A/B - Łódź");
});

test("uses v3 mapping for FIGI and treats the no-identifier warning as a normal empty result", async () => {
  const mappingProvider = new OpenFigiInstrumentSearchProvider(
    "server-only-key",
    async (url, init) => {
      assert.equal(String(url), "https://api.openfigi.com/v3/mapping");
      assert.deepEqual(JSON.parse(init.body), [
        { idType: "ID_BB_GLOBAL", idValue: "BBG000000099" },
      ]);
      return new Response(
        JSON.stringify([
          {
            data: [
              listing({
                ticker: "FIGI",
                figi: "BBG000000099",
                exchCode: "US",
                currency: "USD",
              }),
            ],
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  );

  const groups = await mappingProvider.searchEtfs("BBG000000099");
  assert.equal(groups[0].listings[0].instrumentIdentity.figi, "BBG000000099");

  const noMatchProvider = new OpenFigiInstrumentSearchProvider(
    "server-only-key",
    async () =>
      new Response(JSON.stringify([{ warning: "No identifier found." }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
  );
  assert.deepEqual(await noMatchProvider.searchEtfs("BBG000000098"), []);
});

test("classifies OpenFIGI HTTP and invalid-response failures without leaking provider text", async () => {
  const expectationByStatus = new Map([
    [400, "invalid_request"],
    [401, "invalid_credentials"],
    [403, "invalid_credentials"],
    [429, "rate_limit"],
    [500, "provider_unavailable"],
    [503, "provider_unavailable"],
  ]);

  for (const [status, expectedCode] of expectationByStatus) {
    const provider = new OpenFigiInstrumentSearchProvider(
      "server-only-key",
      async () => new Response('{"detail":"provider-only"}', { status })
    );
    await assert.rejects(
      () => provider.searchEtfs("SPY"),
      (error) => error instanceof OpenFigiSearchError && error.code === expectedCode
    );
  }

  const htmlProvider = new OpenFigiInstrumentSearchProvider(
    "server-only-key",
    async () => new Response("<html>upstream proxy</html>", { status: 200 })
  );
  await assert.rejects(
    () => htmlProvider.searchEtfs("SPY"),
    (error) => error instanceof OpenFigiSearchError && error.code === "invalid_response"
  );

  const emptyProvider = new OpenFigiInstrumentSearchProvider(
    "server-only-key",
    async () => new Response("", { status: 200 })
  );
  await assert.rejects(
    () => emptyProvider.searchEtfs("SPY"),
    (error) => error instanceof OpenFigiSearchError && error.code === "invalid_response"
  );

  const timeoutProvider = new OpenFigiInstrumentSearchProvider(
    "server-only-key",
    async () => {
      throw new DOMException("aborted", "AbortError");
    }
  );
  await assert.rejects(
    () => timeoutProvider.searchEtfs("SPY"),
    (error) => error instanceof OpenFigiSearchError && error.code === "timeout"
  );

  await assert.rejects(
    () => new OpenFigiInstrumentSearchProvider("").searchEtfs("SPY"),
    (error) => error instanceof OpenFigiSearchError && error.code === "configuration"
  );
});

test("ETF client encodes special characters once and never surfaces a raw failed-request message", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  const query = "S&P 500 + A/B - Łódź";

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ groups: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    await searchEtfInstrumentsApi({ query });
    assert.equal(new URL(requestedUrl, "http://localhost").searchParams.get("q"), query);
    assert.equal(requestedUrl.includes("%25"), false);

    globalThis.fetch = async () => new Response("<html>proxy failure</html>", { status: 502 });
    await assert.rejects(
      () => searchEtfInstrumentsApi({ query: "S&P500" }),
      (error) =>
        error instanceof Error &&
        error.message === "Nie udało się wyszukać ETF-ów. Spróbuj ponownie."
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("caches an ETF-only v2 query and deduplicates simultaneous provider calls", async () => {
  let calls = 0;
  let release;
  const provider = {
    searchEtfs: async () => {
      calls += 1;
      await new Promise((resolve) => {
        release = resolve;
      });
      return groupEtfListings("CACHEETF", [
        listing({
          ticker: "CACHEETF",
          figi: "BBG000000111",
          exchCode: "US",
          currency: "USD",
        }),
      ]);
    },
  };
  const query = `cache-etf-${process.pid}-${Date.now()}`;
  const first = searchEtfInstruments(query, provider);
  const second = searchEtfInstruments(query, provider);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  const thirdResult = await searchEtfInstruments(query, provider);

  assert.equal(calls, 1);
  assert.equal(firstResult[0].listings[0].priceStatus, "unchecked");
  assert.deepEqual(secondResult, firstResult);
  assert.deepEqual(thirdResult, firstResult);
});

test("resolves an ETF price only with exact ticker and validated venue, never a first global match", async () => {
  const selected = getSingleListing(
    listing({
      ticker: "VWCE",
      figi: "BBG000000120",
      exchCode: "GR",
      currency: "EUR",
      name: "Vanguard All-World ETF",
    })
  );
  const resolved = await resolveEtfListingPriceSource(selected, async () => [
    {
      symbol: "VWCE.DE",
      providerId: "VWCE.XETRA",
      name: "Vanguard All-World ETF",
      exchange: "XETRA",
      marketCurrency: "EUR",
      isin: "IE00BK5BQT80",
    },
    {
      symbol: "VWCE.F",
      providerId: "VWCE.F",
      name: "Vanguard All-World ETF",
      exchange: "F",
      marketCurrency: "EUR",
    },
  ]);

  assert.equal(resolved.priceStatus, "available");
  assert.equal(resolved.providerPriceSymbol, "VWCE.XETRA");

  const ambiguous = await resolveEtfListingPriceSource(selected, async () => [
    {
      symbol: "VWCE.DE",
      providerId: "VWCE.XETRA",
      name: "Vanguard All-World ETF",
      exchange: "XETRA",
      marketCurrency: "EUR",
    },
    {
      symbol: "VWCE.DE2",
      providerId: "VWCE.XETRA-ALT",
      name: "Vanguard All-World ETF",
      exchange: "XETRA",
      marketCurrency: "EUR",
    },
  ]);

  assert.equal(ambiguous.priceStatus, "unavailable");
  assert.equal(ambiguous.providerPriceSymbol, undefined);
});

test("ETF changes do not alter existing GPW and international stock search fallbacks", () => {
  const dnp = buildTickerFallbackResults("DNP.PL", "stock", "stock-gpw")[0];
  const dia = buildTickerFallbackResults("DIA.PL", "stock", "stock-gpw")[0];
  const dinoCatalog = searchCatalogAssets("Dino Polska", "stock", "stock-gpw")[0];
  const toyota = buildTickerFallbackResults("TM", "stock", "stock-international")[0];

  assert.deepEqual(
    { symbol: dnp.symbol, provider: dnp.provider, currency: dnp.marketCurrency },
    { symbol: "DNP.PL", provider: "stooq", currency: "PLN" }
  );
  assert.deepEqual(
    { symbol: dia.symbol, provider: dia.provider, currency: dia.marketCurrency },
    { symbol: "DIA.PL", provider: "stooq", currency: "PLN" }
  );
  assert.equal(dinoCatalog.name, "Dino Polska");
  assert.equal(toyota.symbol, "TM");
  assert.equal(toyota.kind, "stock");
});
