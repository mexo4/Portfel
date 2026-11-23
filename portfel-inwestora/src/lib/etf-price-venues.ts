/**
 * Bloomberg (OpenFIGI) exchange codes for which a price source can be derived.
 *
 * An OpenFIGI ETF listing names its venue with a Bloomberg code and carries no
 * price-provider id. `resolveEtfListingPriceSource` can turn it into an EODHD
 * (`VWRD.LSE`) or Yahoo (`VWRD.L`) symbol only for the venues below. A code
 * outside this set (for example the many MTF/composite codes OpenFIGI lists for
 * one fund) can never get a price series, however it is looked up.
 *
 * Client-safe on purpose: the benchmark picker uses it to put the listings that
 * can work first. `tests/benchmark-search.test.mjs` pins it to the server-side
 * Yahoo venue table, so the two cannot drift apart unnoticed.
 */
export const ETF_PRICE_SOURCE_EXCHANGE_CODES: ReadonlySet<string> = new Set([
  "US",
  "GR",
  "GY",
  "LN",
  "FP",
  "NA",
  "IM",
  "SW",
  "CN",
  "CT",
  "HK",
]);
