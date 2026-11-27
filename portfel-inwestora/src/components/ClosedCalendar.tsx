"use client";

import { useMemo, useState } from "react";
import { buildCalendarMonth, listClosingMonths, shiftMonth } from "@/lib/closed-calendar";
import { buildClosedInvestments } from "@/lib/closed-investments";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { InvestmentPortfolio } from "@/types/portfolio";

/** The realized result on a calendar: green and red days, stronger colour for a larger amount. */

const WEEKDAYS = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
const monthName = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric", timeZone: "UTC" });
const compact = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });
const quantityFormatter = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 6 });
const tone = (value: number) => (value > 0 ? "tone-positive" : value < 0 ? "tone-negative" : undefined);
const signed = (value: number) => `${value > 0 ? "+" : ""}${formatCurrency(value, "PLN")}`;
/** Whole złoty on the narrow cells; the exact amount is in the label and the list below. */
const shortAmount = (value: number) => `${value > 0 ? "+" : ""}${compact.format(value)}`;

export default function ClosedCalendar({ portfolios }: { portfolios: InvestmentPortfolio[] }) {
  const trades = useMemo(() => buildClosedInvestments(portfolios).trades, [portfolios]);
  const months = useMemo(() => listClosingMonths(trades), [trades]);
  const [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const [chosenDay, setChosenDay] = useState<string | null>(null);
  const month = chosenMonth ?? months.at(-1) ?? new Date().toISOString().slice(0, 7);
  const calendar = useMemo(() => buildCalendarMonth(trades, month), [month, trades]);

  if (trades.length === 0) {
    return <section className="panel"><p className="empty-row">Kalendarz pokaże się po pierwszej sprzedaży albo wykupie.</p></section>;
  }

  const open = (next: string) => { setChosenMonth(next); setChosenDay(null); };
  const days = calendar.weeks.flat().filter((cell) => cell && cell.trades.length > 0);
  const listed = chosenDay ? days.filter((cell) => cell!.date === chosenDay) : days;

  return (
    <section className="panel closed-calendar">
      <div className="risk-section-heading">
        <div>
          <p className="eyebrow">Kalendarz zamknięć</p>
          <h2 className="section-title closed-calendar-month">{monthName.format(new Date(`${month}-01T00:00:00.000Z`))}</h2>
        </div>
        <div className="closed-calendar-nav">
          <button type="button" className="ghost-button" onClick={() => open(shiftMonth(month, -1))} disabled={month <= months[0]!} aria-label="Poprzedni miesiąc">←</button>
          <label className="field">
            <span className="sr-only">Miesiąc z zamknięciami</span>
            <select value={months.includes(month) ? month : ""} onChange={(event) => open(event.target.value)}>
              {months.includes(month) ? null : <option value="">Wybierz miesiąc</option>}
              {[...months].reverse().map((item) => <option key={item} value={item}>{monthName.format(new Date(`${item}-01T00:00:00.000Z`))}</option>)}
            </select>
          </label>
          <button type="button" className="ghost-button" onClick={() => open(shiftMonth(month, 1))} disabled={month >= months.at(-1)!} aria-label="Następny miesiąc">→</button>
        </div>
      </div>

      <p className="closed-calendar-total">
        Wynik miesiąca: <strong className={tone(calendar.profitLossPln)}>{signed(calendar.profitLossPln)}</strong> · zamknięcia: {calendar.closes} · dni z zamknięciami: {calendar.daysWithCloses}
      </p>

      <table className="closed-calendar-grid">
        <thead><tr>{WEEKDAYS.map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
        <tbody>
          {calendar.weeks.map((week, index) => (
            <tr key={index}>
              {week.map((cell, position) => {
                if (!cell) return <td key={position} className="is-outside" />;
                if (cell.trades.length === 0) return <td key={position}><span className="closed-calendar-number">{cell.day}</span></td>;
                // From a faint to a strong tint, by the share of the month's largest day.
                const strength = calendar.largestDayPln > 0 ? 0.14 + 0.46 * (Math.abs(cell.profitLossPln) / calendar.largestDayPln) : 0.14;
                const colour = cell.profitLossPln > 0 ? `rgba(38, 162, 105, ${strength})` : cell.profitLossPln < 0 ? `rgba(224, 69, 58, ${strength})` : "rgba(100, 116, 139, 0.16)";
                return (
                  <td key={position} style={{ background: colour }}>
                    <button type="button" aria-pressed={chosenDay === cell.date} onClick={() => setChosenDay(chosenDay === cell.date ? null : cell.date)} aria-label={`${formatDate(cell.date)}: ${signed(cell.profitLossPln)}, zamknięcia: ${cell.trades.length}`}>
                      <span className="closed-calendar-number">{cell.day}</span>
                      <strong>{shortAmount(cell.profitLossPln)}<span className="closed-calendar-unit"> zł</span></strong>
                      <small>{cell.trades.length}×</small>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {listed.length > 0 ? (
        <div className="closed-calendar-days">
          <div className="closed-calendar-days-head">
            <h3>{chosenDay ? `Zamknięcia ${formatDate(chosenDay)}` : "Zamknięcia w miesiącu"}</h3>
            {chosenDay ? <button type="button" className="ghost-button" onClick={() => setChosenDay(null)}>Pokaż cały miesiąc</button> : null}
          </div>
          <div className="sprint-table-wrap">
            <table className="portfolio-table sprint-table report-table">
              <thead><tr><th>Walor</th><th>Data</th><th>Ilość</th><th>Wynik</th><th>Portfel</th></tr></thead>
              <tbody>
                {[...listed].reverse().flatMap((cell) => cell!.trades).map((trade) => (
                  <tr key={`${trade.portfolioId}:${trade.id}`}>
                    <td><strong>{trade.name}</strong><small className="block">{trade.symbol}</small></td>
                    <td data-label="Data">{formatDate(trade.saleDate)}</td>
                    <td data-label="Ilość">{quantityFormatter.format(trade.quantity)}</td>
                    <td data-label="Wynik" className={tone(trade.profitLossPln)}>{signed(trade.profitLossPln)}</td>
                    <td data-label="Portfel">{trade.portfolioName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="empty-row mt-4">W tym miesiącu nic nie zostało zamknięte.</p>
      )}
      <p className="field-note mt-4">Wynik w PLN taki, jaki Mexo zapisało przy sprzedaży lub wykupie, w dniu transakcji.</p>
    </section>
  );
}
