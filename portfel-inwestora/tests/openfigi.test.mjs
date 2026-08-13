import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  groupEtfListings,
  getEtfSearchCacheKey,
  normalizeEtfSearchQuery,
  OpenFigiInstrumentSearchProvider,
  OpenFigiSearchError,
  resolveEtfListingPriceSource,
  sanitiseEtfListing,
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
const liveSpxuFixture = JSON.parse(
  readFileSync(new URL("./fixtures/openfigi-spxu-live.fixture.json", import.meta.url), "utf8")
);

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

test("presents many venue listings as one share-class result and keeps another SPXU share class separate", () => {
  const betaProListings = [
    ["BBG000BCGYS8", "CN"],
    ["BBG000BCH0K9", "CT"],
    ["BBG000BCH2V3", "CJ"],
    ["BBG000BCH403", "TR"],
  ].map(([figi, exchCode]) =>
    listing({
      ticker: "SPXU",
      figi,
      shareClassFIGI: "BBG001S98F69",
      compositeFIGI: "BBG000BCGYS8",
      exchCode,
      currency: "",
      name: "BETAPRO S&P 500 2X DAILY B",
    })
  );
  const distinctShareClass = listing({
    ticker: "SPXU",
    figi: "BBG000000421",
    shareClassFIGI: "BBG001DIFFERENT",
    compositeFIGI: "BBG000000421",
    exchCode: "US",
    currency: "USD",
    name: "PROSHARES ULTRAPRO SHORT S&P500",
  });

  const groups = groupEtfListings("s", [...betaProListings, distinctShareClass]);
  const betaProGroup = groups.find(
    (group) => group.identity.shareClassFigi === "BBG001S98F69"
  );

  assert.equal(groups.length, 2);
  assert.ok(betaProGroup);
  assert.equal(betaProGroup.name, "BETAPRO S&P 500 2X DAILY B");
  assert.equal(betaProGroup.listings.length, 4);
  assert.deepEqual(
    betaProGroup.listings.map((item) => item.instrumentIdentity.figi).sort(),
    ["BBG000BCGYS8", "BBG000BCH0K9", "BBG000BCH2V3", "BBG000BCH403"].sort()
  );
  assert.equal(betaProGroup.listings.find((item) => item.exchangeCode === "CJ")?.subtitle, "Pure Trading");
  assert.equal(
    betaProGroup.listings.find((item) => item.exchangeCode === "TR")?.subtitle,
    "Rynek do potwierdzenia"
  );
  assert.equal(
    groups.some((group) => group.identity.shareClassFigi === "BBG001DIFFERENT"),
    true
  );
});

test("uses the safe live SPXU fixture to verify every returned listing belongs to one share class", () => {
  assert.equal(liveSpxuFixture.source, "OpenFIGI v3 /filter");
  assert.equal(liveSpxuFixture.response.status, 200);
  assert.equal(liveSpxuFixture.response.rawResultCount, 100);
  assert.equal(liveSpxuFixture.items.length, 8);

  for (const item of liveSpxuFixture.items) {
    for (const field of [
      "figi",
      "shareClassFIGI",
      "compositeFIGI",
      "ticker",
      "name",
      "exchCode",
      "securityType",
      "securityType2",
    ]) {
      assert.equal(typeof item[field], "string");
      assert.notEqual(item[field], "");
    }
  }

  const groups = groupEtfListings("s", liveSpxuFixture.items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].identity.shareClassFigi, "BBG001S98F69");
  assert.equal(groups[0].listings.length, 8);
  assert.equal(
    new Set(groups[0].listings.map((listing) => listing.instrumentIdentity.compositeFigi)).size,
    1
  );
  assert.equal(
    new Set(groups[0].listings.map((listing) => listing.instrumentIdentity.securityType)).size,
    1
  );
});

test("ranks exact tickers and ticker prefixes before a name-only match without using listing count", () => {
  const groups = groupEtfListings("sp", [
    listing({
      ticker: "SPY",
      figi: "BBG000000301",
      exchCode: "US",
      currency: "USD",
      name: "SPDR S&P 500 ETF Trust",
    }),
    listing({
      ticker: "BROAD",
      figi: "BBG000000302",
      shareClassFIGI: "BBGSHARECLASS-BROAD",
      exchCode: "US",
      currency: "USD",
      name: "SPDR broad market fund",
    }),
    listing({
      ticker: "BROAD2",
      figi: "BBG000000303",
      shareClassFIGI: "BBGSHARECLASS-BROAD",
      exchCode: "LN",
      currency: "GBP",
      name: "SPDR broad market fund",
    }),
  ]);

  assert.equal(groups[0].listings[0].symbol, "SPY");
  assert.equal(groups[1].listings.length, 2);
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

test("caches an ETF-only v4 query and deduplicates simultaneous provider calls", async () => {
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
  assert.equal(
    getEtfSearchCacheKey(normalizeEtfSearchQuery("  Cache ETF  ")),
    "openfigi:etf:v4:cache etf"
  );
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

test("uses a verified existing ETF catalogue identity when OpenFIGI truncates a GPW ticker", async () => {
  const openFigiMapping = groupEtfListings("PLBTFDP00015", [
    listing({
      ticker: "ETFBDIVP",
      figi: "BBG01WNG89P2",
      shareClassFIGI: "BBG01WNG89W4",
      compositeFIGI: "BBG01WNG89N4",
      exchCode: "PW",
      currency: "",
      name: "BETA ETF DYWIDENDA PLUS",
    }),
  ]);
  const calls = [];
  const provider = {
    searchEtfs: async (query) => {
      calls.push(query);
      return query === "PLBTFDP00015" ? openFigiMapping : [];
    },
  };

  for (const query of [
    "ETFBDIVPL",
    "BETA ETF Dywidenda Plus",
    "Beta ETF Dywidenda Plus Portfelowy Fundusz Inwestycyjny Zamkniety",
    "PLBTFDP00015",
  ]) {
    const [group] = await searchEtfInstruments(query, provider);
    const [listingResult] = group.listings;

    assert.equal(group.listings.length, 1);
    assert.equal(group.name, "Beta ETF Dywidenda Plus");
    assert.deepEqual(
      {
        ticker: listingResult.symbol,
        exchange: listingResult.exchange,
        currency: listingResult.marketCurrency,
        isin: listingResult.isin,
        figi: listingResult.instrumentIdentity.figi,
        shareClassFigi: listingResult.instrumentIdentity.shareClassFigi,
        provider: listingResult.provider,
        providerId: listingResult.providerId,
      },
      {
        ticker: "ETFBDIVPL",
        exchange: "GPW",
        currency: "PLN",
        isin: "PLBTFDP00015",
        figi: "BBG01WNG89P2",
        shareClassFigi: "BBG01WNG89W4",
        provider: "yahoo",
        providerId: "ETFBDIVPL.WA",
      }
    );
  }

  assert.ok(calls.includes("PLBTFDP00015"));
});

test("keeps a pre-verified ETF provider identity when EODHD cannot resolve it", async () => {
  const [group] = await searchEtfInstruments("ETFBDIVPL", {
    searchEtfs: async (query) =>
      query === "PLBTFDP00015"
        ? groupEtfListings(query, [
            listing({
              ticker: "ETFBDIVP",
              figi: "BBG01WNG89P2",
              shareClassFIGI: "BBG01WNG89W4",
              exchCode: "PW",
              currency: "",
              name: "BETA ETF DYWIDENDA PLUS",
            }),
          ])
        : [],
  });
  const resolved = await resolveEtfListingPriceSource(group.listings[0], async () => []);

  assert.equal(resolved.priceStatus, "unchecked");
  assert.equal(resolved.provider, "yahoo");
  assert.equal(resolved.providerId, "ETFBDIVPL.WA");
  assert.equal(resolved.instrumentIdentity.providerPriceSymbol, "ETFBDIVPL.WA");
});

test("keeps a verified ETF catalog price mapping through resolver input sanitisation", () => {
  const trusted = sanitiseEtfListing({
    listingId: "BBG01WNG89P2",
    symbol: "ETFBDIVPL",
    name: "Beta ETF Dywidenda Plus",
    kind: "etf",
    marketCurrency: "PLN",
    provider: "yahoo",
    providerId: "ETFBDIVPL.WA",
    providerPriceSymbol: "ETFBDIVPL.WA",
    isin: "PLBTFDP00015",
    instrumentIdentity: {
      figi: "BBG01WNG89P2",
      ticker: "ETFBDIVPL",
      name: "Beta ETF Dywidenda Plus",
      instrumentType: "ETF",
      exchangeCode: "GPW",
      currency: "PLN",
      providerPriceSymbol: "ETFBDIVPL.WA",
    },
  });

  assert.equal(trusted?.provider, "yahoo");
  assert.equal(trusted?.providerId, "ETFBDIVPL.WA");
  assert.equal(trusted?.instrumentIdentity.providerPriceSymbol, "ETFBDIVPL.WA");

  const mismatched = sanitiseEtfListing({
    ...trusted,
    providerPriceSymbol: "SOMETHING-ELSE",
  });
  assert.equal(mismatched?.providerId, undefined);
  assert.equal(mismatched?.providerPriceSymbol, undefined);
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
