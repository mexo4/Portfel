# GPW session calendar

Module: `src/lib/gpw-market-calendar.ts` (tests: `tests/gpw-market-calendar.test.mjs`,
fixture: `tests/fixtures/gpw-official-non-session-days.mjs`).

Consumers: quote freshness (`isFreshGpwMarketPrice`, `getLatestCompletedGpwSessionDate` in
`src/lib/server/market-data.ts`), TWR history-gap detection (`getHistoryTradingDayPredicate` in
`src/lib/server/portfolio-history.ts`) and the dashboard "day without a session" note.
It is **not** used by the public events calendar (reports, dividends, general meetings).

## How GPW decides which days have no session

Regulamin Giełdy §120–§122 (consolidated text as of 16 Aug 2025): sessions are held Monday to
Friday, 8:30–17:05, according to a schedule set by the Exchange Management Board; the Board
determines the days and may cancel a session for important reasons. The Board does this in a
resolution per year ("w sprawie określenia dni w roku …, w których nie odbędą się sesje giełdowe
i notowania w alternatywnym systemie obrotu"), usually adopted in June–July of the preceding year.

The resolutions contain statutory holidays that fall on a weekday **and** days the Board closes
the exchange although they are not statutory: Good Friday, 24 December and 31 December. The
calendar is therefore not "Polish public holidays + Good Friday". Weekend dates are never listed.

## Basis of every year

`getGpwCalendarYearBasis(year)` tells how far a year can be trusted:

| Basis | Years | Meaning |
|---|---|---|
| `OFFICIAL` | 2022–2028 | taken verbatim from a Management Board resolution (primary source, PDF on gpw.pl) |
| `DERIVED_UNVERIFIED` | up to 2021 | rule-based derivation (`deriveGpwNonTradingDays`), **not** confirmed by a primary source here |
| `PROJECTED` | 2029 and later | forecast until GPW publishes the resolution; not confirmed |

Official resolutions used (weekday lists in `OFFICIAL_GPW_NON_SESSION_WEEKDAYS`):

| Year | Resolution | Adopted | URL |
|---|---|---|---|
| 2022 | 593/2021 | 2021-06-10 | https://www.gpw.pl/pub/GPW/uchwaly/2021/593_2021.pdf |
| 2023 | 509/2022 | 2022-06-02 | https://www.gpw.pl/pub/GPW/uchwaly/2022/509_2022.pdf |
| 2024 | 571/2023 | 2023-06-15 | https://www.gpw.pl/pub/GPW/uchwaly/2023/571_2023.pdf |
| 2025 | 701/2024 | 2024-06-06 | https://gpw.pl/pub/GPW/uchwaly/2024/701_2024.pdf |
| 2026 | 753/2025 | 2025-06-12 | https://www.gpw.pl/pub/GPW/uchwaly/2025/753_2025.pdf |
| 2027 | 754/2025 | 2025-06-12 | https://www.gpw.pl/pub/GPW/uchwaly/2025/754_2025.pdf |
| 2028 | 1089/2026 | 2026-07-20 | https://www.gpw.pl/pub/GPW/uchwaly/2026/1089_2026.pdf |

## Evidence levels

* **A – primary**: GPW resolutions/notices published on gpw.pl, Regulamin Giełdy.
* **B – resolution text reproduced by media** (PAP/WP.pl, Strefa Inwestorów); the PDF could not be
  retrieved: 609/2009 [2010], 1255/2010 [2011], 807/2012 [2013], 812/2013 [2014], 545/2019 [2020].
  Not used by any conformance test.
* **C – secondary/context**: press, statutes, market data. **Never proof on its own.** Absence of
  trading volume in a data vendor's history is not evidence that a session was not held.

## Status per claim

| Claim | A | B | C | Status |
|---|---|---|---|---|
| Statutory holidays, Easter Monday, Corpus Christi, Good Friday are non-session days | all 7 lists | all 5 lists consistent | – | **CONFIRMED** 2022–2028; derived elsewhere |
| 24 December is a non-session day | 2024–2027 | 2010, 2013, 2014, 2020 | – | **CONFIRMED** 2024–2027; level B for 2010, 2013, 2014, 2020; **UNVERIFIED** for other years |
| 31 December is a non-session day | 2024–2027 | 2020 lists it; 609/2009 (2010) does not | – | **CONFIRMED** 2024–2027; session in 2010 only level B |
| 31 December 2012–2019 | – | 807/2012 (2013) and 812/2013 (2014) do **not** list it | press reports (rp.pl/Bankier for 2013, money.pl for 2014) say 30 December was the last session | **CONFLICT / UNVERIFIED** – no primary document explains it. The derived rule treats it as closed from 2012; that is a derivation, not a finding |
| 6 January is a non-session day | 2022, 2023, 2025–2028 | 1255/2010 (2011), 812/2013 (2014), 545/2019 (2020) list it; 609/2009 (2010) does not | statutory holiday from 2011 (Dz.U. 2010 nr 224 poz. 1459, confirm in ISAP) | **CONFIRMED** where level A exists; the 2011 threshold is level B/C; before 2011 **UNVERIFIED** |
| 12 November 2018 had no session | GPW notice of 2018-11-02 (https://www.gpw.pl/news?cmn_id=107609): Board resolution of 2018-10-31; no resolution number given | – | Act of 7 Nov 2018, Dz.U. 2018 poz. 2117 (number to confirm in ISAP) | **CONFIRMED** (`GPW_EXTRAORDINARY_NON_TRADING_DAYS`) |
| Latest session counts as completed at 17:15 Warsaw time | Regulamin §120: sessions end 17:05 | – | – | unchanged 10-minute buffer, not otherwise verified |

## Not established / not modelled

* 31 December in 2012–2019 (conflict above).
* Resolutions for 2012, 2015–2019 and 2021 were not obtained; earlier years were not researched.
  Years before 2010 are not covered by any claim here.
* Unexplained days without trading volume in a vendor's history (for example 2011-12-08,
  2012-10-30, 2012-12-11, 2013-04-16, 2018-01-02, 2018-01-30, 2026-10-05, 2026-10-06) were **not**
  turned into closures: there is no primary source for them. 5–6 October 2026 coincide with the
  announced launch of GPW's new WATS trading system (press reports); no GPW notice confirming
  whether sessions were held or cancelled on those days was found, so the module keeps them
  as sessions, as the 2026 resolution does.
* Shortened sessions, trading halts and other unscheduled interruptions.
* Years from 2029 are a forecast.

## Adding a year

1. When GPW publishes the resolution (gpw.pl, "Dni bez sesji"), copy the weekday list into
   `OFFICIAL_GPW_NON_SESSION_WEEKDAYS` (comment: number, date, URL) and into
   `tests/fixtures/gpw-official-non-session-days.mjs`.
2. Run `tests/gpw-market-calendar.test.mjs`. The test "the rule-based derivation reproduces the
   resolution" fails if GPW deviated from the rule; fix the rule only with evidence.
3. A one-off cancellation announced by GPW goes to `GPW_EXTRAORDINARY_NON_TRADING_DAYS` together
   with the notice it comes from.

## Related calendars (not changed here)

* `src/lib/market-session-calendar.ts`: Xetra/Frankfurt holidays.
* `src/lib/server/treasury-bonds.ts` (`getPolishHolidays`): business days for retail-bond
  redemption settlement. It does not know 24 December, a statutory day off since 2025; whether the
  issuer's definition of a business day follows that has to be confirmed before changing it.
