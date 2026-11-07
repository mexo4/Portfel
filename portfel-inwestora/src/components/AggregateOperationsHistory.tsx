"use client";

import { useMemo, useState } from "react";
import TruncatedText from "@/components/TruncatedText";
import {
  buildAggregateOperationRows,
  filterAggregateOperationRows,
  getAggregateInstrumentTypeLabel,
  getAggregateOperationTypeOptions,
  getAggregateOperationTypeLabel,
  paginateAggregateOperationRows,
  type AggregateOperationPortfolio,
} from "@/lib/aggregate-operations";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { CurrencyCode } from "@/types/portfolio";

const PAGE_SIZE = 30;

export default function AggregateOperationsHistory({
  portfolios,
  scopeLabel,
}: {
  portfolios: AggregateOperationPortfolio[];
  scopeLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [portfolioId, setPortfolioId] = useState("all");
  const [operationType, setOperationType] = useState("all");
  const [instrument, setInstrument] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const rows = useMemo(() => buildAggregateOperationRows(portfolios), [portfolios]);
  const effectivePortfolioId = portfolioId === "all" || portfolios.some((portfolio) => portfolio.id === portfolioId)
    ? portfolioId
    : "all";
  const instruments = useMemo(() => Array.from(new Set(rows.flatMap((row) => [row.instrumentSymbol ?? row.instrumentName ?? ""])
    .filter(Boolean))).sort((left, right) => left.localeCompare(right)), [rows]);
  const operationTypeOptions = useMemo(() => getAggregateOperationTypeOptions(rows), [rows]);
  const filteredRows = useMemo(() => filterAggregateOperationRows(rows, {
    query,
    portfolioId: effectivePortfolioId,
    operationType,
    instrument,
    dateFrom,
    dateTo,
  }), [dateFrom, dateTo, effectivePortfolioId, instrument, operationType, query, rows]);
  const shownRows = paginateAggregateOperationRows(filteredRows, visibleCount);
  const resetPage = () => setVisibleCount(PAGE_SIZE);
  const resetFilters = () => {
    setQuery("");
    setPortfolioId("all");
    setOperationType("all");
    setInstrument("all");
    setDateFrom("");
    setDateTo("");
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <section className="panel aggregate-operations" aria-label="Historia operacji wybranych portfeli">
      <header className="aggregate-operations-header">
        <div>
          <p className="eyebrow">Historia · widok tylko do odczytu</p>
          <h2 className="section-title">Operacje</h2>
          <p className="section-copy">Wpisy pozostają przypisane do rachunku źródłowego. {scopeLabel}</p>
        </div>
        <span className="aggregate-operations-count" aria-live="polite">
          {filteredRows.length.toLocaleString("pl-PL")} {filteredRows.length === 1 ? "operacja" : "operacji"}
        </span>
      </header>

      {rows.length ? (
        <div className="aggregate-operations-filters" aria-label="Filtry operacji">
          <label className="field aggregate-operations-search">
            <span>Szukaj</span>
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder="Instrument, ticker, typ, portfel…" />
          </label>
          <label className="field">
            <span>Portfel źródłowy</span>
            <select value={effectivePortfolioId} onChange={(event) => { setPortfolioId(event.target.value); resetPage(); }}>
              <option value="all">Wszystkie portfele</option>
              {portfolios.map((portfolio) => <option value={portfolio.id} key={portfolio.id}>{portfolio.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Typ operacji</span>
            <select value={operationType} onChange={(event) => { setOperationType(event.target.value); resetPage(); }}>
              <option value="all">Wszystkie typy</option>
              {operationTypeOptions.map((label) => <option value={label} key={label}>{label}</option>)}
            </select>
          </label>
          <label className="field aggregate-operations-instrument">
            <span>Instrument</span>
            <select value={instrument} onChange={(event) => { setInstrument(event.target.value); resetPage(); }}>
              <option value="all">Wszystkie instrumenty</option>
              {instruments.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Od</span>
            <input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); resetPage(); }} />
          </label>
          <label className="field">
            <span>Do</span>
            <input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); resetPage(); }} />
          </label>
          <button className="ghost-button aggregate-operations-reset" type="button" onClick={resetFilters}>Wyczyść filtry</button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="aggregate-operations-empty">
          <span aria-hidden="true">↗</span>
          <strong>Brak zapisanych operacji</strong>
          <p>Gdy pojawią się transakcje, wpłaty lub inne wpisy, historia zbiorcza pokaże je tutaj z nazwą portfela źródłowego.</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="aggregate-operations-empty aggregate-operations-empty-filtered">
          <strong>Brak operacji pasujących do filtrów</strong>
          <p>Zmień kryteria wyszukiwania albo wyczyść filtry, aby zobaczyć pełną historię.</p>
          <button className="ghost-button" type="button" onClick={resetFilters}>Wyczyść filtry</button>
        </div>
      ) : (
        <>
          <div className="aggregate-operations-ledger" role="list" aria-label="Operacje według daty">
            {shownRows.map((row) => {
              const operation = row.operation;
              const operationLabel = getAggregateOperationTypeLabel(operation);
              const instrumentLabel = row.instrumentName && row.instrumentSymbol
                ? `${row.instrumentName} (${row.instrumentSymbol})`
                : row.instrumentName ?? row.instrumentSymbol;
              const instrumentTypeLabel = getAggregateInstrumentTypeLabel(row.instrumentType);
              const isShort = operation.metadata.positionDirection === "SHORT";
              const marketCurrency = typeof operation.metadata.marketCurrency === "string"
                ? operation.metadata.marketCurrency as CurrencyCode
                : operation.currency;
              const feeCurrency = typeof operation.metadata.feeCurrency === "string"
                ? operation.metadata.feeCurrency as CurrencyCode
                : operation.currency;
              const taxCurrency = typeof operation.metadata.taxCurrency === "string"
                ? operation.metadata.taxCurrency as CurrencyCode
                : operation.currency;
              const targetAmount = typeof operation.metadata.targetAmount === "number"
                && Number.isFinite(operation.metadata.targetAmount)
                ? operation.metadata.targetAmount
                : null;
              const targetCurrency = typeof operation.metadata.targetCurrency === "string"
                ? operation.metadata.targetCurrency as CurrencyCode
                : null;

              return (
                <article className="aggregate-operation-row" key={row.key} role="listitem">
                  <div className="aggregate-operation-date">
                    <time dateTime={operation.date}>{formatDate(operation.date)}</time>
                    <span className={`aggregate-operation-type${isShort ? " is-derivative" : ""}`}>{operationLabel}</span>
                  </div>
                  <div className="aggregate-operation-main">
                    <div className="aggregate-operation-title">
                      <div>
                        {instrumentLabel ? <TruncatedText as="p" className="table-title" text={instrumentLabel} /> : <p className="table-title">{operationLabel}</p>}
                        <div className="aggregate-operation-meta">
                          {instrumentTypeLabel ? <span>{instrumentTypeLabel}</span> : null}
                          {row.accountName ? <span>{row.accountName}</span> : null}
                          {row.portfolioName ? <span className="aggregate-operation-source"><small>Portfel</small>{row.portfolioName}</span> : null}
                        </div>
                      </div>
                    </div>
                    <div className="aggregate-operation-values">
                      <strong>{formatCurrency(operation.amount, operation.currency)}</strong>
                      {row.result ? (
                        <small className={row.result.amount > 0 ? "tone-positive" : row.result.amount < 0 ? "tone-negative" : ""}>
                          Wynik {formatCurrency(row.result.amount, row.result.currency as CurrencyCode)}
                        </small>
                      ) : null}
                    </div>
                  </div>

                  <details className="aggregate-operation-details">
                    <summary aria-label={`Szczegóły: ${operationLabel} · ${row.portfolioName}`}>Szczegóły</summary>
                    <div className="aggregate-operation-detail-grid">
                      {operation.quantity !== null ? <div><span>Ilość</span><strong>{formatNumber(operation.quantity)}</strong></div> : null}
                      {operation.price !== null ? <div><span>Cena jednostkowa</span><strong>{formatCurrency(operation.price, marketCurrency)}</strong></div> : null}
                      {operation.fee !== 0 ? <div><span>Prowizja</span><strong>{formatCurrency(operation.fee, feeCurrency)}</strong></div> : null}
                      {operation.tax !== 0 ? <div><span>Podatek</span><strong>{formatCurrency(operation.tax, taxCurrency)}</strong></div> : null}
                      {targetAmount !== null && targetCurrency ? <div><span>Kwota docelowa</span><strong>{formatCurrency(targetAmount, targetCurrency)}</strong></div> : null}
                      {operation.exchangeRate !== null ? <div><span>Kurs walutowy zapisany przy operacji</span><strong>{formatNumber(operation.exchangeRate)}</strong></div> : null}
                      {operation.notes.trim() ? <div className="aggregate-operation-note"><span>Notatka</span><strong>{operation.notes}</strong></div> : null}
                      {row.accountName ? <div><span>Konto</span><strong>{row.accountName}</strong></div> : null}
                      {row.targetAccountName ? <div><span>Konto docelowe</span><strong>{row.targetAccountName}</strong></div> : null}
                      <div><span>Portfel źródłowy</span><strong>{row.portfolioName}</strong></div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>
          {filteredRows.length > shownRows.length ? (
            <footer className="aggregate-operations-pagination">
              <span>Wyświetlono {shownRows.length.toLocaleString("pl-PL")} z {filteredRows.length.toLocaleString("pl-PL")}</span>
              <button className="ghost-button" type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>Pokaż kolejne {Math.min(PAGE_SIZE, filteredRows.length - shownRows.length)}</button>
            </footer>
          ) : null}
        </>
      )}
    </section>
  );
}
