import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeCalendarSubscriptionPayload } from "../src/lib/calendar-subscriptions.ts";
import { serializeIcal } from "../src/lib/gpw-ical.ts";
import { resolveCalendarSubscriptionTickers } from "../src/lib/server/calendar-subscriptions.ts";

const portfolio = (id, symbols) => ({
  id, name: id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  assets: symbols.map((symbol, index) => ({
    id: `${id}-${index}`, name: symbol, symbol: `${symbol}.PL`, kind: "stock",
    purchaseDate: "2026-01-01", quantity: 1, purchasePrice: 10,
    purchaseCurrency: "PLN", feePln: 0, marketCurrency: "PLN", provider: "stooq",
    createdAt: "2026-01-01T00:00:00.000Z",
  })), sales: [], realizedAdjustments: [], accounts: [], instruments: [], operations: [],
});

test("subscription payload rejects empty categories, empty manual selection and unsafe portfolio ids", () => {
  assert.equal(normalizeCalendarSubscriptionPayload({ name: "x", scope: "MANUAL", categories: ["reports"], portfolioIds: [], manualTickers: [] }), null);
  assert.equal(normalizeCalendarSubscriptionPayload({ name: "x", scope: "PORTFOLIO", categories: [], portfolioIds: [], manualTickers: [] }), null);
  assert.equal(normalizeCalendarSubscriptionPayload({ name: "x", scope: "PORTFOLIO", categories: ["reports"], portfolioIds: ["../other"], manualTickers: [] }), null);
});

test("dynamic portfolio and watchlist scopes resolve current membership without duplicates", () => {
  const context = {
    portfolios: [portfolio("one", ["DNP", "PKN"]), portfolio("two", ["KGH", "DNP"])],
    portfolioOptions: [{ id: "one", name: "one" }, { id: "two", name: "two" }],
    watchlistTickers: ["CDR", "DNP"], allGpwIssuerCount: 400,
  };
  assert.deepEqual(resolveCalendarSubscriptionTickers("PORTFOLIO", ["one"], [], context), ["DNP", "PKN"]);
  assert.deepEqual(resolveCalendarSubscriptionTickers("PORTFOLIO", [], [], context), ["DNP", "KGH", "PKN"]);
  assert.deepEqual(resolveCalendarSubscriptionTickers("WATCHLIST", [], [], context), ["CDR", "DNP"]);
  assert.deepEqual(resolveCalendarSubscriptionTickers("PORTFOLIO_AND_WATCHLIST", ["two"], [], context), ["CDR", "DNP", "KGH"]);
  context.portfolios[1].assets = [];
  assert.deepEqual(resolveCalendarSubscriptionTickers("PORTFOLIO", ["two"], [], context), []);
});

test("private ICS does not expose portfolio tickers in calendar metadata", () => {
  const sourceUrl = "https://mexo.com.pl/api/calendar/feed/private-token";
  const ics = serializeIcal([], ["reports", "meetings"], [], { sourceUrl, title: "Mexo — Mój portfel" });
  assert.match(ics, /SOURCE;VALUE=URI:https:\/\/mexo\.com\.pl\/api\/calendar\/feed\/private-token/);
  assert.match(ics, /X-WR-CALNAME:Mexo — Mój portfel/);
  assert.doesNotMatch(ics, /DNP|PKN|tickers=/);
});

test("saved subscriptions use hashed lookup, owner checks and revocable stable links", async () => {
  const [server, db, itemRoute, feedRoute] = await Promise.all([
    readFile(new URL("../src/lib/server/calendar-subscriptions.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/db.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/calendar/subscriptions/[subscriptionId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/calendar/feed/[token]/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(db, /CREATE TABLE IF NOT EXISTS user_calendar_subscriptions/);
  assert.match(db, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(server, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(server, /WHERE token_hash=\$1 AND revoked_at IS NULL/);
  assert.match(server, /WHERE id=\$1 AND user_id=\$2 AND revoked_at IS NULL/);
  assert.match(itemRoute, /revokeCalendarSubscription/);
  assert.match(feedRoute, /getCalendarSubscriptionByToken/);
  assert.doesNotMatch(feedRoute, /getCurrentAuthenticatedUser/);
});
