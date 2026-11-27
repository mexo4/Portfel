import { getPortfolioDividends } from "@/lib/dividend-engine";
import { ESPI_CATEGORY_LABELS, type EspiFeedResponse, type EspiReportSummary } from "@/lib/espi";
import { aggregateCandles, findCandleBar, pickCandleInterval, type CandleInterval, type ChartInstrument } from "@/lib/instrument-chart";
import { ensurePortfolioCoreModel, getPortfolioInstrumentId } from "@/lib/operation-engine";
import { getGpwTickerCore, isGpwSymbol } from "@/lib/ticker";
import type { FxRates, InvestmentPortfolio } from "@/types/portfolio";

/**
 * What happened around a holding, marked under its price: the dividends the user recorded and, for
 * companies listed in Warsaw, their ESPI reports.
 */

export type ChartDividend = {
  kind: "dividend";
  id: string;
  /** Where the mark goes: the ex-dividend day, when the price drops, else the payment day. */
  date: string;
  paymentDate: string;
  exDividendDate: string;
  netAmount: number;
  dividendPerShare: number;
  quantity: number;
  currency: string;
  portfolioName: string;
};

export type ChartAnnouncement = {
  kind: "espi";
  id: string;
  /** The day of publication in Warsaw. */
  date: string;
  publishedAt: string;
  title: string;
  categoryLabel: string;
  reportNumber?: string;
  isCorrection: boolean;
  sourceUrl: string;
};

export type ChartEvent = ChartDividend | ChartAnnouncement;

/** The dividends recorded for the charted instrument in every given portfolio, oldest first. */
export const listChartDividends = (portfolios: InvestmentPortfolio[], instrument: ChartInstrument, fxRates: FxRates): ChartDividend[] =>
  portfolios
    .flatMap((portfolio) => {
      const model = ensurePortfolioCoreModel(portfolio);
      // The id built from the instrument, plus every stored instrument of the same kind and ticker,
      // so a dividend imported as "XTB.PL" also shows on a holding added as "XTB.WA".
      const ids = new Set([
        `${portfolio.id}:instrument:${instrument.key}`,
        getPortfolioInstrumentId(portfolio.id, instrument),
        ...(model.instruments ?? [])
          .filter((item) => item.assetKind === instrument.kind && getGpwTickerCore(item.symbol) === getGpwTickerCore(instrument.symbol))
          .map((item) => item.id),
      ]);
      return getPortfolioDividends(model, fxRates)
        .filter((dividend) => ids.has(dividend.instrumentId))
        .map((dividend): ChartDividend => ({
          kind: "dividend",
          id: `dividend:${portfolio.id}:${dividend.id}`,
          // A form left at its default holds the day of entry, which can be after the payment.
          date: dividend.exDividendDate && dividend.exDividendDate <= dividend.paymentDate ? dividend.exDividendDate : dividend.paymentDate,
          paymentDate: dividend.paymentDate,
          exDividendDate: dividend.exDividendDate,
          netAmount: dividend.netAmount,
          dividendPerShare: dividend.dividendPerShare,
          quantity: dividend.quantity,
          currency: dividend.currency,
          portfolioName: portfolio.name,
        }));
    })
    .sort((left, right) => left.date.localeCompare(right.date));

/** The ticker to ask the ESPI archive about; `null` for anything not listed in Warsaw. */
export const getEspiChartTicker = (instrument: Pick<ChartInstrument, "kind" | "symbol" | "marketCurrency">) =>
  instrument.kind === "stock" && instrument.marketCurrency === "PLN" && isGpwSymbol(instrument.symbol) ? getGpwTickerCore(instrument.symbol) : null;

const warsawDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });
export const toWarsawDay = (iso: string) => warsawDayFormatter.format(new Date(iso));

export const toChartAnnouncement = (report: EspiReportSummary): ChartAnnouncement => ({
  kind: "espi",
  id: report.id,
  date: toWarsawDay(report.publishedAt),
  publishedAt: report.publishedAt,
  title: report.title,
  categoryLabel: ESPI_CATEGORY_LABELS[report.category] ?? ESPI_CATEGORY_LABELS.OTHER,
  ...(report.reportNumber ? { reportNumber: report.reportNumber } : {}),
  isCorrection: report.isCorrection,
  sourceUrl: report.sourceUrl,
});

/** 50 reports a page: enough for years of a company's reports, and a bounded number of requests. */
export const ESPI_CHART_PAGE_SIZE = 50;
export const ESPI_CHART_MAX_PAGES = 6;

export type EspiHistory = {
  items: ChartAnnouncement[];
  /** Older reports exist but were not loaded. */
  isCut: boolean;
};

/**
 * Reads a company's reports newest first, page by page. A company missing on the main market is
 * looked up on NewConnect, which the archive keeps apart.
 */
export const collectEspiHistory = async (
  fetchPage: (request: { market: "GPW" | "NEWCONNECT"; cursor?: string }) => Promise<EspiFeedResponse>
): Promise<EspiHistory> => {
  for (const market of ["GPW", "NEWCONNECT"] as const) {
    const reports: EspiReportSummary[] = [];
    let cursor: string | undefined;
    let hasMore = false;
    for (let page = 0; page < ESPI_CHART_MAX_PAGES; page += 1) {
      const response = await fetchPage({ market, ...(cursor ? { cursor } : {}) });
      reports.push(...response.items);
      cursor = response.nextCursor;
      hasMore = response.hasMore;
      if (!hasMore || !cursor) break;
    }
    if (reports.length > 0) {
      return { items: reports.map(toChartAnnouncement).sort((left, right) => left.publishedAt.localeCompare(right.publishedAt)), isCut: hasMore };
    }
  }
  return { items: [], isCut: false };
};

export type EventSlot<T> = {
  /** The first session of the day, week or month the slot covers. */
  key: string;
  from: string;
  to: string;
  /** The session of the first event. */
  session: string;
  events: T[];
  /** The session of each event, in the same order, so a mark can sit where its event happened. */
  eventSessions: string[];
};

/** An event this long after the last known price still belongs to the last session. */
const MAX_DAYS_AFTER_LAST_SESSION = 7;

const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;

/**
 * Groups events into as many marks as the chart can show apart: one a session, a week or a month,
 * never finer than `minInterval` (the candles drawn). An event on a day without a session joins the
 * session before it, and one just after the last session (a report published before today's close)
 * joins the last one. Events before the first session are left out. `sessions` must be oldest first.
 */
export const placeChartEvents = <T extends { date: string }>(
  sessions: string[],
  events: T[],
  maxSlots: number,
  minInterval: CandleInterval = "D"
): { interval: CandleInterval; slots: EventSlot<T>[] } => {
  const order: CandleInterval[] = ["D", "W", "M"];
  const picked = pickCandleInterval(sessions.length, maxSlots);
  const interval = order[Math.max(order.indexOf(picked), order.indexOf(minInterval))]!;
  if (sessions.length === 0 || events.length === 0) return { interval, slots: [] };

  const buckets = aggregateCandles(sessions.map((date) => ({ date, open: 0, high: 0, low: 0, close: 0 })), interval);
  const sessionBars = sessions.map((date) => ({ date, from: date, to: date, open: 0, high: 0, low: 0, close: 0 }));
  const first = sessions[0]!;
  const last = sessions.at(-1)!;
  const slots = new Map<string, EventSlot<T>>();
  for (const event of [...events].sort((left, right) => left.date.localeCompare(right.date))) {
    if (event.date < first || (event.date > last && daysBetween(last, event.date) > MAX_DAYS_AFTER_LAST_SESSION)) continue;
    const date = event.date > last ? last : event.date;
    const bucket = findCandleBar(buckets, date)!;
    const session = findCandleBar(sessionBars, date)!.from;
    const slot = slots.get(bucket.from);
    if (slot) {
      slot.events.push(event);
      slot.eventSessions.push(session);
    } else slots.set(bucket.from, { key: bucket.from, from: bucket.from, to: bucket.to, session, events: [event], eventSessions: [session] });
  }
  return { interval, slots: [...slots.values()] };
};

/** Heights of the two mark lanes on a hidden 0–1 scale over the plot. */
const LANES = { dividend: 0.105, espi: 0.035 } as const;

export type EventMark = { kind: ChartEvent["kind"]; lane: number; session: string };

/** One mark for each kind of event in a slot, on the day of the first event of that kind. */
export const toEventMarks = <T extends { kind: ChartEvent["kind"] }>(slots: Array<EventSlot<T>>, kind: ChartEvent["kind"]): EventMark[] =>
  slots.flatMap((slot) => {
    const index = slot.events.findIndex((event) => event.kind === kind);
    return index < 0 ? [] : [{ kind, lane: LANES[kind], session: slot.eventSessions[index]! }];
  });

/** Round axis values between `low` and `high`, for a scale whose ends are not round themselves. */
export const niceTicks = (low: number, high: number, count = 6) => {
  const span = high - low;
  if (!(span > 0)) return [low];
  const rough = span / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= rough * (1 - 1e-9))!;
  const ticks: number[] = [];
  for (let index = Math.ceil(low / step - 1e-9); index * step <= high + step * 1e-9; index += 1) ticks.push(Number((index * step).toFixed(10)));
  return ticks;
};

/** The slot whose mark sits inside `from`–`to`, else the one covering `from`. */
export const findEventSlot = <T>(slots: EventSlot<T>[], from: string, to: string = from) =>
  slots.find((slot) => slot.session >= from && slot.session <= to) ?? slots.find((slot) => from >= slot.from && from <= slot.to) ?? null;
