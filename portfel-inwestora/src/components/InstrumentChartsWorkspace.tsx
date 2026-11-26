"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import InstrumentCandleChart from "@/components/InstrumentCandleChart";
import { AXIS, BUY, MAX, MIN, PRICE, SELL, TradeShape, monthTick } from "@/components/instrument-chart-parts";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { setChartStyle, useChartStyle } from "@/components/useChartStyle";
import { fetchInstrumentHistories } from "@/lib/api";
import {
  averagePriceOn,
  buildComparisonRows,
  buildInstrumentTimeline,
  instrumentKeyOf,
  listChartInstruments,
  priceExtremes,
  type Candle,
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
    instruments: [{ key: instrument.key, symbol: instrument.symbol, kind: instrument.kind, marketCurrency: instrument.marketCurrency, provider: instrument.provider, providerId: instrument.providerId, priceScale: instrument.priceScale }],
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

function PriceTooltip({ active, payload, currency, tradesByDate }: { active?: boolean; payload?: Array<{ payload?: PriceRow | TradeMarker }>; currency: string; tradesByDate: Map<string, InstrumentTrade[]> }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
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
    </div>
  );
}

/** Price history, trades and the average purchase price of one instrument, for the chart. */
export function useInstrumentChartData(instrument: ChartInstrument | undefined, portfolios: InvestmentPortfolio[], range: RangeKey) {
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
  const start = instrument ? rangeStart(range, instrument.firstTradeDate) : "";
  const points = useMemo(() => (current?.result?.points ?? []).filter((point) => point.date >= start), [current, start]);
  const candles = useMemo(() => (current?.result?.candles ?? []).filter((candle) => candle.date >= start), [current, start]);
  const rows = useMemo<PriceRow[]>(() => points.map((point) => ({ t: toTime(point.date), date: point.date, close: point.close, average: timeline ? averagePriceOn(timeline.averagePriceSteps, point.date) : null })), [points, timeline]);
  const extremes = useMemo(() => priceExtremes(points), [points]);
  const lastDate = points.at(-1)?.date ?? todayIso();
  const markers = useMemo<TradeMarker[]>(() => (timeline?.trades ?? []).filter((trade) => trade.date >= start && trade.date <= lastDate).map((trade) => ({ ...trade, t: toTime(trade.date) })), [lastDate, start, timeline]);
  const tradesByDate = useMemo(() => {
    const map = new Map<string, InstrumentTrade[]>();
    for (const trade of timeline?.trades ?? []) map.set(trade.date, [...(map.get(trade.date) ?? []), trade]);
    return map;
  }, [timeline]);

  return { current, timeline, points, candles, rows, extremes, lastDate, markers, tradesByDate };
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

/** The price line or candles with purchases (+), sales (−), the average purchase price and max/min. */
export function InstrumentPriceChartBody({ instrument, data, height }: { instrument: ChartInstrument; data: ChartData; height?: number }) {
  const isNarrow = useNarrowScreen();
  const style = useChartStyle();
  const { current, points, candles, rows, extremes, lastDate, markers, tradesByDate, timeline } = data;
  const currency = instrument.marketCurrency;
  const lastPrice = extremes?.last.close ?? null;
  const buys = timeline?.trades.filter((trade) => trade.side === "buy").length ?? 0;
  const sells = (timeline?.trades.length ?? 0) - buys;
  if (!current) return <p className="empty-row mt-4">Wczytywanie notowań…</p>;
  if (current.error || points.length === 0) return <p className="empty-row mt-4">{current.error ?? "Brak notowań tego waloru w wybranym zakresie."}</p>;
  const description = `Kurs ${instrument.name} od ${formatDate(points[0]!.date)} do ${formatDate(lastDate)}: ${buys} zakupów i ${sells} sprzedaży zaznaczonych na wykresie.`;
  if (style === "candle" && candles.length > 1) {
    return <InstrumentCandleChart candles={candles} trades={markers} averagePriceSteps={timeline?.averagePriceSteps ?? []} currency={currency} height={height} isNarrow={isNarrow} ariaLabel={description} />;
  }
  return (
    <>
    {style === "candle" ? <p className="field-note mt-2">Yahoo Finance nie ma danych do świec dla tego waloru w jego walucie, więc pokazuję wykres liniowy.</p> : null}
    <div className="instrument-chart mt-3" style={height ? { height } : undefined} role="img" aria-label={description}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart margin={{ top: 16, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid stroke="rgba(20, 35, 48, 0.08)" strokeDasharray="3 10" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={[toTime(points[0]!.date), toTime(lastDate)]} ticks={monthTicks(toTime(points[0]!.date), toTime(lastDate), isNarrow ? 4 : 7)} axisLine={false} tickLine={false} tick={AXIS} tickFormatter={monthTick} allowDuplicatedCategory={false} />
          <YAxis type="number" domain={["auto", "auto"]} axisLine={false} tickLine={false} tick={AXIS} orientation="right" width={64} tickFormatter={(value: number) => percentFormatter.format(value)} />
          <ZAxis dataKey="amount" type="number" range={[60, 520]} />
          <Tooltip content={<PriceTooltip currency={currency} tradesByDate={tradesByDate} />} cursor={{ stroke: "rgba(20, 35, 48, 0.16)", strokeDasharray: "6 8" }} wrapperStyle={{ outline: "none", zIndex: 20 }} />
          {extremes ? (
            <>
              <ReferenceLine y={extremes.max.close} stroke={MAX} strokeWidth={1.5} label={{ value: `max ${percentFormatter.format(extremes.max.close)}`, position: "insideTopLeft", fill: MAX, fontSize: 11, fontWeight: 700 }} />
              <ReferenceLine y={extremes.min.close} stroke={MIN} strokeWidth={1.5} label={{ value: `min ${percentFormatter.format(extremes.min.close)}`, position: "insideBottomLeft", fill: MIN, fontSize: 11, fontWeight: 700 }} />
            </>
          ) : null}
          <Line data={rows} dataKey="close" type="linear" stroke={PRICE} strokeWidth={2} dot={false} isAnimationActive={false} name="Kurs" />
          <Line data={rows} dataKey="average" type="stepAfter" stroke={BUY} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} name="Średnia cena kupna" />
          <Scatter data={markers} dataKey="price" shape={<TradeShape />} isAnimationActive={false} name="Transakcje" />
          {lastPrice !== null ? <ReferenceLine y={lastPrice} stroke="transparent" label={{ value: `ostatni ${percentFormatter.format(lastPrice)}`, position: "insideBottomRight", fill: PRICE, fontSize: 11, fontWeight: 800 }} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    </>
  );
}

export function InstrumentChartLegend({ hasCandles = false }: { hasCandles?: boolean }) {
  const showCandles = useChartStyle() === "candle" && hasCandles;
  return (
    <ul className="instrument-legend" aria-label="Legenda">
      {showCandles ? (
        <>
          <li><i className="is-candle" />Wzrost</li>
          <li><i className="is-candle is-down" />Spadek</li>
        </>
      ) : <li><i className="is-line" style={{ background: PRICE }} />Kurs</li>}
      <li><i className="is-dot" style={{ background: BUY }}>+</i>Kupno</li>
      <li><i className="is-dot" style={{ background: SELL }}>−</i>Sprzedaż</li>
      <li><i className="is-dash" style={{ borderColor: BUY }} />Średnia cena kupna</li>
      <li><i className="is-line" style={{ background: MAX }} />Maksimum</li>
      <li><i className="is-line" style={{ background: MIN }} />Minimum</li>
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
        <InstrumentChartLegend hasCandles={data.candles.length > 1} />
      </div>

      <InstrumentPriceChartBody instrument={instrument} data={data} />

      <div className="risk-metric-grid risk-metric-grid-summary mt-4">
        <article className="risk-metric-card"><div className="risk-metric-label"><span>Ostatni kurs</span></div><strong>{lastPrice === null ? "—" : formatCurrency(lastPrice, currency)}</strong><small>{extremes ? formatDate(extremes.last.date) : "brak notowań"}</small></article>
        <article className="risk-metric-card"><div className="risk-metric-label"><span>Średnia cena kupna</span></div><strong>{averageNow === null ? "—" : formatCurrency(averageNow, currency)}</strong><small>{averageNow === null ? "nic nie zostało w portfelu" : <>kurs vs średnia: <span className={tone(vsAverage ?? 0)}>{formatPercent(vsAverage)}</span></>}</small></article>
        <article className="risk-metric-card"><div className="risk-metric-label"><span>W portfelu</span></div><strong>{quantityFormatter.format(instrument.quantity)} szt.</strong><small>{instrument.portfolioNames.join(", ")}</small></article>
        <article className="risk-metric-card"><div className="risk-metric-label"><span>Transakcje</span></div><strong>{buys} / {sells}</strong><small>zakupy / sprzedaże</small></article>
        {extremes ? <article className="risk-metric-card"><div className="risk-metric-label"><span>Zakres kursu</span></div><strong>{percentFormatter.format(extremes.min.close)} – {percentFormatter.format(extremes.max.close)}</strong><small>min {formatDate(extremes.min.date)} · max {formatDate(extremes.max.date)}</small></article> : null}
      </div>
      {timeline.skippedTrades > 0 ? <p className="field-note">Transakcje zapisane w innej walucie niż notowanie ({timeline.skippedTrades}) nie są zaznaczone na wykresie.</p> : null}
      {current?.result?.warning ? <p className="field-note">{current.result.warning}</p> : null}

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

export default function InstrumentChartsWorkspace() {
  const { selectedPortfolios } = usePortfolioWorkspace();
  const instruments = useMemo(() => listChartInstruments(selectedPortfolios), [selectedPortfolios]);
  const initialKey = useSearchParams().get("instrument") ?? undefined;

  if (instruments.length === 0) {
    return <section className="panel"><p className="empty-row">Dodaj akcje, ETF lub kryptowaluty, aby zobaczyć ich wykresy. Obligacje skarbowe nie mają notowań rynkowych.</p></section>;
  }

  return (
    <div className="reports-workspace">
      <InstrumentChart key={initialKey ?? "first"} instruments={instruments} initialKey={initialKey} />
      <InstrumentComparison instruments={instruments} />
    </div>
  );
}
