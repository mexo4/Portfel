import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_RANGE_INCREMENTAL_REFRESH_INTERVAL_MS,
  migrateLegacyHistoryRangeCache,
  resolveHistoryRangeCache,
} from "../src/lib/portfolio-history-range-cache.ts";

const point = (date, close) => ({ date, close });
const calendarDaysInclusive = (startDate, endDate) => {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
};
const payload = (points, { startDate = "2025-01-01", endDate, fullRefreshAt } = {}) => ({
  version: 1,
  startDate,
  endDate: endDate ?? points.at(-1)?.date ?? startDate,
  fullRefreshAt: fullRefreshAt ?? "2025-01-01T00:00:00.000Z",
  points,
});
const cacheEntry = (value, updatedAt) => ({ payload: value, updatedAt });

test("a valid legacy exact-range cache seeds the stable incremental cache", async () => {
  const legacy = cacheEntry(
    [point("2025-01-01", 10), { date: "invalid", close: 100 }, point("2025-01-10", 11)],
    "2025-01-10T12:00:00.000Z",
  );
  const migrated = migrateLegacyHistoryRangeCache(legacy, "2025-01-01", "2025-01-10");

  assert.equal(migrated.updatedAt, legacy.updatedAt);
  assert.deepEqual(migrated.payload, {
    version: 1,
    startDate: "2025-01-01",
    endDate: "2025-01-10",
    fullRefreshAt: legacy.updatedAt,
    points: [point("2025-01-01", 10), point("2025-01-10", 11)],
  });
  const seededResult = await resolveHistoryRangeCache({
    cached: migrated,
    startDate: "2025-01-01",
    endDate: "2025-01-10",
    now: Date.parse("2025-01-10T12:05:00.000Z"),
    fetchRange: async () => {
      throw new Error("fresh legacy cache should not trigger a provider fetch");
    },
  });
  assert.equal(seededResult.cacheStatus, "hit");
  assert.equal(migrateLegacyHistoryRangeCache(cacheEntry([], legacy.updatedAt), "2025-01-01", "2025-01-10"), null);
});

test("history range cache fetches and stores an initial complete range", async () => {
  const now = Date.parse("2025-01-10T12:00:00.000Z");
  let requestedRange;
  const result = await resolveHistoryRangeCache({
    startDate: "2025-01-01",
    endDate: "2025-01-10",
    now,
    fetchRange: async (from, to) => {
      requestedRange = [from, to];
      return [point("2025-01-01", 10), point("2025-01-10", 11)];
    },
  });

  assert.equal(result.cacheStatus, "full");
  assert.deepEqual(requestedRange, ["2025-01-01", "2025-01-10"]);
  assert.equal(result.payload.endDate, "2025-01-10");
  assert.equal(result.payload.fullRefreshAt, new Date(now).toISOString());
  assert.deepEqual(result.payload.points, [point("2025-01-01", 10), point("2025-01-10", 11)]);
});

test("fresh covered history is reused without a provider request", async () => {
  const now = Date.parse("2025-01-10T12:00:00.000Z");
  const cached = cacheEntry(
    payload([point("2025-01-01", 10), point("2025-01-10", 11)], {
      endDate: "2025-01-10",
      fullRefreshAt: new Date(now - 60_000).toISOString(),
    }),
    new Date(now - 60_000).toISOString(),
  );
  let fetchCount = 0;
  const result = await resolveHistoryRangeCache({
    cached,
    startDate: "2025-01-01",
    endDate: "2025-01-10",
    now,
    fetchRange: async () => {
      fetchCount += 1;
      return [];
    },
  });

  assert.equal(result.cacheStatus, "hit");
  assert.equal(fetchCount, 0);
  assert.deepEqual(result.payload, cached.payload);
});

test("daily extension refreshes an overlapping tail and preserves corrected history", async () => {
  const now = Date.parse("2025-01-11T12:00:00.000Z");
  const cached = cacheEntry(
    payload(
      [point("2025-01-01", 10), point("2025-01-04", 12), point("2025-01-10", 14)],
      { endDate: "2025-01-10", fullRefreshAt: "2025-01-10T12:00:00.000Z" },
    ),
    "2025-01-10T12:00:00.000Z",
  );
  let requestedRange;
  const result = await resolveHistoryRangeCache({
    cached,
    startDate: "2025-01-01",
    endDate: "2025-01-11",
    now,
    fetchRange: async (from, to) => {
      requestedRange = [from, to];
      return [point("2025-01-04", 13), point("2025-01-11", 15)];
    },
  });

  assert.equal(result.cacheStatus, "tail");
  assert.deepEqual(requestedRange, ["2025-01-03", "2025-01-11"]);
  assert.equal(result.payload.endDate, "2025-01-11");
  assert.deepEqual(result.payload.points, [
    point("2025-01-01", 10),
    point("2025-01-04", 13),
    point("2025-01-10", 14),
    point("2025-01-11", 15),
  ]);
});

test("a next-day refresh downloads only the overlapping tail of a long history", async () => {
  const startDate = "2025-08-01";
  const previousEndDate = "2026-10-31";
  const requestedEndDate = "2026-11-01";
  const now = Date.parse("2026-11-01T12:00:00.000Z");
  const cached = cacheEntry(
    payload([point(startDate, 10), point(previousEndDate, 14)], {
      startDate,
      endDate: previousEndDate,
      fullRefreshAt: "2026-10-31T00:00:00.000Z",
    }),
    "2026-10-31T00:00:00.000Z",
  );
  let requestedRange;
  const result = await resolveHistoryRangeCache({
    cached,
    startDate,
    endDate: requestedEndDate,
    now,
    fetchRange: async (from, to) => {
      requestedRange = [from, to];
      return [point(requestedEndDate, 15)];
    },
  });

  const fullRangeDays = calendarDaysInclusive(startDate, requestedEndDate);
  const tailRangeDays = calendarDaysInclusive(...requestedRange);
  assert.equal(result.cacheStatus, "tail");
  assert.ok(tailRangeDays < fullRangeDays / 40);
  assert.equal(fullRangeDays, 458);
  assert.equal(tailRangeDays, 9);
});

test("stale short-range request does not shrink already cached coverage", async () => {
  const now = Date.parse("2025-01-11T12:00:00.000Z");
  const cached = cacheEntry(
    payload(
      [point("2025-01-01", 10), point("2025-01-04", 12), point("2025-01-10", 14)],
      { endDate: "2025-01-10", fullRefreshAt: "2025-01-10T12:00:00.000Z" },
    ),
    "2025-01-10T12:00:00.000Z",
  );
  let requestedRange;
  const result = await resolveHistoryRangeCache({
    cached,
    startDate: "2025-01-01",
    endDate: "2025-01-08",
    now,
    fetchRange: async (from, to) => {
      requestedRange = [from, to];
      return [point("2025-01-04", 13), point("2025-01-10", 15)];
    },
  });

  assert.equal(result.cacheStatus, "tail");
  assert.deepEqual(requestedRange, ["2025-01-03", "2025-01-10"]);
  assert.equal(result.payload.endDate, "2025-01-10");
  assert.deepEqual(result.payload.points.at(-1), point("2025-01-10", 15));
});

test("history is fully refreshed after the incremental refresh interval", async () => {
  const now = Date.parse("2025-01-20T12:00:00.000Z");
  const cached = cacheEntry(
    payload([point("2025-01-01", 10), point("2025-01-10", 14)], {
      endDate: "2025-01-10",
      fullRefreshAt: "2025-01-01T00:00:00.000Z",
    }),
    "2025-01-19T12:00:00.000Z",
  );
  let requestedRange;
  const result = await resolveHistoryRangeCache({
    cached,
    startDate: "2025-01-01",
    endDate: "2025-01-20",
    now,
    fetchRange: async (from, to) => {
      requestedRange = [from, to];
      return [point("2025-01-01", 9), point("2025-01-20", 16)];
    },
  });

  assert.equal(HISTORY_RANGE_INCREMENTAL_REFRESH_INTERVAL_MS, 7 * 24 * 60 * 60 * 1_000);
  assert.equal(result.cacheStatus, "full");
  assert.deepEqual(requestedRange, ["2025-01-01", "2025-01-20"]);
  assert.deepEqual(result.payload.points, [point("2025-01-01", 9), point("2025-01-20", 16)]);
  assert.equal(result.payload.fullRefreshAt, new Date(now).toISOString());
});

test("an empty full-refresh response preserves previously verified history", async () => {
  const now = Date.parse("2025-01-20T12:00:00.000Z");
  const verifiedPoints = [point("2025-01-01", 10), point("2025-01-10", 14)];
  const cached = cacheEntry(
    payload(verifiedPoints, {
      endDate: "2025-01-10",
      fullRefreshAt: "2025-01-01T00:00:00.000Z",
    }),
    "2025-01-19T12:00:00.000Z",
  );
  const result = await resolveHistoryRangeCache({
    cached,
    startDate: "2025-01-01",
    endDate: "2025-01-20",
    now,
    fetchRange: async () => [],
  });

  assert.equal(result.cacheStatus, "stale");
  assert.deepEqual(result.payload.points, verifiedPoints);
  assert.equal(result.payload.endDate, "2025-01-10");
  assert.equal(result.payload.fullRefreshAt, "2025-01-01T00:00:00.000Z");
});

test("negative cache is reused only while it covers the requested range and remains fresh", async () => {
  const now = Date.parse("2025-01-10T12:05:00.000Z");
  const cached = cacheEntry(
    payload([], {
      endDate: "2025-01-10",
      fullRefreshAt: "2025-01-10T12:00:00.000Z",
    }),
    "2025-01-10T12:00:00.000Z",
  );
  let fetchCount = 0;
  const hit = await resolveHistoryRangeCache({
    cached,
    startDate: "2025-01-01",
    endDate: "2025-01-10",
    now,
    fetchRange: async () => {
      fetchCount += 1;
      return [];
    },
  });
  const extended = await resolveHistoryRangeCache({
    cached,
    startDate: "2025-01-01",
    endDate: "2025-01-11",
    now,
    fetchRange: async () => {
      fetchCount += 1;
      return [point("2025-01-11", 15)];
    },
  });

  assert.equal(hit.cacheStatus, "hit");
  assert.equal(extended.cacheStatus, "full");
  assert.equal(fetchCount, 1);
});
