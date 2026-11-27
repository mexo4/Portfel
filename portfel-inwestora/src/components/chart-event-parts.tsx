"use client";

import type { ChartAnnouncement, ChartDividend, ChartEvent, EventSlot } from "@/lib/chart-events";
import type { CandleInterval } from "@/lib/instrument-chart";
import { formatCurrency, formatDate } from "@/lib/utils";

/** Dividend and ESPI marks of the line and the candle chart, in two lanes under the price. */

export const DIVIDEND_MARK = "#eda100";
export const ESPI_MARK = "#6250d6";

/** Heights of the lanes on a hidden 0–1 scale over the plot. */
const LANES = { dividend: 0.105, espi: 0.035 } as const;
/** The part of the price range left free under the lowest price, so the marks cover no price. */
export const LANE_ROOM = 0.18;

/** About one mark for every 12 px, so neighbouring marks stay apart. */
export const maxEventSlots = (width: number, isNarrow: boolean) => Math.max(16, Math.round((width || (isNarrow ? 340 : 900)) / 12));

export type EventMark = { kind: ChartEvent["kind"]; lane: number; slot: EventSlot<ChartEvent> };

/** One mark for each kind of event in a slot. */
export const toEventMarks = (slots: Array<EventSlot<ChartEvent>>, kind: ChartEvent["kind"]): EventMark[] =>
  slots.filter((slot) => slot.events.some((event) => event.kind === kind)).map((slot) => ({ kind, lane: LANES[kind], slot }));

export function EventMarkShape({ cx = 0, cy = 0, payload }: { cx?: number; cy?: number; payload?: { kind?: ChartEvent["kind"] } }) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx === null || cy === null) return null;
  if (payload?.kind === "dividend") {
    return (
      <g>
        <rect x={cx - 6.5} y={cy - 6.5} width={13} height={13} rx={3} fill={DIVIDEND_MARK} stroke="#ffffff" strokeWidth={1.5} />
        <text x={cx} y={cy + 3.4} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#13314a">D</text>
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={4.5} fill={ESPI_MARK} stroke="#ffffff" strokeWidth={1.5} />;
}

const TOOLTIP_REPORTS = 3;
const shorten = (text: string) => (text.length > 90 ? `${text.slice(0, 87).trimEnd()}…` : text);

export const describeDividendDates = (dividend: ChartDividend) =>
  dividend.exDividendDate && dividend.exDividendDate < dividend.paymentDate
    ? `odcięcie ${formatDate(dividend.exDividendDate)}, wypłata ${formatDate(dividend.paymentDate)}`
    : `wypłata ${formatDate(dividend.paymentDate)}`;

export function EventTooltipLines({ slot, interval }: { slot: EventSlot<ChartEvent> | null; interval: CandleInterval }) {
  if (!slot) return null;
  const dividends = slot.events.filter((event): event is ChartDividend => event.kind === "dividend");
  const reports = slot.events.filter((event): event is ChartAnnouncement => event.kind === "espi").reverse();
  return (
    <>
      {interval !== "D" ? <span className="chart-tooltip-heading">Zdarzenia w tym {interval === "W" ? "tygodniu" : "miesiącu"}:</span> : null}
      {dividends.map((dividend) => (
        <span key={dividend.id} className="chart-tooltip-dividend">
          Dywidenda {formatCurrency(dividend.netAmount, dividend.currency)} netto
          {dividend.dividendPerShare > 0 ? ` (${formatCurrency(dividend.dividendPerShare, dividend.currency)} na akcję)` : ""}, {describeDividendDates(dividend)}
        </span>
      ))}
      {reports.slice(0, TOOLTIP_REPORTS).map((report) => (
        <span key={report.id} className="chart-tooltip-espi">ESPI {formatDate(report.date)}: {shorten(report.title)}</span>
      ))}
      {reports.length > TOOLTIP_REPORTS ? <span className="chart-tooltip-heading">i {reports.length - TOOLTIP_REPORTS} więcej na liście komunikatów</span> : null}
    </>
  );
}
