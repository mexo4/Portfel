import assert from "node:assert/strict";
import test from "node:test";
import {
  GPW_EXTRAORDINARY_NON_TRADING_DAYS,
  OFFICIAL_GPW_NON_SESSION_WEEKDAYS,
  deriveGpwNonTradingDays,
  getGpwCalendarYearBasis,
  getGpwNonTradingDays,
  getLatestCompletedGpwSessionDate,
  getWarsawMarketClock,
  isCurrentWarsawDayGpwSession,
  isFreshGpwMarketPrice,
  isGpwTradingDay,
  shiftCalendarDate,
} from "../src/lib/gpw-market-calendar.ts";
import {
  GPW_EXTRAORDINARY_CLOSURE_2018,
  OFFICIAL_GPW_RESOLUTIONS,
} from "./fixtures/gpw-official-non-session-days.mjs";

/*
 * Test groups are tagged by the strength of the evidence behind them:
 *  [OFFICIAL]            years covered by a GPW resolution available as a primary
 *                        source (tests/fixtures/gpw-official-non-session-days.mjs);
 *  [DERIVED – unverified] past years without such a resolution: the tests only pin
 *                        the documented rule and are NOT confirmation by GPW;
 *  [PROJECTED]           years after the last published resolution: invariants only.
 * Conformance with official calendars is asserted for [OFFICIAL] years exclusively.
 */

const dayOfWeek = (date) => new Date(`${date}T12:00:00.000Z`).getUTCDay();
const isWeekday = (date) => dayOfWeek(date) !== 0 && dayOfWeek(date) !== 6;
const eachDayOfYear = (year) => {
  const days = [];
  for (let date = `${year}-01-01`; date.startsWith(`${year}-`); date = shiftCalendarDate(date, 1)) days.push(date);
  return days;
};

test("[OFFICIAL] the code table holds exactly the years and weekday lists of the fixture", () => {
  assert.deepEqual(
    Object.keys(OFFICIAL_GPW_NON_SESSION_WEEKDAYS).map(Number).sort(),
    OFFICIAL_GPW_RESOLUTIONS.map(({ year }) => year).sort()
  );
  for (const { year, weekdays } of OFFICIAL_GPW_RESOLUTIONS) {
    assert.deepEqual([...OFFICIAL_GPW_NON_SESSION_WEEKDAYS[year]], weekdays, `list for ${year}`);
    assert.equal(getGpwCalendarYearBasis(year), "OFFICIAL");
    assert.ok(weekdays.every(isWeekday), `GPW lists weekdays only (${year})`);
    assert.ok(weekdays.every((date) => date.startsWith(`${year}-`)), `dates belong to ${year}`);
  }
});

for (const { year, resolution, weekdays } of OFFICIAL_GPW_RESOLUTIONS) {
  test(`[OFFICIAL] ${year} (Uchwała ${resolution}): isGpwTradingDay is false exactly on the listed weekdays and on weekends`, () => {
    const closed = new Set(weekdays);
    for (const date of eachDayOfYear(year)) {
      const expected = isWeekday(date) && !closed.has(date);
      assert.equal(isGpwTradingDay(date), expected, `${date}`);
    }
  });

  test(`[OFFICIAL] ${year} (Uchwała ${resolution}): getGpwNonTradingDays holds the listed weekdays`, () => {
    const weekdayClosures = [...getGpwNonTradingDays(year)].filter(isWeekday).sort();
    assert.deepEqual(weekdayClosures, [...weekdays].sort());
  });

  test(`[OFFICIAL] ${year} (Uchwała ${resolution}): the rule-based derivation reproduces the resolution`, () => {
    const derived = [...deriveGpwNonTradingDays(year)].filter(isWeekday).sort();
    assert.deepEqual(derived, [...weekdays].sort());
  });
}

test("[OFFICIAL] GPW is closed on 24 and 31 December, which are not statutory holidays", () => {
  for (const date of ["2024-12-24", "2024-12-31", "2025-12-24", "2025-12-31", "2026-12-24", "2026-12-31", "2027-12-24", "2027-12-31"]) {
    assert.equal(isGpwTradingDay(date), false, date);
  }
  for (const date of ["2024-12-23", "2024-12-27", "2024-12-30", "2025-12-30", "2026-12-30", "2027-12-30"]) {
    assert.equal(isGpwTradingDay(date), true, date);
  }
});

test("[OFFICIAL] latest completed session across the year boundary and the 17:15 close buffer (CET)", () => {
  const cases = [
    ["2024-12-25T12:00:00.000Z", "2024-12-23"], // 24.12 closed, 25–26.12 holidays
    ["2025-01-01T12:00:00.000Z", "2024-12-30"], // 31.12.2024 closed
    ["2025-12-30T16:14:59.000Z", "2025-12-29"], // 17:14:59 CET, session not completed yet
    ["2025-12-30T16:15:00.000Z", "2025-12-30"], // 17:15 CET
    ["2025-12-31T12:00:00.000Z", "2025-12-30"], // 31.12.2025 closed
    ["2026-01-01T12:00:00.000Z", "2025-12-30"],
    ["2026-01-02T12:00:00.000Z", "2025-12-30"], // Friday 13:00, session not completed yet
    ["2026-01-02T16:15:00.000Z", "2026-01-02"],
    ["2026-12-31T20:00:00.000Z", "2026-12-30"],
    ["2027-01-04T08:00:00.000Z", "2026-12-30"], // Mon 09:00 after 31.12, 1.01 and a weekend
    ["2027-01-04T16:15:00.000Z", "2027-01-04"],
  ];
  for (const [instant, expected] of cases) {
    assert.equal(getLatestCompletedGpwSessionDate(new Date(instant)), expected, instant);
  }
});

test("[OFFICIAL] a quote from 30.12 stays fresh through the closed 31.12 and 1.01", () => {
  const newYearsDay = new Date("2026-01-01T12:00:00.000Z");
  assert.equal(isFreshGpwMarketPrice("2025-12-30", newYearsDay), true);
  assert.equal(isFreshGpwMarketPrice("2025-12-31", newYearsDay), false);
  assert.equal(isFreshGpwMarketPrice(undefined, newYearsDay), false);

  assert.equal(isCurrentWarsawDayGpwSession(new Date("2026-12-31T10:00:00.000Z")), false);
  assert.equal(isCurrentWarsawDayGpwSession(new Date("2026-12-30T10:00:00.000Z")), true);
});

test("[OFFICIAL] the Warsaw clock handles summer time, midnight and the DST change days", () => {
  assert.deepEqual(getWarsawMarketClock(new Date("2026-12-31T23:30:00.000Z")), { date: "2027-01-01", minute: 30 });
  assert.deepEqual(getWarsawMarketClock(new Date("2026-06-30T22:30:00.000Z")), { date: "2026-07-01", minute: 30 });

  const summer = [
    ["2026-07-01T15:14:59.000Z", "2026-06-30"], // 17:14:59 CEST
    ["2026-07-01T15:15:00.000Z", "2026-07-01"], // 17:15 CEST
    ["2026-06-30T22:30:00.000Z", "2026-06-30"], // 00:30 on 1.07, session of 1.07 not started
    ["2026-03-30T08:00:00.000Z", "2026-03-27"], // Monday after the DST start (Sun 29.03)
    ["2026-10-26T08:00:00.000Z", "2026-10-23"], // Monday after the DST end (Sun 25.10)
  ];
  for (const [instant, expected] of summer) {
    assert.equal(getLatestCompletedGpwSessionDate(new Date(instant)), expected, instant);
  }
});

test("[OFFICIAL notice] 12.11.2018 is a day without a session (extraordinary cancellation)", () => {
  assert.deepEqual([...GPW_EXTRAORDINARY_NON_TRADING_DAYS], [GPW_EXTRAORDINARY_CLOSURE_2018.date]);
  assert.equal(isGpwTradingDay(GPW_EXTRAORDINARY_CLOSURE_2018.date), false);
  assert.equal(getGpwNonTradingDays(2018).has("2018-11-12"), true);
  assert.equal(getGpwNonTradingDays(2019).has("2018-11-12"), false);
  for (const date of GPW_EXTRAORDINARY_NON_TRADING_DAYS) {
    assert.equal(new Date(`${date}T12:00:00.000Z`).toISOString().slice(0, 10), date, "a valid ISO calendar date");
    assert.ok(isWeekday(date), "an extraordinary closure only matters on a weekday");
  }
});

test("Easter-based non-session days follow the Gregorian computus (2020–2030)", () => {
  const easterSundays = {
    2020: "2020-04-12", 2021: "2021-04-04", 2022: "2022-04-17", 2023: "2023-04-09",
    2024: "2024-03-31", 2025: "2025-04-20", 2026: "2026-04-05", 2027: "2027-03-28",
    2028: "2028-04-16", 2029: "2029-04-01", 2030: "2030-04-21",
  };
  for (const [year, easter] of Object.entries(easterSundays)) {
    const derived = deriveGpwNonTradingDays(Number(year));
    assert.equal(derived.has(shiftCalendarDate(easter, -2)), true, `Good Friday ${year}`);
    assert.equal(derived.has(shiftCalendarDate(easter, 1)), true, `Easter Monday ${year}`);
    assert.equal(derived.has(shiftCalendarDate(easter, 60)), true, `Corpus Christi ${year}`);
    assert.equal(derived.has(easter), false, `Easter Sunday is not a separate closure (${year})`);
  }
});

test("calendar-date arithmetic is stable over month, year, leap-day and DST boundaries", () => {
  assert.equal(shiftCalendarDate("2028-02-28", 1), "2028-02-29");
  assert.equal(shiftCalendarDate("2028-02-29", 1), "2028-03-01");
  assert.equal(shiftCalendarDate("2027-02-28", 1), "2027-03-01");
  assert.equal(shiftCalendarDate("2026-12-31", 1), "2027-01-01");
  assert.equal(shiftCalendarDate("2027-01-01", -1), "2026-12-31");
  assert.equal(shiftCalendarDate("2026-03-28", 2), "2026-03-30");
  assert.equal(shiftCalendarDate("2026-10-24", 2), "2026-10-26");
  assert.equal(isGpwTradingDay("2028-02-29"), true); // Tuesday, a leap day
});

test("[DERIVED – unverified] years without a resolution in the code are reported as derived, not official", () => {
  for (const year of [2010, 2011, 2013, 2014, 2018, 2020, 2021]) {
    assert.equal(getGpwCalendarYearBasis(year), "DERIVED_UNVERIFIED", String(year));
  }
});

test("[DERIVED – unverified] pins the documented rule; this is NOT a confirmation by a GPW primary source", () => {
  // Epiphany: threshold 2011 (statute); the 2010 and 2011 resolution texts were only available via media (level B).
  assert.equal(isGpwTradingDay("2009-01-06"), true); // Tuesday
  assert.equal(isGpwTradingDay("2010-01-06"), true); // Wednesday
  assert.equal(isGpwTradingDay("2011-01-06"), false); // Thursday
  // 24 December: closed by Board decision in every year of the rule.
  assert.equal(isGpwTradingDay("2018-12-24"), false); // Monday
  assert.equal(isGpwTradingDay("2021-12-24"), false); // Friday
  // 31 December: threshold 2012; 2012–2019 is UNVERIFIED and CONFLICTING (see docs/gpw-session-calendar.md).
  assert.equal(isGpwTradingDay("2010-12-31"), true); // Friday
  assert.equal(isGpwTradingDay("2012-12-31"), false); // Monday
});

test("[PROJECTED] years after the last published resolution are flagged as a forecast, with only invariants asserted", () => {
  const lastOfficialYear = Math.max(...OFFICIAL_GPW_RESOLUTIONS.map(({ year }) => year));
  assert.equal(getGpwCalendarYearBasis(lastOfficialYear), "OFFICIAL");
  for (const year of [lastOfficialYear + 1, lastOfficialYear + 2, 2035]) {
    assert.equal(getGpwCalendarYearBasis(year), "PROJECTED", String(year));
    assert.equal(getGpwNonTradingDays(year), getGpwNonTradingDays(year), "cached per year");
    assert.ok(getGpwNonTradingDays(year).size > 0);
    for (const date of eachDayOfYear(year)) {
      if (!isWeekday(date)) assert.equal(isGpwTradingDay(date), false, `weekend ${date}`);
    }
  }
});

test("invalid calendar input fails loudly instead of returning a guess", () => {
  assert.throws(() => getGpwNonTradingDays(Number.NaN), RangeError);
  assert.throws(() => getGpwNonTradingDays(2026.5), RangeError);
  assert.throws(() => isGpwTradingDay("garbage"), RangeError);
});
