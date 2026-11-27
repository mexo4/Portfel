"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EventTooltipLines, LANE_ROOM, maxEventSlots } from "@/components/chart-event-parts";
import { findEventSlot, niceTicks, placeChartEvents, toEventMarks, type ChartEvent, type EventMark, type EventSlot } from "@/lib/chart-events";
import {
  aggregateCandles,
  averagePriceOn,
  findCandleBar,
  pickCandleInterval,
  separateOpposingTrades,
  type AveragePriceStep,
  type Candle,
  type CandleBar,
  type CandleInterval,
  type InstrumentTrade,
} from "@/lib/instrument-chart";
import { AXIS, BUY, CANDLE_DOWN, CANDLE_UP, MAX, MIN, eventDots, monthTick, tradeDots } from "@/components/instrument-chart-parts";
import { getQuantityUnit } from "@/lib/cfd";
import { formatCurrency, formatDate } from "@/lib/utils";

/**
 * Candles of an instrument with the user's purchases, sales and average purchase price. A rising
 * candle is green and a falling one red; trade marks are white with a coloured ring.
 * When there are more sessions than the width can show, weeks or months are drawn.
 */

type CandleRow = CandleBar & { key: string; range: [number, number]; average: number | null };
type Marker = InstrumentTrade & { key: string };

export const INTERVAL_LABELS: Record<CandleInterval, string> = { D: "dzienne", W: "tygodniowe", M: "miesięczne" };

/** About one candle for every 3.6 px, so bodies stay visible on a phone and on a wide screen. */
const maxBarsFor = (width: number) => Math.min(260, Math.max(50, Math.round(width / 3.6)));

const toTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const percent = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 6 });

function CandleShape({ x = 0, y = 0, width = 0, height = 0, payload }: { x?: number; y?: number; width?: number; height?: number; payload?: CandleRow }) {
  if (!payload) return null;
  const { open, high, low, close } = payload;
  // The bar spans low to high, so prices inside it are placed in proportion.
  const scale = high > low ? Math.abs(height) / (high - low) : 0;
  const top = Math.min(y, y + height);
  const yOf = (price: number) => top + (high - price) * scale;
  const bodyTop = yOf(Math.max(open, close));
  const bodyHeight = Math.max(1, yOf(Math.min(open, close)) - bodyTop);
  const center = x + width / 2;
  const colour = close >= open ? CANDLE_UP : CANDLE_DOWN;
  return (
    <g>
      <line x1={center} x2={center} y1={top} y2={top + Math.abs(height)} stroke={colour} strokeWidth={1} />
      <rect x={x} y={bodyTop} width={Math.max(1, width)} height={bodyHeight} fill={colour} stroke={colour} strokeWidth={1} />
    </g>
  );
}

const barTitle = (row: CandleRow, interval: CandleInterval) => {
  if (interval === "D") return formatDate(row.to);
  if (interval === "W") return `Tydzień ${formatDate(row.from)} – ${formatDate(row.to)}`;
  return `Miesiąc: ${formatDate(row.from)} – ${formatDate(row.to)}`;
};

type CandleEventMark = EventMark & { key: string };

function CandleTooltip({ active, label, rows, markers, interval, currency, isCfd, eventSlots, eventInterval }: { active?: boolean; label?: string | number; rows: Map<string, CandleRow>; markers: Marker[]; interval: CandleInterval; currency: string; isCfd?: boolean; eventSlots: Array<EventSlot<ChartEvent>>; eventInterval: CandleInterval }) {
  const row = active ? rows.get(String(label)) : undefined;
  if (!row) return null;
  const change = (row.close / row.open - 1) * 100;
  return (
    <div className="report-tooltip">
      <strong>{barTitle(row, interval)}</strong>
      <span>Otwarcie: {formatCurrency(row.open, currency)}</span>
      <span>Najwyższy: {formatCurrency(row.high, currency)}</span>
      <span>Najniższy: {formatCurrency(row.low, currency)}</span>
      <span>Zamknięcie: {formatCurrency(row.close, currency)} <em className={change > 0 ? "tone-positive" : change < 0 ? "tone-negative" : undefined}>({change > 0 ? "+" : ""}{percent.format(change)}%)</em></span>
      {row.average !== null ? <span>Średnia cena kupna: {formatCurrency(row.average, currency)}</span> : null}
      {markers.filter((marker) => marker.key === row.key).map((trade) => (
        <span key={trade.id} className={trade.side === "buy" ? "tone-positive" : "tone-negative"}>
          {trade.side === "buy" ? "Kupno" : "Sprzedaż"} {formatDate(trade.date)}: {quantity.format(trade.quantity)} {getQuantityUnit(trade.quantity, isCfd)} po{formatCurrency(trade.price, currency)}
        </span>
      ))}
      <EventTooltipLines slot={findEventSlot(eventSlots, row.from, row.to)} interval={eventInterval} />
    </div>
  );
}

export default function InstrumentCandleChart({ candles, trades, averagePriceSteps, events, currency, isCfd, height, isNarrow, ariaLabel }: {
  candles: Candle[];
  trades: InstrumentTrade[];
  averagePriceSteps: AveragePriceStep[];
  events: ChartEvent[];
  currency: string;
  isCfd?: boolean;
  height?: number;
  isNarrow: boolean;
  ariaLabel: string;
}) {
  const [width, setWidth] = useState(0);
  const interval = pickCandleInterval(candles.length, width > 0 ? maxBarsFor(width) : isNarrow ? 80 : 130);
  const rows = useMemo<CandleRow[]>(() => aggregateCandles(candles, interval).map((bar) => ({ ...bar, key: bar.from, range: [bar.low, bar.high], average: averagePriceOn(averagePriceSteps, bar.to) })), [averagePriceSteps, candles, interval]);
  const rowsByKey = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);
  const markers = useMemo<Marker[]>(() => {
    const lastDay = rows.at(-1)?.to ?? "";
    const placed = trades.flatMap((trade) => {
      const bar = trade.date <= lastDay ? findCandleBar(rows, trade.date) : null;
      return bar ? [{ ...trade, key: bar.from }] : [];
    });
    return separateOpposingTrades(placed, (marker) => marker.key);
  }, [rows, trades]);

  // Marks are never finer than the candles, so each candle has at most one slot of events.
  const placement = useMemo(() => placeChartEvents(candles.map((candle) => candle.date), events, maxEventSlots(width, isNarrow), interval), [candles, events, interval, isNarrow, width]);
  const eventMarks = useMemo(() => {
    const toMarks = (kind: ChartEvent["kind"]): CandleEventMark[] => toEventMarks(placement.slots, kind).flatMap((mark) => {
      const bar = findCandleBar(rows, mark.session);
      return bar ? [{ ...mark, key: bar.from }] : [];
    });
    return { dividend: toMarks("dividend"), espi: toMarks("espi") };
  }, [placement, rows]);

  const max = rows.reduce((value, row) => Math.max(value, row.high), -Infinity);
  const min = rows.reduce((value, row) => Math.min(value, row.low), Infinity);
  // The scale also has to hold trade prices and the average, which can lie outside the sessions.
  const drawn = [max, min, ...markers.map((marker) => marker.price), ...rows.flatMap((row) => (row.average === null ? [] : [row.average]))];
  const top = Math.max(...drawn);
  const bottom = Math.min(...drawn);
  const padding = (top - bottom || top) * 0.06;
  // With marks under the price, the scale leaves them room below the lowest value drawn.
  const hasEventMarks = placement.slots.length > 0;
  const lowerEnd = bottom - (hasEventMarks ? (top - bottom || top) * LANE_ROOM : padding);

  /** The first bar of each month, thinned so the axis shows a handful of dates. */
  const ticks = useMemo(() => {
    const starts = rows.filter((row, index) => index > 0 && row.from.slice(0, 7) !== rows[index - 1]!.from.slice(0, 7));
    const step = Math.max(1, Math.ceil(starts.length / (isNarrow ? 4 : 7)));
    return starts.filter((_, index) => index % step === 0).map((row) => row.key);
  }, [isNarrow, rows]);

  return (
    <div className="instrument-chart mt-3" style={height ? { height } : undefined} role="img" aria-label={`${ariaLabel} Świece ${INTERVAL_LABELS[interval]}.`}>
      <ResponsiveContainer width="100%" height="100%" onResize={(nextWidth) => setWidth(nextWidth)}>
        <ComposedChart data={rows} margin={{ top: 16, right: 8, bottom: 0, left: 4 }} barCategoryGap="25%">
          <CartesianGrid stroke="rgba(20, 35, 48, 0.08)" strokeDasharray="3 10" vertical={false} />
          <XAxis dataKey="key" type="category" allowDuplicatedCategory={false} ticks={ticks} interval={0} axisLine={false} tickLine={false} tick={AXIS} tickFormatter={(key: string) => monthTick(toTime(key))} />
          <YAxis type="number" domain={[lowerEnd, top + padding]} {...(hasEventMarks ? { ticks: niceTicks(bottom, top + padding) } : {})} allowDataOverflow axisLine={false} tickLine={false} tick={AXIS} orientation="right" width={64} tickFormatter={(value: number) => percent.format(value)} />
          <Tooltip content={<CandleTooltip rows={rowsByKey} markers={markers} interval={interval} currency={currency} isCfd={isCfd} eventSlots={placement.slots} eventInterval={placement.interval} />} cursor={{ stroke: "rgba(20, 35, 48, 0.16)", strokeDasharray: "6 8", fill: "transparent" }} wrapperStyle={{ outline: "none", zIndex: 20 }} />
          <ReferenceLine y={max} stroke={MAX} strokeWidth={1} strokeDasharray="2 3" label={{ value: `max ${percent.format(max)}`, position: "insideTopLeft", fill: MAX, fontSize: 11, fontWeight: 700 }} />
          <ReferenceLine y={min} stroke={MIN} strokeWidth={1} strokeDasharray="2 3" label={{ value: `min ${percent.format(min)}`, position: "insideBottomLeft", fill: MIN, fontSize: 11, fontWeight: 700 }} />
          <Bar dataKey="range" shape={<CandleShape />} maxBarSize={14} isAnimationActive={false} name="Kurs" />
          <Line dataKey="average" type="stepAfter" stroke={BUY} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} name="Średnia cena kupna" />
          {tradeDots(markers, (marker) => marker.key, [60, 380], true)}
          {eventDots(eventMarks.espi, (mark) => mark.key, [lowerEnd, top + padding])}
          {eventDots(eventMarks.dividend, (mark) => mark.key, [lowerEnd, top + padding])}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
