"use client";

import type { InstrumentTrade } from "@/lib/instrument-chart";

/** Colours, the trade mark and the date labels shared by the line and the candle chart. */

export const PRICE = "#13314a";
export const BUY = "#11804c";
export const SELL = "#c3352b";
export const MAX = "#b9771c";
export const MIN = "#2a78d6";
export const AXIS = { fill: "#7b8895", fontSize: 11, fontWeight: 700 };

const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

export const monthTick = (time: number) => {
  const date = new Date(time);
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
};

/** A filled circle with + for a purchase or − for a sale; its size follows the amount. */
export function TradeShape({ cx = 0, cy = 0, size = 64, payload }: { cx?: number; cy?: number; size?: number; payload?: InstrumentTrade }) {
  const radius = Math.max(5, Math.sqrt(size / Math.PI));
  const isBuy = payload?.side === "buy";
  const arm = Math.min(radius * 0.55, 6);
  return (
    <g>
      <circle cx={cx} cy={cy} r={radius} fill={isBuy ? BUY : SELL} fillOpacity={0.9} stroke="#ffffff" strokeWidth={1.5} />
      <path d={isBuy ? `M${cx - arm} ${cy}H${cx + arm}M${cx} ${cy - arm}V${cy + arm}` : `M${cx - arm} ${cy}H${cx + arm}`} stroke="#ffffff" strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}
