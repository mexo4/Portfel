"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EventTooltipLines, LANE_ROOM, describeDividendDates, maxEventSlots } from "@/components/chart-event-parts";
import InstrumentCandleChart from "@/components/InstrumentCandleChart";
import { AXIS, BUY, MAX, MIN, PRICE, SELL, eventDots, monthTick, tradeDots } from "@/components/instrument-chart-parts";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { useChartAnnouncements } from "@/components/useChartAnnouncements";
import { setChartStyle, useChartStyle } from "@/components/useChartStyle";
import { toggleChartEvents, useHiddenChartEvents } from "@/components/useHiddenChartEvents";
import { usePageView } from "@/components/usePageView";
import { fetchInstrumentHistories } from "@/lib/api";
import { getCfdQuoteSource } from "@/lib/cfd";
import { findEventSlot, getEspiChartTicker, listChartDividends, niceTicks, placeChartEvents, toEventMarks, type ChartEvent, type EventMark, type EventSlot } from "@/lib/chart-events";
import { canAccessFeature } from "@/lib/entitlements";
import { calculatePeriodReturns, RETURN_PERIODS, type ReturnPeriodId } from "@/lib/period-returns";
import {
  averagePriceOn,
  buildComparisonRows,
  buildInstrumentTimeline,
  separateOpposingTrades,
  instrumentKeyOf,
  listChartInstruments,
  priceExtremes,
  type Candle,
  type CandleInterval,
  type ChartInstrument,
  type InstrumentTrade,
  type PricePoint,
} from "@/lib/instrument-chart";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { InvestmentPortfolio } from "@/types/portfolio";

/** Validated categorical order (colour-blind safe neighbours); a ninth instrument is not allowed. */
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const MAX_COMPARED = SERIES.length;

type RangeKey = "6M" | "1Y" | "3Y" | "5Y" | "ALL";
const RANGE_LABELS: Record<RangeKey, string> = { "6M": "6M", "1Y": "1R", "3Y": "3L", "5Y": "5L", ALL: "Od 1. zakupu" };

const quantityFormatter = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 6 });
const percentFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatPercent = (value: number | null) => (value === null ? "—" : `${value > 0 ? "+" : ""}${percentFormatter.format(value)}%`);
const tone = (value: number) => (value > 0 ? "tone-positive" : value < 0 ? "tone-negative" : undefined);

const todayIso = () => new Date().toISOString().slice(0, 10);
const shiftIso = (date: string, { days = 0, months = 0 }: { days?: number; months?: number }) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const toTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
/** First days of months, every `step` months, so the axis shows at most `limit` dates whatever the range. */
const monthTicks = (from: number, to: number, limit = 7) => {
  const months = Math.max(1, (to - from) / (30.44 * 86_400_000));
  const step = [1, 2, 3, 6, 12, 24].find((candidate) => months / candidate <= limit) ?? 36;
  const ticks: number[] = [];
  const cursor = new Date(from);
  cursor.setUTCDate(1);
  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= to) {
    if (cursor.getUTCMonth() % step === 0 || step === 1) ticks.push(cursor.getTime());
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return ticks;
};
/** How far back the price history is fetched: five years, or from two months before the first purchase. */
const fetchStartFor = (instrument: ChartInstrument) => {
  const fiveYears = shiftIso(todayIso(), { months: -60 });
  const beforeFirst = shiftIso(instrument.firstTradeDate || fiveYears, { months: -2 });
  const start = beforeFirst < fiveYears ? beforeFirst : fiveYears;
  return start < "2000-01-01" ? "2000-01-01" : start;
};

const rangeStart = (range: RangeKey, firstTradeDate: string) => {
  const today = todayIso();
  switch (range) {
    case "6M": return shiftIso(today, { months: -6 });
    case "1Y": return shiftIso(today, { months: -12 });
    case "3Y": return shiftIso(today, { months: -36 });
    case "5Y": return shiftIso(today, { months: -60 });
    default: return shiftIso(firstTradeDate || today, { days: -14 });
  }
};
/** A CFD is often hours old, so its chart starts two months back to show where it was opened. */
const chartStart = (range: RangeKey, instrument: ChartInstrument) => {
  const start = rangeStart(range, instrument.firstTradeDate);
  const twoMonths = shiftIso(todayIso(), { months: -2 });
  return instrument.isCfd && range === "ALL" && twoMonths < start ? twoMonths : start;
};

/** Phones get fewer dates on the time axis. */
function useNarrowScreen() {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setIsNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isNarrow;
}

type SeriesResult = { points: PricePoint[]; candles?: Candle[]; warning?: string };
const historyCache = new Map<string, Promise<SeriesResult>>();

/** One request per instrument and start date, shared by the chart and the comparison. */
const loadHistory = (instrument: ChartInstrument): Promise<SeriesResult> => {
  const startDate = fetchStartFor(instrument);
  const cacheKey = `${instrument.key}|${startDate}`;
  const cached = historyCache.get(cacheKey);
  if (cached) return cached;
  const request = fetchInstrumentHistories({
    startDate,
    instruments: [{ key: instrument.key, symbol: instrument.symbol, kind: instrument.kind, marketCurrency: instrument.marketCurrency, provider: instrument.provider, providerId: instrument.providerId, priceScale: instrument.priceScale, isCfd: instrument.isCfd }],
  }).then((response) => {
    const series = response.series[0];
    return { points: series?.points ?? [], ...(series?.candles ? { candles: series.candles } : {}), ...(series?.warning ? { warning: series.warning } : {}) };
  });
  request.catch(() => historyCache.delete(cacheKey));
  historyCache.set(cacheKey, request);
  return request;
};

function RangePicker({ value, onChange, label }: { value: RangeKey; onChange: (value: RangeKey) => void; label: string }) {
  return (
    <div className="risk-period-selector" role="group" aria-label={label}>
      {(Object.keys(RANGE_LABELS) as RangeKey[]).map((item) => (
        <button key={item} type="button" className={value === item ? "is-active" : ""} aria-pressed={value === item} onClick={() => onChange(item)}>{RANGE_LABELS[item]}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One instrument

type TradeMarker = InstrumentTrade & { t: number };

type PriceRow = { t: number; date: string; close: number; average: number | null };

type LineEventMark = EventMark & { t: number; date: string };

function PriceTooltip({ active, payload, currency, tradesByDate, eventSlots, eventInterval }: { active?: boolean; payload?: Array<{ payload?: PriceRow | TradeMarker | LineEventMark }>; currency: string; tradesByDate: Map<string, InstrumentTrade[]>; eventSlots: Array<EventSlot<ChartEvent>>; eventInterval: CandleInterval }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row || !("date" in row)) return null;
  const date = row.date;
  const trades = tradesByDate.get(date) ?? [];
  const price = "close" in row ? row.close : null;
  const average = "average" in row ? row.average : null;
  return (
    <div className="report-tooltip">
      <strong>{formatDate(date)}</strong>
      {price !== null ? <span>Kurs: {formatCurrency(price, currency)}</span> : null}
      {average !== null ? <span>Średnia cena kupna: {formatCurrency(average, currency)}</span> : null}
      {trades.map((trade) => (
        <span key={trade.id} className={trade.side === "buy" ? "tone-positive" : "tone-negative"}>
          {trade.side === "buy" ? "Kupno" : "Sprzedaż"} {quantityFormatter.format(trade.quantity)} szt. po {formatCurrency(trade.price, currency)}
        </span>
      ))}
      <EventTooltipLines slot={findEventSlot(eventSlots, date)} interval={eventInterval} />
    </div>
  );
}

/** Price history, trades, the average purchase price and events of one instrument, for the chart. */
export function useInstrumentChartData(instrument: ChartInstrument | undefined, portfolios: InvestmentPortfolio[], range: RangeKey) {
  const { account, fxRates } = usePortfolioWorkspace();
  const [state, setState] = useState<{ key: string; result: SeriesResult | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!instrument) return;
    let cancelled = false;
    loadHistory(instrument)
      .then((result) => { if (!cancelled) setState({ key: instrument.key, result, error: null }); })
      .catch(() => { if (!cancelled) setState({ key: instrument.key, result: null, error: "Nie udało się pobrać notowań tego waloru." }); });
    return () => { cancelled = true; };
  }, [instrument]);

  const timeline = useMemo(() => (instrument ? buildInstrumentTimeline(portfolios, instrument) : null), [instrument, portfolios]);
  const current = state && instrument && state.key === instrument.key ? state : null;
  const start = instrument ? chartStart(range, instrument) : "";
  const points = useMemo(() => (current?.result?.points ?? []).filter((point) => point.date >= start), [current, start]);
  const candles = useMemo(() => (current?.result?.candles ?? []).filter((candle) => candle.date >= start), [current, start]);
  const rows = useMemo<PriceRow[]>(() => points.map((point) => ({ t: toTime(point.date), date: point.date, close: point.close, average: timeline ? averagePriceOn(timeline.averagePriceSteps, point.date) : null })), [points, timeline]);
  const extremes = useMemo(() => priceExtremes(points), [points]);
  const lastDate = points.at(-1)?.date ?? todayIso();
  const markers = useMemo<TradeMarker[]>(() => separateOpposingTrades((timeline?.trades ?? []).filter((trade) => trade.date >= start && trade.date <= lastDate), (trade) => trade.date).map((trade) => ({ ...trade, t: toTime(trade.date) })), [lastDate, start, timeline]);
  const tradesByDate = useMemo(() => {
    const map = new Map<string, InstrumentTrade[]>();
    for (const trade of timeline?.trades ?? []) map.set(trade.date, [...(map.get(trade.date) ?? []), trade]);
    return map;
  }, [timeline]);

  const espiTicker = instrument && canAccessFeature(account, "espi") ? getEspiChartTicker(instrument) : null;
  const espi = useChartAnnouncements(espiTicker, instrument ? fetchStartFor(instrument) : "");
  const allDividends = useMemo(() => (instrument ? listChartDividends(portfolios, instrument, fxRates) : []), [fxRates, instrument, portfolios]);
  const dividends = useMemo(() => allDividends.filter((dividend) => dividend.date >= start), [allDividends, start]);
  const announcements = useMemo(() => espi.items.filter((report) => report.date >= start), [espi.items, start]);
  const hidden = useHiddenChartEvents();
  const events = useMemo<ChartEvent[]>(
    () => [...(hidden.includes("dividend") ? [] : dividends), ...(hidden.includes("espi") ? [] : announcements)],
    [announcements, dividends, hidden]
  );

  return { current, timeline, points, candles, rows, extremes, lastDate, markers, tradesByDate, events, dividends, announcements, espi, hidden };
}

type ChartData = ReturnType<typeof useInstrumentChartData>;

export function ChartStyleSwitch() {
  const style = useChartStyle();
  return (
    <div className="view-switch" role="group" aria-label="Rodzaj wykresu">
      <button type="button" aria-pressed={style === "line"} onClick={() => setChartStyle("line")}>Liniowy</button>
      <button type="button" aria-pressed={style === "candle"} onClick={() => setChartStyle("candle")}>Świecowy</button>
    </div>
  );
}

/** The price line or candles with purchases (+), sales (−), the average purchase price, max/min and events. */
export function InstrumentPriceChartBody({ instrument, data, height }: { instrument: ChartInstrument; data: ChartData; height?: number }) {
  const isNarrow = useNarrowScreen();
  const style = useChartStyle();
  const [width, setWidth] = useState(0);
  const { current, points, candles, rows, extremes, lastDate, markers, tradesByDate, timeline, events } = data;
  const placement = useMemo(() => placeChartEvents(points.map((point) => point.date), events, maxEventSlots(width, isNarrow)), [events, isNarrow, points, width]);
  const eventMarks = useMemo(() => {
    const toMarks = (kind: ChartEvent["kind"]): LineEventMark[] => toEventMarks(placement.slots, kind).map((mark) => ({ ...mark, t: toTime(mark.session), date: mark.session }));
    return { dividend: toMarks("dividend"), espi: toMarks("espi") };
  }, [placement]);
  // The tooltip follows the price points, so a trade booked on a day without a quote is listed
  // with the session before it.
  const tradesByPoint = useMemo(() => {
    const map = new Map<string, InstrumentTrade[]>();
    for (const [date, trades] of tradesByDate) {
      const session = points.findLast((point) => point.date <= date)?.date ?? date;
      map.set(session, [...(map.get(session) ?? []), ...trades]);
    }
    return map;
  }, [points, tradesByDate]);
  const currency = instrument.marketCurrency;
  const lastPrice = extremes?.last.close ?? null;
  const buys = timeline?.trades.filter((trade) => trade.side === "buy").length ?? 0;
  const sells = (timeline?.trades.length ?? 0) - buys;
  if (!current) return <p className="empty-row mt-4">Wczytywanie notowań…</p>;
  if (current.error || points.length === 0) {
    const missing = instrument.isCfd && !getCfdQuoteSource({ instrumentType: "CFD", symbol: instrument.symbol })
      ? "Mexo nie ma notowań dla tego CFD, więc nie rysuje wykresu. Kurs pochodzi z ostatniego zaimportowanego pliku."
      : "Brak notowań tego waloru w wybranym zakresie.";
    return <p className="empty-row mt-4">{current.error ?? missing}</p>;
  }
  const shownDividends = events.filter((event) => event.kind === "dividend").length;
  const shownReports = events.length - shownDividends;
  const description = `Kurs ${instrument.name} od ${formatDate(points[0]!.date)} do ${formatDate(lastDate)}: ${buys} zakupów i ${sells} sprzedaży zaznaczonych na wykresie.${events.length > 0 ? ` Pod kursem: dywidendy (${shownDividends}) i komunikaty ESPI (${shownReports}).` : ""}`;
  if (style === "candle" && candles.length > 1) {
    return <InstrumentCandleChart candles={candles} trades={markers} averagePriceSteps={timeline?.averagePriceSteps ?? []} events={events} currency={currency} height={height} isNarrow={isNarrow} ariaLabel={description} />;
  }
  // With marks under the price, the scale leaves them room below the lowest value drawn.
  const hasEventMarks = placement.slots.length > 0;
  const drawn = [...rows.flatMap((row) => (row.average === null ? [row.close] : [row.close, row.average])), ...markers.map((marker) => marker.price)];
  const lowest = Math.min(...drawn);
  const highest = Math.max(...drawn);
  const span = highest - lowest || highest || 1;
  // The scale is set here, because trade prices outside the closes have to fit on it too.
  const lowerEnd = lowest - span * (hasEventMarks ? LANE_ROOM : 0.06);
  const priceScale = { domain: [lowerEnd, highest + span * 0.06] as [number, number], ticks: niceTicks(hasEventMarks ? lowest : lowerEnd, highest + span * 0.06), allowDataOverflow: true };
  return (
    <>
    {style === "candle" ? <p className="field-note mt-2">Yahoo Finance nie ma danych do świec dla tego waloru w jego walucie, więc pokazuję wykres liniowy.</p> : null}
    <div className="instrument-chart mt-3" style={height ? { height } : undefined} role="img" aria-label={description}>
      <ResponsiveContainer width="100%" height="100%" onResize={(nextWidth) => setWidth(nextWidth)}>
        <ComposedChart data={rows} margin={{ top: 16, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="rgba(20, 35, 48, 0.08)" strokeDasharray="3 10" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={[toTime(points[0]!.date), toTime(lastDate)]} ticks={monthTicks(toTime(points[0]!.date), toTime(lastDate), isNarrow ? 4 : 7)} axisLine={false} tickLine={false} tick={AXIS} tickFormatter={monthTick} allowDuplicatedCategory={false} />
          <YAxis type="number" {...priceScale} axisLine={false} tickLine={false} tick={AXIS} orientation="right" width={64} tickFormatter={(value: number) => percentFormatter.format(value)} />
          <Tooltip content={<PriceTooltip currency={currency} tradesByDate={tradesByPoint}eventSlots={placement.slots} eventInterval={placement.interval} />} cursor={{ stroke: "rgba(20, 35, 48, 0.16)", strokeDasharray: "6 8" }} wrapperStyle={{ outline: "none", zIndex: 20 }} />
          {extremes ? (
            <>
              <ReferenceLine y={extremes.max.close} stroke={MAX} strokeWidth={1.5} label={{ value: `max ${percentFormatter.format(extremes.max.close)}`, position: "insideTopLeft", fill: MAX, fontSize: 11, fontWeight: 700 }} />
              <ReferenceLine y={extremes.min.close} stroke={MIN} strokeWidth={1.5} label={{ value: `min ${percentFormatter.format(extremes.min.close)}`, position: "insideBottomLeft", fill: MIN, fontSize: 11, fontWeight: 700 }} />
            </>
          ) : null}
          <Line dataKey="close" type="linear" stroke={PRICE} strokeWidth={2} dot={false} isAnimationActive={false} name="Kurs" />
          <Line dataKey="average" type="stepAfter" stroke={BUY} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} name="Średnia cena kupna" />
          {tradeDots(markers, (marker) => marker.t, [60, 520])}
          {eventDots(eventMarks.espi, (mark) => mark.t, priceScale.domain)}
          {eventDots(eventMarks.dividend, (mark) => mark.t, priceScale.domain)}
          {lastPrice !== null ? <ReferenceLine y={lastPrice} stroke="transparent" label={{ value: `ostatni ${percentFormatter.format(lastPrice)}`, position: "insideBottomRight", fill: PRICE, fontSize: 11, fontWeight: 800 }} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    </>
  );
}

/** A legend entry that also switches its marks on and off. */
function EventLegendToggle({ kind, isShown, label }: { kind: ChartEvent["kind"]; isShown: boolean; label: string }) {
  return (
    <li>
      <button type="button" aria-pressed={isShown} title={isShown ? "Ukryj na wykresie" : "Pokaż na wykresie"} onClick={() => toggleChartEvents(kind)}>
        <i className={kind === "dividend" ? "is-dividend" : "is-espi"} aria-hidden="true">{kind === "dividend" ? "D" : null}</i>
        {label}
      </button>
    </li>
  );
}

export function InstrumentChartLegend({ data }: { data: ChartData }) {
  const showCandles = useChartStyle() === "candle" && data.candles.length > 1;
  const { dividends, announcements, espi, hidden } = data;
  return (
    <ul className="instrument-legend" aria-label="Legenda">
      {showCandles ? (
        <>
          <li><i className="is-candle" />Wzrost</li>
          <li><i className="is-candle is-down" />Spadek</li>
        </>
      ) : <li><i className="is-line" style={{ background: PRICE }} />Kurs</li>}
      <li><i className="is-dot" style={showCandles ? { background: "#ffffff", color: BUY, border: `2px solid ${BUY}` } : { background: BUY }}>+</i>Kupno</li>
      <li><i className="is-dot" style={showCandles ? { background: "#ffffff", color: SELL, border: `2px solid ${SELL}` } : { background: SELL }}>−</i>Sprzedaż</li>
      <li><i className="is-dash" style={{ borderColor: BUY }} />Średnia cena kupna</li>
      <li><i className="is-line" style={{ background: MAX }} />Maksimum</li>
      <li><i className="is-line" style={{ background: MIN }} />Minimum</li>
      {dividends.length > 0 ? <EventLegendToggle kind="dividend" isShown={!hidden.includes("dividend")} label={`Dywidendy (${dividends.length})`} /> : null}
      {announcements.length > 0 ? <EventLegendToggle kind="espi" isShown={!hidden.includes("espi")} label={`Komunikaty ESPI (${announcements.length})`} /> : null}
      {espi.status === "loading" ? <li>Wczytywanie komunikatów ESPI…</li> : null}
    </ul>
  );
}

/** Why some reports may be missing from the chart, if they are. */
export function CfdSourceNote({ symbol, isCfd }: { symbol: string; isCfd?: boolean }) {
  const source = getCfdQuoteSource({ instrumentType: isCfd ? "CFD" : undefined, symbol });
  return source ? <p className="field-note">Kurs i wykres pochodzą z {source.label} (Yahoo Finance). To przybliżenie: broker może pokazywać cenę różniącą się o kilkanaście lub kilkadziesiąt punktów.</p> : null;
}

export function ChartEventNotes({ data }: { data: ChartData }) {
  const oldest = data.espi.items[0];
  if (data.espi.status === "error") return <p className="field-note">Nie udało się pobrać komunikatów ESPI. Odśwież stronę, aby spróbować ponownie.</p>;
  if (data.espi.isCut && oldest) return <p className="field-note">Wykres pokazuje komunikaty ESPI od {formatDate(oldest.date)}. Starsze znajdziesz w zakładce Raporty ESPI.</p>;
  return null;
}

/** The newest ESPI reports of the company, linked to their text in Mexo and at the source. */
export function ChartReportList({ data, limit }: { data: ChartData; limit?: number }) {
  const { getReadHref } = usePortfolioWorkspace();
  const newestFirst = [...data.announcements].reverse();
  const shown = limit ? newestFirst.slice(0, limit) : newestFirst;
  return (
    <ul className="chart-reports">
      {shown.map((report) => (
        <li key={report.id}>
          <time dateTime={report.publishedAt}>{formatDate(report.date)}</time>
          <span>
            <Link href={getReadHref(`/market/espi/${report.id}`)} prefetch={false}>{report.title}</Link>
            <small>
              {report.categoryLabel}{report.reportNumber ? ` · ${report.reportNumber}` : ""}{report.isCorrection ? " · korekta" : ""} · <a href={report.sourceUrl} target="_blank" rel="noreferrer">źródło ↗</a>
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export { RangePicker };
export type { RangeKey };

function InstrumentChart({ instruments, initialKey }: { instruments: ChartInstrument[]; initialKey?: string }) {
  const { selectedPortfolios } = usePortfolioWorkspace();
  const [selectedKey, setSelectedKey] = useState<string>(initialKey && instruments.some((item) => item.key === initialKey) ? initialKey : instruments[0]?.key ?? "");
  const [range, setRange] = useState<RangeKey>("ALL");
  const instrument = instruments.find((item) => item.key === selectedKey) ?? instruments[0];
  const data = useInstrumentChartData(instrument, selectedPortfolios, range);
  const { current, extremes, timeline } = data;

  if (!instrument || !timeline) return null;
  const currency = instrument.marketCurrency;
  const averageNow = averagePriceOn(timeline.averagePriceSteps, todayIso());
  const lastPrice = extremes?.last.close ?? null;
  const vsAverage = averageNow && lastPrice ? ((lastPrice / averageNow - 1) * 100) : null;
  const buys = timeline.trades.filter((trade) => trade.side === "buy").length;
  const sells = timeline.trades.length - buys;
  const open = instruments.filter((item) => item.isOpen);
  const closed = instruments.filter((item) => !item.isOpen);

  return (
    <section className="panel">
      <div className="risk-section-heading">
        <div>
          <p className="eyebrow">Wykres waloru</p>
          <h2 className="section-title">Kurs {instrument.name} [{currency}]</h2>
        </div>
        <label className="field instrument-select-field">
          <span>Walor</span>
          <select value={instrument.key} onChange={(event) => setSelectedKey(event.target.value)}>
            {open.length > 0 ? <optgroup label="W portfelu">{open.map((item) => <option key={item.key} value={item.key}>{item.name} ({item.symbol})</option>)}</optgroup> : null}
            {closed.length > 0 ? <optgroup label="Sprzedane w całości">{closed.map((item) => <option key={item.key} value={item.key}>{item.name} ({item.symbol})</option>)}</optgroup> : null}
          </select>
        </label>
      </div>

      <div className="instrument-chart-toolbar mt-4">
        <div className="positions-chart-switches">
          <ChartStyleSwitch />
          <RangePicker value={range} onChange={setRange} label="Zakres wykresu waloru" />
        </div>
        <InstrumentChartLegend data={data} />
      </div>

      <InstrumentPriceChartBody instrument={instrument} data={data} />
      <CfdSourceNote symbol={instrument.symbol} isCfd={instrument.isCfd} />
      <ChartEventNotes data={data} />

      <div className="risk-metric-grid risk-metric-grid-summary mt-4">
        <article className="risk-metric-card"><div className="risk-metric-label"><span>Ostatni kurs</span></div><strong>{lastPrice === null ? "—" : formatCurrency(lastPrice, currency)}</strong><small>{extremes ? formatDate(extremes.last.date) : "brak notowań"}</small></article>
        <article className="risk-metric-card"><div className="risk-metric-label"><span>Średnia cena kupna</span></div><strong>{averageNow === null ? "—" : formatCurrency(averageNow, currency)}</strong><small>{averageNow === null ? "nic nie zostało w portfelu" : <>kurs vs średnia: <span className={tone(vsAverage ?? 0)}>{formatPercent(vsAverage)}</span></>}</small></article>
        <article className="risk-metric-card"><div className="risk-metric-label"><span>W portfelu</span></div><strong>{quantityFormatter.format(instrument.quantity)} szt.</strong><small>{instrument.portfolioNames.join(", ")}</small></article>
        <article className="risk-metric-card"><div className="risk-metric-label"><span>Transakcje</span></div><strong>{buys} / {sells}</strong><small>zakupy / sprzedaże</small></article>
        {extremes ? <article className="risk-metric-card"><div className="risk-metric-label"><span>Zakres kursu</span></div><strong>{percentFormatter.format(extremes.min.close)} – {percentFormatter.format(extremes.max.close)}</strong><small>min {formatDate(extremes.min.date)} · max {formatDate(extremes.max.date)}</small></article> : null}
      </div>
      {timeline.skippedTrades > 0 ? <p className="field-note">Transakcje zapisane w innej walucie niż notowanie ({timeline.skippedTrades}) nie są zaznaczone na wykresie.</p> : null}
      {current?.result?.warning ? <p className="field-note">{current.result.warning}</p> : null}

      {data.dividends.length > 0 ? (
        <details className="instrument-trades mt-4">
          <summary>Dywidendy w tym zakresie ({data.dividends.length})</summary>
          <div className="sprint-table-wrap mt-3">
            <table className="portfolio-table sprint-table report-table">
              <thead><tr><th>Terminy</th><th>Netto</th><th>Na akcję</th><th>Ilość</th><th>Portfel</th></tr></thead>
              <tbody>
                {[...data.dividends].reverse().map((dividend) => (
                  <tr key={dividend.id}>
                    <td><strong>{describeDividendDates(dividend)}</strong></td>
                    <td data-label="Netto">{formatCurrency(dividend.netAmount, dividend.currency)}</td>
                    <td data-label="Na akcję">{dividend.dividendPerShare > 0 ? formatCurrency(dividend.dividendPerShare, dividend.currency) : "—"}</td>
                    <td data-label="Ilość">{dividend.quantity > 0 ? quantityFormatter.format(dividend.quantity) : "—"}</td>
                    <td data-label="Portfel">{dividend.portfolioName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {data.announcements.length > 0 ? (
        <details className="instrument-trades mt-4">
          <summary>Komunikaty ESPI w tym zakresie ({data.announcements.length})</summary>
          <ChartReportList data={data} />
        </details>
      ) : null}

      {timeline.trades.length > 0 ? (
        <details className="instrument-trades mt-4">
          <summary>Lista transakcji ({timeline.trades.length})</summary>
          <div className="sprint-table-wrap mt-3">
            <table className="portfolio-table sprint-table report-table">
              <thead><tr><th>Data</th><th>Rodzaj</th><th>Ilość</th><th>Cena</th><th>Kwota</th><th>Portfel</th></tr></thead>
              <tbody>
                {[...timeline.trades].reverse().map((trade) => (
                  <tr key={trade.id}>
                    <td><strong>{formatDate(trade.date)}</strong></td>
                    <td data-label="Rodzaj" className={trade.side === "buy" ? "tone-positive" : undefined}>{trade.side === "buy" ? "Kupno" : "Sprzedaż"}</td>
                    <td data-label="Ilość">{quantityFormatter.format(trade.quantity)}</td>
                    <td data-label="Cena">{formatCurrency(trade.price, trade.currency)}</td>
                    <td data-label="Kwota">{formatCurrency(trade.amount, trade.currency)}</td>
                    <td data-label="Portfel">{trade.portfolioName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Several instruments on one scale

function ComparisonTooltip({ active, payload, label, names }: { active?: boolean; payload?: Array<{ dataKey?: string | number; value?: number | null; color?: string }>; label?: string; names: Map<string, string> }) {
  if (!active || !payload?.length || !label) return null;
  const items = [...payload].filter((item) => typeof item.value === "number").sort((left, right) => (right.value ?? 0) - (left.value ?? 0));
  return (
    <div className="report-tooltip">
      <strong>{formatDate(label)}</strong>
      {items.map((item) => (
        <span key={String(item.dataKey)}><i className="report-tooltip-swatch" style={{ background: item.color }} />{names.get(String(item.dataKey))}: {formatPercent(item.value ?? null)}</span>
      ))}
    </div>
  );
}

function InstrumentComparison({ instruments }: { instruments: ChartInstrument[] }) {
  const { groupedAssets } = usePortfolioWorkspace();
  const defaultKeys = useMemo(() => {
    const byValue = new Map<string, number>();
    for (const group of groupedAssets) byValue.set(instrumentKeyOf(group), (byValue.get(instrumentKeyOf(group)) ?? 0) + group.totalValuePln);
    return instruments.filter((item) => item.isOpen).sort((left, right) => (byValue.get(right.key) ?? 0) - (byValue.get(left.key) ?? 0)).slice(0, 4).map((item) => item.key);
  }, [groupedAssets, instruments]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const selectedSignature = (chosen ?? defaultKeys).filter((key) => instruments.some((item) => item.key === key)).join("|||");
  const selected = useMemo(() => (selectedSignature ? selectedSignature.split("|||") : []), [selectedSignature]);
  const [range, setRange] = useState<RangeKey>("1Y");
  const [loaded, setLoaded] = useState<Map<string, SeriesResult | null>>(new Map());

  useEffect(() => {
    let cancelled = false;
    for (const key of selected) {
      const instrument = instruments.find((item) => item.key === key);
      if (!instrument) continue;
      // Cached per instrument, so a key that is already loaded resolves at once without a request.
      loadHistory(instrument)
        .then((result) => { if (!cancelled) setLoaded((current) => (current.get(key) === result ? current : new Map(current).set(key, result))); })
        .catch(() => { if (!cancelled) setLoaded((current) => (current.has(key) ? current : new Map(current).set(key, null))); });
    }
    return () => { cancelled = true; };
  }, [instruments, selected]);

  // A colour stays with its instrument while others are added or removed.
  const colorOf = (key: string) => SERIES[Math.max(0, (chosen ?? defaultKeys).indexOf(key)) % SERIES.length];
  const earliestTrade = instruments.filter((item) => selected.includes(item.key)).map((item) => item.firstTradeDate).sort()[0] ?? todayIso();
  const start = rangeStart(range, earliestTrade);
  const ready = selected.filter((key) => loaded.get(key));
  const { rows, baseDate } = useMemo(() => buildComparisonRows(ready.map((key) => ({ key, points: loaded.get(key)!.points })), start), [loaded, ready, start]);
  const names = new Map(instruments.map((item) => [item.key, item.symbol.replace(/\.(PL|WA)$/i, "")]));
  const finalValues = selected.map((key) => ({ key, value: (rows.at(-1)?.[key] as number | null | undefined) ?? null }));
  const failed = selected.filter((key) => loaded.has(key) && !loaded.get(key));
  const pending = selected.filter((key) => !loaded.has(key));

  const toggle = (key: string) => {
    const current = chosen ?? defaultKeys;
    if (current.includes(key)) setChosen(current.filter((item) => item !== key));
    else if (current.length < MAX_COMPARED) setChosen([...current, key]);
  };

  return (
    <section className="panel">
      <div className="risk-section-heading">
        <div>
          <p className="eyebrow">Porównanie walorów</p>
          <h2 className="section-title">Zmiana kursu na wspólnym wykresie</h2>
        </div>
        <RangePicker value={range} onChange={setRange} label="Zakres porównania" />
      </div>

      <div className="comparison-chips mt-4" role="group" aria-label={`Walory do porównania (do ${MAX_COMPARED})`}>
        {instruments.map((item) => {
          const isOn = selected.includes(item.key);
          return (
            <button key={item.key} type="button" className={`comparison-chip${isOn ? " is-active" : ""}`} aria-pressed={isOn} disabled={!isOn && selected.length >= MAX_COMPARED} onClick={() => toggle(item.key)} title={item.name}>
              {isOn ? <i style={{ background: colorOf(item.key) }} /> : null}
              {names.get(item.key)}
            </button>
          );
        })}
      </div>

      {selected.length === 0 ? (
        <p className="empty-row mt-4">Wybierz walory do porównania.</p>
      ) : rows.length === 0 ? (
        <p className="empty-row mt-4">{pending.length > 0 ? "Wczytywanie notowań…" : "Brak wspólnych notowań w wybranym zakresie."}</p>
      ) : (
        <>
          <div className="instrument-chart mt-3" role="img" aria-label={`Zmiana kursu ${selected.length} walorów od ${baseDate ? formatDate(baseDate) : ""}, wszystkie od 0%.`}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 12, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="rgba(20, 35, 48, 0.08)" strokeDasharray="3 10" vertical={false} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={AXIS} minTickGap={36} tickFormatter={(value: string) => monthTick(toTime(value))} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS} orientation="right" width={60} tickFormatter={(value: number) => `${percentFormatter.format(value)}%`} />
                <ReferenceLine y={0} stroke="rgba(20, 35, 48, 0.35)" />
                <Tooltip content={<ComparisonTooltip names={names} />} cursor={{ stroke: "rgba(20, 35, 48, 0.16)", strokeDasharray: "6 8" }} wrapperStyle={{ outline: "none", zIndex: 20 }} />
                {ready.map((key) => <Line key={key} dataKey={key} stroke={colorOf(key)} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} name={names.get(key)} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <ul className="comparison-results" aria-label="Zmiana w zakresie">
            {finalValues.sort((left, right) => (right.value ?? -Infinity) - (left.value ?? -Infinity)).map(({ key, value }) => (
              <li key={key}><i style={{ background: colorOf(key) }} /><span title={instruments.find((item) => item.key === key)?.name}>{names.get(key)}</span><strong className={tone(value ?? 0)}>{failed.includes(key) ? "brak danych" : formatPercent(value)}</strong></li>
            ))}
          </ul>
          <p className="field-note">Każda linia to zmiana kursu w walucie notowania od {baseDate ? formatDate(baseDate) : "początku zakresu"} (pierwszy dzień, w którym wszystkie wybrane walory mają notowanie), więc wszystkie startują od 0%. Dywidendy i kursy walut nie są wliczone.</p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Every open holding over fixed periods

type PeriodSortKey = ReturnPeriodId | "name";

/** Requests in flight at once, so a long portfolio does not ask for every history together. */
const PARALLEL_HISTORIES = 4;

function InstrumentPeriodReturns({ instruments }: { instruments: ChartInstrument[] }) {
  const { getReadHref } = usePortfolioWorkspace();
  const open = useMemo(() => instruments.filter((item) => item.isOpen), [instruments]);
  const [loaded, setLoaded] = useState<Map<string, SeriesResult | null>>(new Map());
  const [sort, setSort] = useState<{ key: PeriodSortKey; descending: boolean }>({ key: "30d", descending: true });

  useEffect(() => {
    let cancelled = false;
    const queue = [...open];
    const next = async (): Promise<void> => {
      const instrument = queue.shift();
      if (!instrument || cancelled) return;
      const result = await loadHistory(instrument).catch(() => null);
      if (!cancelled) setLoaded((current) => (current.has(instrument.key) && current.get(instrument.key) === result ? current : new Map(current).set(instrument.key, result)));
      return next();
    };
    for (let index = 0; index < PARALLEL_HISTORIES; index += 1) void next();
    return () => { cancelled = true; };
  }, [open]);

  const today = todayIso();
  const rows = open.map((instrument) => ({ instrument, returns: calculatePeriodReturns(loaded.get(instrument.key)?.points ?? [], today), last: loaded.get(instrument.key)?.points.at(-1) }));
  const sorted = [...rows].sort((left, right) => {
    if (sort.key === "name") return (sort.descending ? -1 : 1) * left.instrument.name.localeCompare(right.instrument.name, "pl");
    const a = left.returns[sort.key];
    const b = right.returns[sort.key];
    // Holdings without a value stay at the bottom whichever way the column is sorted.
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return sort.descending ? b - a : a - b;
  });
  const pending = open.filter((item) => !loaded.has(item.key)).length;
  const failed = open.filter((item) => loaded.has(item.key) && !loaded.get(item.key));
  const sortBy = (key: PeriodSortKey) => setSort((current) => (current.key === key ? { key, descending: !current.descending } : { key, descending: key !== "name" }));
  const header = (key: PeriodSortKey, label: string) => (
    <th key={key} aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : "none"} className={key === "name" ? undefined : "num"}>
      <button type="button" className="table-sort" onClick={() => sortBy(key)}>{label}{sort.key === key ? <span aria-hidden="true">{sort.descending ? " ↓" : " ↑"}</span> : null}</button>
    </th>
  );

  return (
    <section className="panel">
      <div className="risk-section-heading">
        <div>
          <p className="eyebrow">Zwroty w okresach</p>
          <h2 className="section-title">Zmiana kursu Twoich walorów</h2>
        </div>
        <span>{pending > 0 ? `Wczytywanie notowań: ${open.length - pending} z ${open.length}` : `${open.length} w portfelu`}</span>
      </div>
      {open.length === 0 ? (
        <p className="empty-row mt-4">W portfelu nie ma teraz walorów z notowaniami.</p>
      ) : (
        <div className="sprint-table-wrap mt-4">
          <table className="portfolio-table sprint-table report-table period-returns-table">
            <thead><tr>{header("name", "Walor")}<th className="num">Ostatni kurs</th>{RETURN_PERIODS.map((period) => header(period.id, period.label))}</tr></thead>
            <tbody>
              {sorted.map(({ instrument, returns, last }) => (
                <tr key={instrument.key}>
                  <td><Link href={getReadHref(`/analytics/assets?instrument=${encodeURIComponent(instrument.key)}`)} prefetch={false}><strong>{instrument.name}</strong></Link><small className="block">{instrument.symbol}</small></td>
                  <td className="num" data-label="Ostatni kurs">{last ? formatCurrency(last.close, instrument.marketCurrency) : loaded.has(instrument.key) ? "brak danych" : "…"}</td>
                  {RETURN_PERIODS.map((period) => {
                    const value = returns[period.id];
                    return <td key={period.id} data-label={period.label} className={`num ${value === null ? "" : tone(value) ?? ""}`}>{loaded.has(instrument.key) ? formatPercent(value) : "…"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {failed.length > 0 ? <p className="field-note mt-3">Nie udało się pobrać notowań: {failed.map((item) => item.name).join(", ")}.</p> : null}
      <p className="field-note mt-3">Zmiana kursu giełdowego w walucie notowania, bez dywidend i bez zmian kursów walut. Kreska oznacza, że historia nie sięga tak daleko albo ostatnie notowanie jest starsze niż 10 dni. Kliknij nazwę, aby otworzyć wykres.</p>
    </section>
  );
}

export default function InstrumentChartsWorkspace() {
  const { selectedPortfolios } = usePortfolioWorkspace();
  const instruments = useMemo(() => listChartInstruments(selectedPortfolios), [selectedPortfolios]);
  const initialKey = useSearchParams().get("instrument") ?? undefined;
  const { view } = usePageView("assetCharts");

  if (instruments.length === 0) {
    return <section className="panel"><p className="empty-row">Dodaj akcje, ETF lub kryptowaluty, aby zobaczyć ich wykresy. Obligacje skarbowe nie mają notowań rynkowych.</p></section>;
  }

  return (
    <div className="reports-workspace">
      {view === "wykres" ? <InstrumentChart key={initialKey ?? "first"} instruments={instruments} initialKey={initialKey} /> : null}
      {view === "okresy" ? <InstrumentPeriodReturns instruments={instruments} /> : null}
      {view === "porownanie" ? <InstrumentComparison instruments={instruments} /> : null}
    </div>
  );
}
