"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { Pit38Report, Pit38SecurityTransaction } from "@/lib/tax-pit38";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { InvestmentPortfolio } from "@/types/portfolio";

const rateFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const quantityFormatter = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 6 });
const tone = (value: number) => (value > 0 ? "tone-positive" : value < 0 ? "tone-negative" : undefined);
const pln = (value: number) => formatCurrency(value, "PLN");

const describeRate = (rate: number, rateDate: string | null, currency: string) =>
  currency === "PLN" ? "w złotych" : `× ${rateFormatter.format(rate)} (NBP ${rateDate ? formatDate(rateDate) : "—"})`;

/** "12,00 USD × 4,1000 (NBP 09.03.2026) = 49,20 zł", or just "12,00 zł" for an amount already in złoty. */
const describeConversion = (converted: { amount: number; currency: string; rate: number; rateDate: string | null; amountPln: number }) =>
  converted.currency === "PLN"
    ? pln(converted.amountPln)
    : `${formatCurrency(converted.amount, converted.currency)} ${describeRate(converted.rate, converted.rateDate, converted.currency)} = ${pln(converted.amountPln)}`;

const pluralPayments = (count: number) => {
  if (count === 1) return "1 wypłata";
  const lastTwo = count % 100;
  const last = count % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? `${count} wypłaty` : `${count} wypłat`;
};

/** Years with a sale or a dividend in the selected portfolios, newest first, always with the current year. */
const getTaxYears = (portfolios: InvestmentPortfolio[]) => {
  const years = new Set<number>([new Date().getFullYear()]);
  for (const portfolio of portfolios) {
    for (const sale of portfolio.sales ?? []) years.add(Number(sale.saleDate.slice(0, 4)));
    for (const operation of portfolio.operations ?? []) if (operation.operationType === "DIVIDEND") years.add(Number(operation.date.slice(0, 4)));
  }
  return [...years].filter((year) => Number.isInteger(year) && year >= 2000).sort((left, right) => right - left);
};

function TransactionDetails({ transaction }: { transaction: Pit38SecurityTransaction }) {
  return (
    <div className="tax-transaction-details">
      {transaction.treatment === "derivative" ? (
        <p>
          Wynik zamknięcia: {transaction.revenue ? describeConversion(transaction.revenue) : "brak kursu NBP"}.
          {" "}Dodatni wynik to przychód, ujemny to koszt.
        </p>
      ) : (
        <>
          <p>
            Przychód: {transaction.revenue ? describeConversion(transaction.revenue) : "brak kursu NBP"}
          </p>
          <ul>
            {transaction.purchases.map((purchase, index) => (
              <li key={`${purchase.purchaseDate}-${index}`}>
                Zakup {formatDate(purchase.purchaseDate)}: {quantityFormatter.format(purchase.quantity)} szt. za {describeConversion(purchase)}
              </li>
            ))}
          </ul>
        </>
      )}
      <p>Prowizje (zakup i sprzedaż): {pln(transaction.feesPln)}</p>
      {transaction.missingRates.length > 0 ? (
        <p className="field-note-error">Brak kursu NBP dla: {transaction.missingRates.map((item) => `${item.currency} ${formatDate(item.date)}`).join(", ")}. Ta transakcja jest policzona niepełnie.</p>
      ) : null}
    </div>
  );
}

export default function TaxReportWorkspace({ portfolios, scopeLabel }: { portfolios: InvestmentPortfolio[]; scopeLabel: string }) {
  const years = useMemo(() => getTaxYears(portfolios), [portfolios]);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(() => (years.includes(currentYear - 1) ? currentYear - 1 : years[0]));
  const [report, setReport] = useState<Pit38Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const portfolioIds = useMemo(() => portfolios.map((portfolio) => portfolio.id).join(","), [portfolios]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({ year: String(year), portfolioIds });
        const response = await fetch(`/api/tax/pit38?${query.toString()}`, { cache: "no-store", signal: controller.signal });
        const payload = (await response.json()) as { report?: Pit38Report; error?: string };
        if (!response.ok || !payload.report) throw new Error(payload.error || "Nie udało się przygotować zestawienia podatkowego.");
        setReport(payload.report);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setReport(null);
        setError(loadError instanceof Error ? loadError.message : "Nie udało się przygotować zestawienia podatkowego.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [year, portfolioIds]);

  const securities = report?.securities;
  const dividends = report?.foreignDividends;

  return (
    <div className="tax-report">
      <section className="panel">
        <div className="risk-section-heading">
          <div>
            <p className="eyebrow">PIT-38</p>
            <h2 className="section-title">Zestawienie do zeznania</h2>
          </div>
          <label className="field closed-year-field">
            <span>Rok podatkowy</span>
            <select value={year} onChange={(event) => { setYear(Number(event.target.value)); setExpanded(null); }}>
              {years.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <p className="risk-inline-notice mt-4">
          To zestawienie pomocnicze z danych w Mexo, a nie porada podatkowa. Polskie biura maklerskie wystawiają PIT-8C: porównaj z nim kwoty. Zagraniczni brokerzy (np. Interactive Brokers, Degiro, Trading 212) PIT-8C nie wystawiają i dla nich to zestawienie jest najbardziej przydatne.
        </p>
        <p className="field-note mt-3">Zakres: {scopeLabel}. Do zeznania wybierz wszystkie swoje portfele; portfele IKE, IKZE i OKI są pomijane automatycznie.</p>
        {isLoading ? <p className="field-note mt-3" role="status">Pobieram kursy NBP i liczę zestawienie…</p> : null}
        {error ? <p className="field-note-error mt-3" role="alert">{error}</p> : null}
        {report && report.missingRates.length > 0 ? (
          <p className="field-note-error mt-3" role="alert">
            Brakuje kursu NBP dla {report.missingRates.length === 1 ? "jednej daty" : `${report.missingRates.length} dat`} ({report.missingRates.slice(0, 4).map((item) => `${item.currency} ${formatDate(item.date)}`).join(", ")}{report.missingRates.length > 4 ? "…" : ""}). Kwoty tych transakcji nie są w pełni policzone; spróbuj ponownie później.
          </p>
        ) : null}
      </section>

      {securities ? (
        <section className="panel">
          <div className="risk-section-heading">
            <div>
              <p className="eyebrow">Część C · akcje, ETF i CFD</p>
              <h2 className="section-title">Odpłatne zbycie papierów wartościowych</h2>
            </div>
          </div>
          <div className="risk-metric-grid risk-metric-grid-summary mt-5">
            <article className="risk-metric-card"><div className="risk-metric-label"><span>Przychód</span></div><strong>{pln(securities.revenuePln)}</strong><small>Wartość sprzedaży po kursach NBP</small></article>
            <article className="risk-metric-card"><div className="risk-metric-label"><span>Koszty uzyskania przychodu</span></div><strong>{pln(securities.costPln)}</strong><small>Zakupy (FIFO) i prowizje</small></article>
            <article className="risk-metric-card"><div className="risk-metric-label"><span>{securities.lossPln > 0 ? "Strata" : "Dochód"}</span></div><strong className={tone(securities.incomePln - securities.lossPln)}>{pln(securities.lossPln > 0 ? -securities.lossPln : securities.incomePln)}</strong><small>Przychód minus koszty</small></article>
            <article className="risk-metric-card"><div className="risk-metric-label"><span>Podstawa opodatkowania</span></div><strong>{pln(securities.taxBasePln)}</strong><small>Dochód zaokrąglony do pełnych złotych</small></article>
            <article className="risk-metric-card"><div className="risk-metric-label"><span>Podatek 19%</span></div><strong>{pln(securities.taxPln)}</strong><small>Przed odliczeniem strat z lat ubiegłych</small></article>
            <article className="risk-metric-card"><div className="risk-metric-label"><span>Transakcje</span></div><strong>{securities.transactions.length}</strong><small>Zamknięcia w {report?.year} roku</small></article>
          </div>
          {securities.lossPln > 0 ? (
            <p className="field-note mt-4">Stratę możesz odliczać w kolejnych 5 latach: do 50% jej kwoty w jednym roku albo jednorazowo do 5 mln zł.</p>
          ) : (
            <p className="field-note mt-4">Stratę z poprzednich 5 lat odliczasz sam w zeznaniu; to zestawienie jej nie uwzględnia.</p>
          )}
          {securities.transactions.length === 0 ? (
            <p className="empty-row mt-4">Brak sprzedaży akcji, ETF ani CFD w {report?.year} roku.</p>
          ) : (
            <div className="sprint-table-wrap mt-4">
              <table className="portfolio-table sprint-table tax-table">
                <thead>
                  <tr>
                    <th>Data sprzedaży</th>
                    <th>Walor</th>
                    <th>Przychód</th>
                    <th>Koszty</th>
                    <th>Dochód</th>
                    <th><span className="sr-only">Szczegóły</span></th>
                  </tr>
                </thead>
                <tbody>
                  {securities.transactions.map((transaction) => {
                    const isOpen = expanded === transaction.id;
                    return (
                      <Fragment key={transaction.id}>
                        <tr>
                          <td data-label="Data sprzedaży">{formatDate(transaction.saleDate)}</td>
                          <td>
                            <strong>{transaction.name}</strong>
                            <small className="block">{transaction.symbol} · {transaction.treatment === "derivative" ? "CFD" : `${quantityFormatter.format(transaction.quantity)} szt.`}{portfolios.length > 1 ? ` · ${transaction.portfolioName}` : ""}</small>
                          </td>
                          <td data-label="Przychód">{pln(transaction.revenuePln)}</td>
                          <td data-label="Koszty">{pln(transaction.costPln)}</td>
                          <td data-label="Dochód" className={tone(transaction.incomePln)}>{pln(transaction.incomePln)}</td>
                          <td>
                            <button type="button" className="ghost-button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : transaction.id)}>{isOpen ? "Zwiń" : "Jak policzono"}</button>
                          </td>
                        </tr>
                        {isOpen ? <tr className="closed-detail-row"><td colSpan={6}><TransactionDetails transaction={transaction} /></td></tr> : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {dividends ? (
        <section className="panel">
          <div className="risk-section-heading">
            <div>
              <p className="eyebrow">Część G · dywidendy zagraniczne</p>
              <h2 className="section-title">Podatek od dywidend z zagranicy</h2>
            </div>
          </div>
          <div className="risk-metric-grid risk-metric-grid-four mt-5">
            <article className="risk-metric-card"><div className="risk-metric-label"><span>Dywidendy brutto</span></div><strong>{pln(dividends.grossPln)}</strong><small>{pluralPayments(dividends.rows.length)} po kursach NBP</small></article>
            <article className="risk-metric-card"><div className="risk-metric-label"><span>Podatek 19%</span></div><strong>{pln(dividends.polishTaxPln)}</strong><small>Zryczałtowany podatek w Polsce</small></article>
            <article className="risk-metric-card"><div className="risk-metric-label"><span>Zapłacony za granicą</span></div><strong>{pln(dividends.creditablePln)}</strong><small>Do odliczenia, najwyżej 19% brutto</small></article>
            <article className="risk-metric-card"><div className="risk-metric-label"><span>Do dopłaty</span></div><strong>{pln(dividends.toPayPln)}</strong><small>{dividends.domesticTaxPln > 0 ? `Po odjęciu ${pln(dividends.domesticTaxPln)} pobranych przez polskiego brokera` : "Zaokrąglone do pełnych złotych"}</small></article>
          </div>
          {dividends.rows.length === 0 ? (
            <p className="empty-row mt-4">Brak dywidend z zagranicy w {report?.year} roku. Dywidendy polskich spółek rozlicza broker.</p>
          ) : (
            <div className="sprint-table-wrap mt-4">
              <table className="portfolio-table sprint-table tax-table">
                <thead>
                  <tr>
                    <th>Wypłata</th>
                    <th>Spółka</th>
                    <th>Brutto</th>
                    <th>Brutto w PLN</th>
                    <th>Podatek u źródła</th>
                    <th>Do dopłaty</th>
                  </tr>
                </thead>
                <tbody>
                  {dividends.rows.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Wypłata">{formatDate(row.paymentDate)}</td>
                      <td><strong>{row.name}</strong><small className="block">{row.symbol}{row.country ? ` · ${row.country}` : ""}</small></td>
                      <td data-label="Brutto">{row.gross ? formatCurrency(row.gross.amount, row.gross.currency) : "—"}<small className="block">{row.gross ? describeRate(row.gross.rate, row.gross.rateDate, row.gross.currency) : "brak kursu NBP"}</small></td>
                      <td data-label="Brutto w PLN">{row.gross ? pln(row.gross.amountPln) : "—"}</td>
                      <td data-label="Podatek u źródła">{pln(row.withheldAbroadPln)}{row.withheldAbroadPln > row.creditablePln ? <small className="block">odliczysz {pln(row.creditablePln)}</small> : null}</td>
                      <td data-label="Do dopłaty">{pln(row.toPayPln)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="field-note mt-4">Podatek pobrany za granicą ponad 19% (np. 30% w USA bez formularza W-8BEN) nie jest odliczany w Polsce; nadwyżkę można odzyskać tylko w kraju źródła.</p>
        </section>
      ) : null}

      {report ? (
        <section className="panel">
          <div className="risk-section-heading">
            <div>
              <p className="eyebrow">Zakres i metoda</p>
              <h2 className="section-title">Co jest policzone, a co nie</h2>
            </div>
          </div>
          <ul className="tax-method-list mt-4">
            <li>Kwoty w walutach przeliczono kursem średnim NBP z ostatniego dnia roboczego przed transakcją: sprzedaży, każdego zamkniętego zakupu i wypłaty dywidendy.</li>
            <li>Koszt sprzedanych akcji ustalono metodą FIFO (najpierw najstarsze zakupy), z prowizjami od zakupu i sprzedaży.</li>
            <li>Przy CFD dodatni wynik zamknięcia jest przychodem, a ujemny kosztem.</li>
            {report.excluded.taxFreePortfolios.length > 0 ? <li>Pominięte portfele zwolnione z podatku: {report.excluded.taxFreePortfolios.join(", ")}.</li> : null}
            {report.excluded.bondTrades > 0 ? <li>Pominięte wykupy i zamiany obligacji skarbowych ({report.excluded.bondTrades}): podatek pobiera emitent przy wykupie.</li> : null}
            {report.excluded.cryptoTrades > 0 ? <li>Pominięte transakcje kryptowalut ({report.excluded.cryptoTrades}): rozlicza się je w osobnej części PIT-38, na innych zasadach.</li> : null}
            {report.excluded.importedResults.length > 0 ? (
              <li>
                Pominięte wyniki z importu bez danych zakupu ({report.excluded.importedResults.length}, łącznie {pln(report.excluded.importedResults.reduce((total, item) => total + item.amountPln, 0))}): bez dat i cen zakupu nie da się policzyć przychodu ani kosztu. Uzupełnij je na podstawie dokumentów brokera.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
