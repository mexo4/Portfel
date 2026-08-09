import assert from "node:assert/strict";
import test from "node:test";
import {
  getLatestCompletedGpwSessionDate,
  isFreshGpwMarketPrice,
  parseStooqCsvQuote,
  parseStooqHistorySnapshot,
} from "../src/lib/server/market-data.ts";

test("parses the Stooq live close by header and retains its market date", () => {
  const quote = parseStooqCsvQuote([
    "Symbol,Date,Time,Open,High,Low,Close,Volume",
    "DNP.WA,2026-08-07,17:00:00,28.10,29.20,27.80,28.78,12345",
  ].join("\n"));

  assert.deepEqual(quote, {
    price: 28.78,
    priceDate: "2026-08-07",
    marketTimestamp: "2026-08-07T17:00:00",
  });
});

test("selects the newest valid daily Stooq row rather than the last physical row", () => {
  const quote = parseStooqHistorySnapshot([
    "Data,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie,Wolumen",
    "2026-08-07,28.10,29.20,27.80,28.78,12345",
    "2026-08-06,29.10,30.00,28.90,29.20,45678",
    "2026-08-05,30.20,30.50,29.40,29.60,67890",
  ].join("\n"));

  assert.deepEqual(quote, {
    price: 28.78,
    previousClose: 29.2,
    priceDate: "2026-08-07",
  });
});

test("rejects a browser-verification page as a Stooq price response", () => {
  const verificationPage = "<!doctype html><html><title>Weryfikacja przegladarki</title></html>";

  assert.equal(parseStooqCsvQuote(verificationPage), null);
  assert.equal(parseStooqHistorySnapshot(verificationPage), null);
});

test("uses the most recent completed GPW session across weekends and holidays", () => {
  const saturday = new Date("2026-08-08T12:00:00.000Z");
  assert.equal(getLatestCompletedGpwSessionDate(saturday), "2026-08-07");
  assert.equal(isFreshGpwMarketPrice("2026-08-07", saturday), true);
  assert.equal(isFreshGpwMarketPrice("2026-08-06", saturday), false);

  const easterSaturday = new Date("2026-04-04T12:00:00.000Z");
  assert.equal(getLatestCompletedGpwSessionDate(easterSaturday), "2026-04-02");

  const mondayAfterClose = new Date("2026-08-10T16:00:00.000Z");
  assert.equal(getLatestCompletedGpwSessionDate(mondayAfterClose), "2026-08-10");
});
