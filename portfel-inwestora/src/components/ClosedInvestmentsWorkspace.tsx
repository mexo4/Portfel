"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { buildClosedInvestments, type ClosedInvestmentTrade } from "@/lib/closed-investments";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { InvestmentPortfolio } from "@/types/portfolio";

const percentFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantityFormatter = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 6 });

const formatPercent = (value: number | null) => (value === null ? "—" : `${value > 0 ? "+" : ""}${percentFormatter.format(value)}%`);
const tone = (value: number) => (value > 0 ? "tone-positive" : value < 0 ? "tone-negative" : undefined);
const formatDays = (days: number | null) => (days === null ? "—" : days === 1 ? "1 dzień" : `${days} dni`);

const TRANSACTION_LABELS: Record<ClosedInvestmentTrade["transactionKind"], string> = {
  sale: "Sprzedaż",
  "bond-redemption": "Wykup obligacji",
  "bond-swap": "Zamiana obligacji",
};

function TradeDetails({ trades, showPortfolio }: { trades: ClosedInvestmentTrade[]; showPortfolio: boolean }) {
  return (
    <div className="closed-trades">
      {trades.map((trade) => (
        <article key={trade.id} className="closed-trade">
          <header>
            <strong>{TRANSACTION_LABELS[trade.transactionKind]} {formatDate(trade.saleDate)}</strong>
            <span>
              {quantityFormatter.format(trade.quantity)} szt. po {formatCurrency(trade.salePrice, trade.saleCurrency)}
              {trade.direction === "SHORT" ? " · short" : ""}
              {showPortfolio ? ` · ${trade.portfolioName}` : ""}
            </span>
          </header>
          <dl>
            <div><dt>Koszt</dt><dd>{formatCurrency(trade.investedPln, "PLN")}</dd></div>
            <div><dt>Przychód</dt><dd>{formatCurrency(trade.proceedsPln, "PLN")}</dd></div>
            <div><dt>Wynik</dt><dd className={tone(trade.profitLossPln)}>{formatCurrency(trade.profitLossPln, "PLN")} · {formatPercent(trade.returnPercent)}</dd></div>
            <div><dt>Czas trzymania</dt><dd>{formatDays(trade.holdingDays)}</dd></div>
          </dl>
          {trade.lots.length > 0 ? (
            <ul aria-label="Zamknięte zakupy (FIFO)">
              {trade.lots.map((lot) => (
                <li key={`${trade.id}-${lot.lotId}-${lot.purchaseDate}`}>
                  {quantityFormatter.format(lot.quantity)} szt. kupione {formatDate(lot.purchaseDate)} po {formatCurrency(lot.purchasePrice, lot.priceCurrency)}
                  <span> · koszt {formatCurrency(lot.investedPln, "PLN")}{lot.buyFeePln > 0 ? ` (w tym prowizja ${formatCurrency(lot.buyFeePln, "PLN")})` : ""} · {formatDays(lot.holdingDays)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {trade.saleFeePln > 0 ? <p className="field-note">Prowizja od sprzedaży: {formatCurrency(trade.saleFeePln, "PLN")}</p> : null}
        </article>
      ))}
    </div>
  );
}

export default function ClosedInvestmentsWorkspace({ portfolios }: { portfolios: InvestmentPortfolio[] }) {
  const [year, setYear] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const report = useMemo(() => buildClosedInvestments(portfolios, { year }), [portfolios, year]);
  const allYears = useMemo(() => buildClosedInvestments(portfolios).years, [portfolios]);
  const unlinkedResults = useMemo(
    () => portfolios.flatMap((portfolio) => portfolio.realizedAdjustments ?? []).filter((adjustment) => adjustment.source !== "bond-coupon").length,
    [portfolios]
  );
  const showPortfolio = portfolios.length > 1;
  const { totals } = report;

  return (
    <div className="closed-investments">
      <section className="panel">
        <div className="risk-section-heading">
          <div>
            <p className="eyebrow">Zamknięte inwestycje</p>
            <h2 className="section-title">Wynik zrealizowany</h2>
          </div>
          <label className="field closed-year-field">
            <span>Okres</span>
            <select value={year ?? ""} onChange={(event) => { setYear(event.target.value ? Number(event.target.value) : null); setExpanded(null); }}>
              <option value="">Wszystkie lata</option>
              {allYears.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>

        <div className="risk-metric-grid risk-metric-grid-summary mt-5">
          <article className="risk-metric-card"><div className="risk-metric-label"><span>Wynik zrealizowany</span></div><strong className={tone(totals.profitLossPln)}>{formatCurrency(totals.profitLossPln, "PLN")}</strong><small>{formatPercent(totals.returnPercent)} kosztu zamkniętych pozycji</small></article>
          <article className="risk-metric-card"><div className="risk-metric-label"><span>Zamknięcia</span></div><strong>{totals.trades}</strong><small>{totals.winningTrades} z zyskiem · {totals.losingTrades} ze stratą</small></article>
          <article className="risk-metric-card"><div className="risk-metric-label"><span>Skuteczność</span></div><strong>{totals.winRatePercent === null ? "—" : `${percentFormatter.format(totals.winRatePercent)}%`}</strong><small>Udział zamknięć z zyskiem</small></article>
          <article className="risk-metric-card"><div className="risk-metric-label"><span>Zyski i straty</span></div><strong>{formatCurrency(totals.grossProfitPln, "PLN")}</strong><small>Straty: {formatCurrency(totals.grossLossPln, "PLN")}</small></article>
          <article className="risk-metric-card"><div className="risk-metric-label"><span>Współczynnik zysku</span></div><strong>{totals.profitFactor === null ? "—" : percentFormatter.format(totals.profitFactor)}</strong><small>Suma zysków ÷ suma strat</small></article>
          <article className="risk-metric-card"><div className="risk-metric-label"><span>Średni czas trzymania</span></div><strong>{formatDays(totals.averageHoldingDays)}</strong><small>Ważony liczbą sprzedanych sztuk</small></article>
        </div>

        <p className="field-note mt-4">
          Koszt zamkniętych pozycji ustala się metodą FIFO: każda sprzedaż zamyka najpierw najstarsze zakupy. Kwoty są w PLN po kursach zapisanych przy transakcjach, tak samo jak w wynikach portfela. Do zeznania podatkowego przelicz je kursami NBP w <Link href="/tools/taxes" className="auth-link">zestawieniu PIT-38</Link>.
        </p>
        {unlinkedResults > 0 ? (
          <p className="field-note">Wyniki dopisane ręcznie albo zaimportowane bez danych zakupu ({unlinkedResults}) nie mają przypisanych zakupów, więc nie ma ich w tej tabeli.</p>
        ) : null}
      </section>

      <section className="panel">
        <div className="risk-section-heading">
          <div>
            <p className="eyebrow">Według waloru</p>
            <h2 className="section-title">Podsumowanie zamknięć</h2>
          </div>
        </div>
        {report.summary.length === 0 ? (
          <p className="empty-row mt-4">Brak zamkniętych inwestycji{year ? ` w ${year} roku` : ""}. Pojawią się tu po pierwszej sprzedaży.</p>
        ) : (
          <div className="sprint-table-wrap mt-4">
            <table className="portfolio-table sprint-table closed-summary-table">
              <thead>
                <tr>
                  <th>Walor</th>
                  <th>Zamknięcia</th>
                  <th>Koszt</th>
                  <th>Przychód</th>
                  <th>Wynik</th>
                  <th>Ostatnio</th>
                  <th><span className="sr-only">Szczegóły</span></th>
                </tr>
              </thead>
              <tbody>
                {report.summary.map((row) => {
                  const isOpen = expanded === row.instrumentKey;
                  const rowTrades = report.trades.filter((trade) => trade.instrumentKey === row.instrumentKey);
                  return (
                    <Fragment key={row.instrumentKey}>
                      <tr>
                        <td><strong>{row.name}</strong><small className="block">{row.symbol} · {quantityFormatter.format(row.quantity)} szt.</small></td>
                        <td data-label="Zamknięcia">{row.trades}<small className="block">{row.winningTrades} z zyskiem</small></td>
                        <td data-label="Koszt">{formatCurrency(row.investedPln, "PLN")}</td>
                        <td data-label="Przychód">{formatCurrency(row.proceedsPln, "PLN")}</td>
                        <td data-label="Wynik" className={tone(row.profitLossPln)}>{formatCurrency(row.profitLossPln, "PLN")}<small className="block">{formatPercent(row.returnPercent)}</small></td>
                        <td data-label="Ostatnia sprzedaż">{formatDate(row.lastSaleDate)}</td>
                        <td>
                          <button type="button" className="ghost-button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : row.instrumentKey)}>
                            {isOpen ? "Zwiń" : "Szczegóły"}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="closed-detail-row">
                          <td colSpan={7}><TradeDetails trades={rowTrades} showPortfolio={showPortfolio} /></td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
