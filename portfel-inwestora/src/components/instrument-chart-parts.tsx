"use client";

import { ReferenceDot } from "recharts";
import { EventMarkShape } from "@/components/chart-event-parts";
import type { EventMark } from "@/lib/chart-events";
import type { InstrumentTrade } from "@/lib/instrument-chart";

/** Colours, the trade mark and the date labels shared by the line and the candle chart. */

export const PRICE = "#13314a";
export const BUY = "#11804c";
export const SELL = "#c3352b";
export const MAX = "#b9771c";
export const MIN = "#2a78d6";
/** Candle colours, a shade lighter than the trade marks. */
export const CANDLE_UP = "#26a269";
export const CANDLE_DOWN = "#e0453a";
export const AXIS = { fill: "#7b8895", fontSize: 11, fontWeight: 700 };

const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

export const monthTick = (time: number) => {
  const date = new Date(time);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
};

/**
 * The order to draw trade marks in: the largest last. Marks of several sales at one price then
 * show as one clean circle instead of small rings on top of a big one.
 */
export const inDrawingOrder = <T extends { amount: number }>(markers: T[]) => [...markers].sort((left, right) => left.amount - right.amount);

/**
 * A circle with + for a purchase or − for a sale; its size follows the amount. On candles, which
 * are green and red themselves, the circle is white with a coloured ring so it stays visible.
 */
export function TradeShape({ cx: center = 0, cy = 0, size = 64, payload, outlined = false }: { cx?: number; cy?: number; size?: number; payload?: InstrumentTrade & { nudge?: number }; outlined?: boolean }) {
  if (!Number.isFinite(center) || !Number.isFinite(cy) || center === null || cy === null) return null;
  const radius = Math.max(5, Math.sqrt(size / Math.PI));
  // A mark moved aside stands next to the other side's mark, so both + and − can be seen.
  const cx = center + (payload?.nudge ?? 0) * radius;
  const isBuy = payload?.side === "buy";
  const arm = Math.min(radius * 0.55, 6);
  const colour = isBuy ? BUY : SELL;
  return (
    <g>
      <circle cx={cx} cy={cy} r={radius} fill={outlined ? "#ffffff" : colour} fillOpacity={outlined ? 1 : 0.9} stroke={outlined ? colour : "#ffffff"} strokeWidth={outlined ? 2.2 : 1.5} />
      <path d={isBuy ? `M${cx - arm} ${cy}H${cx + arm}M${cx} ${cy - arm}V${cy + arm}` : `M${cx - arm} ${cy}H${cx + arm}`} stroke={outlined ? colour : "#ffffff"} strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

/*
 * The marks are reference dots, not scatter series. A series with its own list of points takes
 * part in the tooltip: Recharts then limits the hovered position to the number of marks, so the
 * tooltip stops following the pointer after that many days or candles.
 */

/** Trade marks; the area of each follows its amount, between the two sizes. */
export const tradeDots = <T extends InstrumentTrade & { nudge?: number }>(markers: T[], xOf: (marker: T) => string | number, [smallest, largest]: [number, number], outlined = false) => {
  const highest = Math.max(1, ...markers.map((marker) => marker.amount));
  return inDrawingOrder(markers).map((marker) => {
    const size = smallest + (largest - smallest) * (marker.amount / highest);
    return (
      <ReferenceDot key={marker.id} x={xOf(marker)} y={marker.price} ifOverflow="visible"
        shape={({ cx, cy }: { cx?: number; cy?: number }) => <TradeShape cx={cx} cy={cy} size={size} payload={marker} outlined={outlined} />} />
    );
  });
};

/**
 * Dividend and ESPI marks under the price. A lane is a height from 0 to 1 of the plot; it is put on
 * the price scale, because Recharts draws nothing on an axis that no series uses.
 */
export const eventDots = <T extends EventMark>(marks: T[], xOf: (mark: T) => string | number, [low, high]: readonly [number, number]) =>
  marks.map((mark, index) => (
    <ReferenceDot key={`${mark.kind}-${index}-${xOf(mark)}`} x={xOf(mark)} y={low + mark.lane * (high - low)} ifOverflow="visible"
      shape={({ cx, cy }: { cx?: number; cy?: number }) => <EventMarkShape cx={cx} cy={cy} payload={mark} />} />
  ));

