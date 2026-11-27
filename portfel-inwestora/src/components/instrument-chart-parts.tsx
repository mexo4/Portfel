"use client";

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
 * A circle with + for a purchase or − for a sale; its size follows the amount. On candles, which
 * are green and red themselves, the circle is white with a coloured ring so it stays visible.
 */
export function TradeShape({ cx = 0, cy = 0, size = 64, payload, outlined = false }: { cx?: number; cy?: number; size?: number; payload?: InstrumentTrade; outlined?: boolean }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx === null || cy === null) return null;
  const radius = Math.max(5, Math.sqrt(size / Math.PI));
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
