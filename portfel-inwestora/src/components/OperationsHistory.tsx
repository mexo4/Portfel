"use client";

import { useMemo, useState, type ReactNode } from "react";
import TruncatedText from "@/components/TruncatedText";
import {
  buildAggregateOperationRows,
  filterAggregateOperationRows,
  getAggregateInstrumentTypeLabel,
  getPolishOperationCountLabel,
  getAggregateOperationTypeOptions,
  getAggregateOperationTypeLabel,
  paginateAggregateOperationRows,
  sortAggregateOperationRows,
  type AggregateOperationPortfolio,
  type AggregateOperationSortMode,
} from "@/lib/aggregate-operations";
import { convertFromPln, getRealizedProfitLossPercent } from "@/lib/pricing";
import { buildAutomaticBondCouponAdjustments } from "@/lib/portfolio-state";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { CurrencyCode, FxRates, PortfolioSale } from "@/types/portfolio";

const PAGE_SIZE = 30;

type OperationsHistoryProps = {
  portfolios: AggregateOperationPortfolio[];
  scopeLabel: string;
  isAggregate: boolean;
  baseCurrency: CurrencyCode;
  fxRates: FxRates;
  headerAction?: ReactNode;
  canUndoSale?: (saleId: string) => boolean;
  onUndoSale?: (saleId: string) => void;
  onRemoveRealizedAdjustment?: (adjustmentId: string) => void;
  children?: ReactNode;
};

const uniqueOptions = (values: (string | null | undefined)[]) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))))
    .sort((left, right) => left.localeCompare(right, "pl-PL"));

const getMetadataCurrency = (operation: { metadata: Record<string, unknown> }, key: string) => {
  const value = operation.metadata[key];
  return typeof value === "string" && value ? value : null;
};

const getSaleProfitLossPln = (sale: PortfolioSale) =>
  sale.transactionKind === "bond-redemption" || sale.transactionKind === "bond-swap"
    ? sale.grossProfitLossPln ?? sale.realizedProfitLossPln
    : sale.realizedProfitLossPln;

const getSaleDisplayProfit = (sale: PortfolioSale) =>
  sale.realizedProfitLossValue ?? sale.realizedProfitLossPln;

export default function OperationsHistory({
  portfolios,
  scopeLabel,
  isAggregate,
  baseCurrency,
  fxRates,
  headerAction,
  canUndoSale,
  onUndoSale,
  onRemoveRealizedAdjustment,
  children,
}: OperationsHistoryProps) {
  const [query, setQuery] = useState("");
  const [portfolioId, setPortfolioId] = useState("all");
  const [operationType, setOperationType] = useState("all");
  const [instrument, setInstrument] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [account, setAccount] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortMode, setSortMode] = useState<AggregateOperationSortMode>("created-desc");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [openDetailsKey, setOpenDetailsKey] = useState<string | null>(null);

  const rows = useMemo(() => buildAggregateOperationRows(portfolios.map((portfolio) => ({
    ...portfolio,
    // Bond coupons are currently an existing read-model projection rather than
    // persisted operations. Include them once in the shared ledger while keeping
    // the persisted portfolio and financial calculations untouched.
    realizedAdjustments: [
      ...portfolio.realizedAdjustments,
      ...buildAutomaticBondCouponAdjustments(portfolio.assets, portfolio.sales, portfolio.accountType),
    ],
  }))), [portfolios]);
  const effectivePortfolioId = !isAggregate || portfolioId === "all" || portfolios.some(({ id }) => id === portfolioId)
    ? portfolioId
    : "all";
  const instruments = useMemo(() => uniqueOptions(rows.map((row) => row.instrumentSymbol ?? row.instrumentName)), [rows]);
  const currencies = useMemo(() => uniqueOptions(rows.flatMap((row) => [
    row.operation.currency,
    getMetadataCurrency(row.operation, "marketCurrency"),
    getMetadataCurrency(row.operation, "feeCurrency"),
    getMetadataCurrency(row.operation, "taxCurrency"),
    getMetadataCurrency(row.operation, "targetCurrency"),
    row.result?.currency,
  ])), [rows]);
  const accounts = useMemo(() => uniqueOptions(rows.flatMap((row) => [row.accountName, row.targetAccountName])), [rows]);
  const operationTypeOptions = useMemo(() => getAggregateOperationTypeOptions(rows), [rows]);
  const filteredRows = useMemo(() => filterAggregateOperationRows(rows, {
    query,
    portfolioId: isAggregate ? effectivePortfolioId : "all",
    operationType,
    instrument,
    currency,
    account,
    dateFrom,
    dateTo,
  }), [account, currency, dateFrom, dateTo, effectivePortfolioId, instrument, isAggregate, operationType, query, rows]);
  const sortedRows = useMemo(() => sortAggregateOperationRows(filteredRows, sortMode), [filteredRows, sortMode]);
  const shownRows = paginateAggregateOperationRows(sortedRows, visibleCount);

  const resetPage = () => setVisibleCount(PAGE_SIZE);
  const resetFilters = () => {
    setQuery("");
    setPortfolioId("all");
    setOperationType("all");
    setInstrument("all");
    setCurrency("all");
    setAccount("all");
    setDateFrom("");
    setDateTo("");
    setSortMode("created-desc");
    resetPage();
  };

  return (
    <section className="panel aggregate-operations" aria-label="Historia operacji" data-operations-scope={isAggregate ? "aggregate" : "single"}>
      <header className="aggregate-operations-header">
        <div className="aggregate-operations-heading">
          <p className="eyebrow">Historia · {isAggregate ? "widok tylko do odczytu" : "portfel"}</p>
          <h2 className="section-title">Operacje</h2>
          <p className="section-copy">
            {isAggregate
              ? `Operacje są przypisane do rachunku źródłowego. ${scopeLabel}`
              : `Pełna historia operacji portfela ${scopeLabel}.`}
          </p>
        </div>
        <div className="aggregate-operations-header-actions">
          {headerAction}
          <span className="aggregate-operations-count" aria-live="polite">
            {filteredRows.length.toLocaleString("pl-PL")} {getPolishOperationCountLabel(filteredRows.length)}
          </span>
        </div>
      </header>

      {rows.length > 0 ? (
        <div className="aggregate-operations-filters" role="group" aria-label="Filtry i sortowanie operacji">
          <label className="field aggregate-operations-search">
            <span>Szukaj</span>
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder="Instrument, ticker, typ, konto…" />
          </label>
          {isAggregate ? (
            <label className="field">
              <span>Portfel</span>
              <select value={effectivePortfolioId} onChange={(event) => { setPortfolioId(event.target.value); resetPage(); }}>
                <option value="all">Wszystkie portfele</option>
                {portfolios.map((portfolio) => <option value={portfolio.id} key={portfolio.id}>{portfolio.name}</option>)}
              </select>
            </label>
          ) : null}
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
            <span>Waluta</span>
            <select value={currency} onChange={(event) => { setCurrency(event.target.value); resetPage(); }}>
              <option value="all">Wszystkie waluty</option>
              {currencies.map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Konto</span>
            <select value={account} onChange={(event) => { setAccount(event.target.value); resetPage(); }}>
              <option value="all">Wszystkie konta</option>
              {accounts.map((value) => <option value={value} key={value}>{value}</option>)}
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
          <label className="field aggregate-operations-sort">
            <span>Sortowanie</span>
            <select value={sortMode} onChange={(event) => { setSortMode(event.target.value as AggregateOperationSortMode); resetPage(); }}>
              <option value="created-desc">Ostatnio dodane</option>
              <option value="date-desc">Data: najnowsze</option>
              <option value="date-asc">Data: najstarsze</option>
              <option value="result-desc">Wynik w PLN: malejąco</option>
              <option value="result-asc">Wynik w PLN: rosnąco</option>
              <option value="symbol-asc">Instrument: A–Z</option>
            </select>
          </label>
          <button className="ghost-button aggregate-operations-reset" type="button" onClick={resetFilters}>Wyczyść filtry</button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="aggregate-operations-empty">
          <span aria-hidden="true">↗</span>
          <strong>Brak zapisanych operacji</strong>
          <p>Zakupy, sprzedaże, wpływy i pozostała aktywność tego zakresu pojawią się tutaj.</p>
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
              const { operation } = row;
              const operationLabel = getAggregateOperationTypeLabel(operation);
              const instrumentLabel = row.instrumentName && row.instrumentSymbol
                ? `${row.instrumentName} (${row.instrumentSymbol})`
                : row.instrumentName ?? row.instrumentSymbol;
              const instrumentTypeLabel = getAggregateInstrumentTypeLabel(row.instrumentType);
              const isShort = operation.metadata.positionDirection === "SHORT";
              const marketCurrency = getMetadataCurrency(operation, "marketCurrency") ?? operation.currency;
              const feeCurrency = getMetadataCurrency(operation, "feeCurrency") ?? operation.currency;
              const taxCurrency = getMetadataCurrency(operation, "taxCurrency") ?? operation.currency;
              const targetAmount = typeof operation.metadata.targetAmount === "number" && Number.isFinite(operation.metadata.targetAmount)
                ? operation.metadata.targetAmount
                : null;
              const targetCurrency = getMetadataCurrency(operation, "targetCurrency");
              const sale = row.sale;
              const isBondSettlement = sale?.transactionKind === "bond-redemption" || sale?.transactionKind === "bond-swap";
              const saleBaseProfit = sale ? convertFromPln(getSaleProfitLossPln(sale), baseCurrency, fxRates) : null;
              const saleBaseInvested = sale ? convertFromPln(sale.realizedInvestedPln, baseCurrency, fxRates) : null;
              const realizedReturnPercent = sale && saleBaseProfit !== null && saleBaseInvested !== null
                ? getRealizedProfitLossPercent(saleBaseProfit, saleBaseInvested)
                : undefined;
              const canUndo = Boolean(sale && canUndoSale?.(sale.id));
              const adjustment = row.realizedAdjustment;

              return (
                <div className="aggregate-operation-row" key={row.key} role="listitem">
                  <div className="aggregate-operation-date">
                    <time dateTime={operation.date}>{formatDate(operation.date)}</time>
                    <span className={`aggregate-operation-type${isShort ? " is-derivative" : ""}`}>{operationLabel}</span>
                  </div>
                  <div className="aggregate-operation-main">
                    <div className="aggregate-operation-title">
                      <div>
                        {instrumentLabel
                          ? <TruncatedText as="p" className="table-title" text={instrumentLabel} />
                          : <p className="table-title">{operationLabel}</p>}
                        <div className="aggregate-operation-meta">
                          {instrumentTypeLabel ? <span>{instrumentTypeLabel}</span> : null}
                          {row.accountName ? <span>{row.accountName}</span> : null}
                          {isAggregate ? <span className="aggregate-operation-source"><small>Portfel</small>{row.portfolioName}</span> : null}
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

                  <details className="aggregate-operation-details" open={openDetailsKey === row.key} onToggle={(event) => {
                    if (event.currentTarget.open) {
                      event.currentTarget.parentElement
                        ?.parentElement
                        ?.querySelectorAll<HTMLDetailsElement>(".aggregate-operation-details")
                        .forEach((details) => {
                          if (details !== event.currentTarget) details.open = false;
                        });
                      setOpenDetailsKey(row.key);
                    } else {
                      setOpenDetailsKey((currentKey) => currentKey === row.key ? null : currentKey);
                    }
                  }}>
                    <summary aria-label={`Szczegóły: ${operationLabel}${isAggregate ? ` · ${row.portfolioName}` : ""}`}>
                      Szczegóły
                    </summary>
                    <div className="aggregate-operation-detail-grid">
                      {operation.quantity !== null ? <div><span>Ilość</span><strong>{formatNumber(operation.quantity)}</strong></div> : null}
                      {operation.price !== null ? <div><span>Cena jednostkowa</span><strong>{formatCurrency(operation.price, marketCurrency as CurrencyCode)}</strong></div> : null}
                      {operation.fee !== 0 ? <div><span>Prowizja</span><strong>{formatCurrency(operation.fee, feeCurrency as CurrencyCode)}</strong></div> : null}
                      {operation.tax !== 0 ? <div><span>Podatek</span><strong>{formatCurrency(operation.tax, taxCurrency as CurrencyCode)}</strong></div> : null}
                      {targetAmount !== null && targetCurrency ? <div><span>Kwota docelowa</span><strong>{formatCurrency(targetAmount, targetCurrency as CurrencyCode)}</strong></div> : null}
                      {operation.exchangeRate !== null ? <div><span>Kurs walutowy zapisany przy operacji</span><strong>{formatNumber(operation.exchangeRate)}</strong></div> : null}
                      {operation.notes.trim() ? <div className="aggregate-operation-note"><span>Notatka</span><strong>{operation.notes}</strong></div> : null}
                      {row.accountName ? <div><span>Konto</span><strong>{row.accountName}</strong></div> : null}
                      {row.targetAccountName ? <div><span>Konto docelowe</span><strong>{row.targetAccountName}</strong></div> : null}
                      {isAggregate ? <div><span>Portfel źródłowy</span><strong>{row.portfolioName}</strong></div> : null}
                      {sale ? (
                        <>
                          {sale.settlementDate ? <div><span>Data rozliczenia</span><strong>{formatDate(sale.settlementDate)}</strong></div> : null}
                          <div><span>Wynik w walucie transakcji</span><strong>{formatCurrency(getSaleDisplayProfit(sale), sale.realizedValueCurrency ?? "PLN")}{realizedReturnPercent !== undefined ? ` · ${realizedReturnPercent > 0 ? "+" : ""}${realizedReturnPercent.toFixed(2)}% od kosztu FIFO` : ""}</strong></div>
                          <div><span>{isBondSettlement ? "Wpływ brutto" : "Wpływ netto"}</span><strong>{formatCurrency(convertFromPln(isBondSettlement ? sale.grossProceedsPln ?? sale.realizedProceedsPln : sale.realizedProceedsPln, baseCurrency, fxRates), baseCurrency)}</strong></div>
                          <div><span>Koszt FIFO</span><strong>{formatCurrency(saleBaseInvested ?? 0, baseCurrency)}</strong></div>
                          <div><span>{isBondSettlement ? "Wpływ netto" : "Prowizja"}</span><strong>{isBondSettlement ? formatCurrency(convertFromPln(sale.realizedProceedsPln, baseCurrency, fxRates), baseCurrency) : formatCurrency(convertFromPln(sale.feePln, baseCurrency, fxRates), baseCurrency)}</strong></div>
                          <div><span>Rozliczone zakupy</span><strong>{sale.allocations.length}</strong></div>
                          {isBondSettlement ? (
                            <>
                              <div><span>Wynik brutto</span><strong>{formatCurrency(convertFromPln(sale.grossProfitLossPln ?? getSaleProfitLossPln(sale), baseCurrency, fxRates), baseCurrency)}</strong></div>
                              <div><span>Podatek</span><strong>{formatCurrency(convertFromPln(sale.taxTotalPln ?? 0, baseCurrency, fxRates), baseCurrency)}</strong></div>
                              <div><span>Opłata</span><strong>{formatCurrency(convertFromPln(sale.redemptionFeeTotalPln ?? 0, baseCurrency, fxRates), baseCurrency)}</strong></div>
                              {sale.transactionKind === "bond-swap" ? <>
                                <div><span>Nowa seria</span><strong>{sale.swapTargetCode ?? "—"}</strong></div>
                                <div><span>Cena zamiany</span><strong>{formatCurrency(sale.swapPricePerUnit ?? 0, "PLN")}</strong></div>
                                <div><span>Ilość po zamianie</span><strong>{formatNumber(sale.swapTargetQuantity ?? 0)}</strong></div>
                                <div><span>Pozostało do wypłaty</span><strong>{formatCurrency(convertFromPln(sale.swapResidualCashPln ?? 0, baseCurrency, fxRates), baseCurrency)}</strong></div>
                              </> : null}
                            </>
                          ) : null}
                          {onUndoSale ? (
                            <div className="aggregate-operation-row-action">
                              {!canUndo ? <p>Tej operacji nie można cofnąć, ponieważ nowsza transakcja rozliczyła te same zakupy.</p> : <p>Cofnięcie przywróci ilość, wynik i statystyki sprzed tej transakcji.</p>}
                              <button className="ghost-button" type="button" disabled={!canUndo} onClick={() => onUndoSale(sale.id)}>
                                Cofnij
                              </button>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {adjustment?.source === "manual" && onRemoveRealizedAdjustment ? (
                        <div className="aggregate-operation-row-action">
                          <p>Usunięcie cofnie wyłącznie tę ręczną korektę historycznego wyniku.</p>
                          <button className="ghost-button" type="button" onClick={() => onRemoveRealizedAdjustment(adjustment.id)}>Usuń korektę</button>
                        </div>
                      ) : null}
                      {adjustment?.source === "bond-coupon" ? <div><span>Źródło</span><strong>Automatyczny kupon obligacji {adjustment.bondCode ?? ""}</strong></div> : null}
                    </div>
                  </details>
                </div>
              );
            })}
          </div>
          {sortedRows.length > shownRows.length ? (
            <footer className="aggregate-operations-pagination">
              <span>Wyświetlono {shownRows.length.toLocaleString("pl-PL")} z {sortedRows.length.toLocaleString("pl-PL")}</span>
              <button className="ghost-button" type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                Pokaż kolejne {Math.min(PAGE_SIZE, sortedRows.length - shownRows.length)}
              </button>
            </footer>
          ) : null}
        </>
      )}
      {children ? <div className="aggregate-operations-single-actions">{children}</div> : null}
    </section>
  );
}
