"use client";

import { useMemo, useState } from "react";
import TruncatedText from "@/components/TruncatedText";
import { convertFromPln } from "@/lib/pricing";
import { formatCurrency, formatDate, formatNumber, normalizeText } from "@/lib/utils";
import type { CurrencyCode, FxRates, PortfolioSale } from "@/types/portfolio";

type SalesHistoryPanelProps = {
  sales: PortfolioSale[];
  baseCurrency: CurrencyCode;
  fxRates: FxRates;
  canUndoSale: (saleId: string) => boolean;
  onUndoSale: (saleId: string) => void;
};

type SalesSortMode =
  | "created-desc"
  | "date-desc"
  | "date-asc"
  | "profit-desc"
  | "profit-asc"
  | "symbol-asc";

const getTime = (value?: string) => {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
};

const getSaleTypeLabel = (sale: PortfolioSale) => {
  if (sale.transactionKind === "bond-swap") return "Zamiana obligacji";
  if (sale.transactionKind === "bond-redemption") return "Wykup obligacji";
  return "Sprzedaz aktywa";
};

const getSaleAccountLabel = (sale: PortfolioSale) =>
  `Konto ${sale.realizedValueCurrency ?? sale.marketCurrency}`;

const getSaleDisplayCurrency = (sale: PortfolioSale): CurrencyCode =>
  sale.realizedValueCurrency ?? "PLN";

const getSaleDisplayProfit = (sale: PortfolioSale) =>
  sale.realizedProfitLossValue ?? sale.realizedProfitLossPln;

const getSaleProfitLossPln = (sale: PortfolioSale) => {
  const isBondSettlement =
    sale.transactionKind === "bond-redemption" || sale.transactionKind === "bond-swap";

  return isBondSettlement
    ? sale.grossProfitLossPln ?? sale.realizedProfitLossPln
    : sale.realizedProfitLossPln;
};

const uniqueOptions = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );

export default function SalesHistoryPanel({
  sales,
  baseCurrency,
  fxRates,
  canUndoSale,
  onUndoSale,
}: SalesHistoryPanelProps) {
  const [query, setQuery] = useState("");
  const [tickerFilter, setTickerFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [currencyFilter, setCurrencyFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortMode, setSortMode] = useState<SalesSortMode>("created-desc");

  const filterOptions = useMemo(
    () => ({
      tickers: uniqueOptions(sales.map((sale) => sale.symbol)),
      types: uniqueOptions(sales.map(getSaleTypeLabel)),
      currencies: uniqueOptions(
        sales.flatMap((sale) => [
          sale.marketCurrency,
          sale.realizedValueCurrency ?? "",
        ])
      ),
      accounts: uniqueOptions(sales.map(getSaleAccountLabel)),
    }),
    [sales]
  );

  const displaySales = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    const filtered = sales.filter((sale) => {
      const typeLabel = getSaleTypeLabel(sale);
      const accountLabel = getSaleAccountLabel(sale);
      const currency = getSaleDisplayCurrency(sale);
      const haystack = normalizeText(
        [
          sale.symbol,
          sale.name,
          typeLabel,
          sale.saleDate,
          sale.marketCurrency,
          currency,
          accountLabel,
        ].join(" ")
      );

      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false;
      if (tickerFilter !== "all" && sale.symbol !== tickerFilter) return false;
      if (typeFilter !== "all" && typeLabel !== typeFilter) return false;
      if (
        currencyFilter !== "all" &&
        sale.marketCurrency !== currencyFilter &&
        currency !== currencyFilter
      ) {
        return false;
      }
      if (accountFilter !== "all" && accountLabel !== accountFilter) return false;
      if (dateFrom && sale.saleDate < dateFrom) return false;
      if (dateTo && sale.saleDate > dateTo) return false;

      return true;
    });

    return filtered.sort((left, right) => {
      if (sortMode === "date-desc") {
        return getTime(right.saleDate) - getTime(left.saleDate);
      }

      if (sortMode === "date-asc") {
        return getTime(left.saleDate) - getTime(right.saleDate);
      }

      if (sortMode === "profit-desc") {
        return getSaleProfitLossPln(right) - getSaleProfitLossPln(left);
      }

      if (sortMode === "profit-asc") {
        return getSaleProfitLossPln(left) - getSaleProfitLossPln(right);
      }

      if (sortMode === "symbol-asc") {
        return (
          left.symbol.localeCompare(right.symbol) ||
          getTime(right.saleDate) - getTime(left.saleDate)
        );
      }

      return (
        getTime(right.createdAt) - getTime(left.createdAt) ||
        getTime(right.saleDate) - getTime(left.saleDate) ||
        right.id.localeCompare(left.id)
      );
    });
  }, [
    accountFilter,
    currencyFilter,
    dateFrom,
    dateTo,
    query,
    sales,
    sortMode,
    tickerFilter,
    typeFilter,
  ]);

  const resetFilters = () => {
    setQuery("");
    setTickerFilter("all");
    setTypeFilter("all");
    setCurrencyFilter("all");
    setAccountFilter("all");
    setDateFrom("");
    setDateTo("");
    setSortMode("created-desc");
  };

  return (
    <section className="panel sales-history-panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Historia</p>
          <h2 className="section-title">Historia sprzedazy, wykupu i zamian</h2>
        </div>

        <p className="section-copy">Domyslnie zwijana historia z wyszukiwaniem i filtrami.</p>
      </div>

      {sales.length === 0 ? (
        <p className="field-note mt-5">Brak zapisanych transakcji.</p>
      ) : (
        <details className="sales-history-accordion mt-6">
          <summary>
            <span>Pokaz historie</span>
            <strong>{sales.length}</strong>
          </summary>

          <div className="sales-history-controls">
            <label className="field field-full">
              <span>Szukaj</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ticker, nazwa, typ, data, waluta..."
              />
            </label>

            <label className="field">
              <span>Ticker</span>
              <select value={tickerFilter} onChange={(event) => setTickerFilter(event.target.value)}>
                <option value="all">Wszystkie</option>
                {filterOptions.tickers.map((ticker) => (
                  <option key={ticker} value={ticker}>
                    {ticker}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Typ</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">Wszystkie</option>
                {filterOptions.types.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Waluta</span>
              <select
                value={currencyFilter}
                onChange={(event) => setCurrencyFilter(event.target.value)}
              >
                <option value="all">Wszystkie</option>
                {filterOptions.currencies.map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Konto</span>
              <select
                value={accountFilter}
                onChange={(event) => setAccountFilter(event.target.value)}
              >
                <option value="all">Wszystkie</option>
                {filterOptions.accounts.map((account) => (
                  <option key={account} value={account}>
                    {account}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Od</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Do</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Sortowanie</span>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SalesSortMode)}>
                <option value="created-desc">Ostatnio dodane</option>
                <option value="date-desc">Data malejaco</option>
                <option value="date-asc">Data rosnaco</option>
                <option value="profit-desc">Wynik malejaco</option>
                <option value="profit-asc">Wynik rosnaco</option>
                <option value="symbol-asc">Ticker A-Z</option>
              </select>
            </label>

            <button className="ghost-button self-end" type="button" onClick={resetFilters}>
              Reset
            </button>
          </div>

          {displaySales.length === 0 ? (
            <p className="field-note mt-5">Brak transakcji dla wybranych filtrow.</p>
          ) : (
            <div className="mt-6 grid gap-4">
              {displaySales.map((sale) => {
                const isUndoAvailable = canUndoSale(sale.id);
                const isBondSettlement =
                  sale.transactionKind === "bond-redemption" ||
                  sale.transactionKind === "bond-swap";
                const displayCurrency = getSaleDisplayCurrency(sale);
                const displayProfit = getSaleDisplayProfit(sale);
                const baseProfit = convertFromPln(
                  getSaleProfitLossPln(sale),
                  baseCurrency,
                  fxRates
                );
                const baseInvested = convertFromPln(
                  sale.realizedInvestedPln,
                  baseCurrency,
                  fxRates
                );
                const baseProceeds = convertFromPln(
                  isBondSettlement
                    ? sale.grossProceedsPln ?? sale.realizedProceedsPln
                    : sale.realizedProceedsPln,
                  baseCurrency,
                  fxRates
                );
                const baseNetProceeds = convertFromPln(
                  sale.realizedProceedsPln,
                  baseCurrency,
                  fxRates
                );
                const baseGrossProfit = convertFromPln(
                  sale.grossProfitLossPln ?? getSaleProfitLossPln(sale),
                  baseCurrency,
                  fxRates
                );
                const transactionLabel = getSaleTypeLabel(sale);
                const priceLabel =
                  sale.transactionKind === "bond-swap"
                    ? "Cena wykupu zrodlowej serii"
                    : sale.transactionKind === "bond-redemption"
                      ? "Cena wykupu"
                      : "Cena sprzedazy";
                const transactionName =
                  sale.transactionKind === "bond-swap"
                    ? "zamiany"
                    : sale.transactionKind === "bond-redemption"
                      ? "wykupu"
                      : "sprzedazy";

                return (
                  <article key={sale.id} className="lot-card">
                    <div className="lot-card-header">
                      <div>
                        <TruncatedText
                          as="p"
                          className="table-title"
                          text={`${sale.name} (${sale.symbol})`}
                        />
                        <p className="table-note">
                          {transactionLabel} / {formatDate(sale.saleDate)} / {getSaleAccountLabel(sale)}
                        </p>
                        {sale.settlementDate ? (
                          <p className="table-note">
                            Rozliczenie: {formatDate(sale.settlementDate)}
                          </p>
                        ) : null}
                        <p className="table-note">
                          Wynik w walucie transakcji: {formatCurrency(displayProfit, displayCurrency)}
                        </p>
                      </div>

                      <strong
                        className={baseProfit >= 0 ? "tone-positive" : "tone-negative"}
                      >
                        {formatCurrency(baseProfit, baseCurrency)}
                      </strong>
                    </div>

                    <div className="lot-grid">
                      <div>
                        <p className="table-note">Ilosc</p>
                        <strong>{formatNumber(sale.quantity)}</strong>
                      </div>
                      <div>
                        <p className="table-note">{priceLabel}</p>
                        <strong>{formatCurrency(sale.salePrice, sale.marketCurrency)}</strong>
                      </div>
                      <div>
                        <p className="table-note">
                          {isBondSettlement ? "Wplyw brutto" : "Wplyw netto"}
                        </p>
                        <strong>{formatCurrency(baseProceeds, baseCurrency)}</strong>
                      </div>
                      <div>
                        <p className="table-note">Koszt FIFO</p>
                        <strong>{formatCurrency(baseInvested, baseCurrency)}</strong>
                      </div>
                      <div>
                        <p className="table-note">
                          {isBondSettlement ? "Wplyw netto" : "Prowizja"}
                        </p>
                        <strong>
                          {isBondSettlement
                            ? formatCurrency(baseNetProceeds, baseCurrency)
                            : formatCurrency(
                                convertFromPln(sale.feePln, baseCurrency, fxRates),
                                baseCurrency
                              )}
                        </strong>
                      </div>
                      <div>
                        <p className="table-note">Rozliczone zakupy</p>
                        <strong>{sale.allocations.length}</strong>
                      </div>
                    </div>

                    {isBondSettlement ? (
                      <div className="lot-grid mt-4">
                        <div>
                          <p className="table-note">Wynik brutto</p>
                          <strong>
                            {formatCurrency(baseGrossProfit, baseCurrency)}
                          </strong>
                        </div>
                        <div>
                          <p className="table-note">Podatek</p>
                          <strong>
                            {formatCurrency(
                              convertFromPln(sale.taxTotalPln ?? 0, baseCurrency, fxRates),
                              baseCurrency
                            )}
                          </strong>
                        </div>
                        <div>
                          <p className="table-note">Oplata</p>
                          <strong>
                            {formatCurrency(
                              convertFromPln(
                                sale.redemptionFeeTotalPln ?? 0,
                                baseCurrency,
                                fxRates
                              ),
                              baseCurrency
                            )}
                          </strong>
                        </div>
                        {sale.transactionKind === "bond-swap" ? (
                          <>
                            <div>
                              <p className="table-note">Nowa seria</p>
                              <strong>{sale.swapTargetCode ?? "-"}</strong>
                            </div>
                            <div>
                              <p className="table-note">Cena zamiany</p>
                              <strong>
                                {formatCurrency(sale.swapPricePerUnit ?? 0, "PLN")}
                              </strong>
                            </div>
                            <div>
                              <p className="table-note">Ilosc po zamianie</p>
                              <strong>{formatNumber(sale.swapTargetQuantity ?? 0)}</strong>
                            </div>
                            <div>
                              <p className="table-note">Pozostalo do wyplaty</p>
                              <strong>
                                {formatCurrency(
                                  convertFromPln(
                                    sale.swapResidualCashPln ?? 0,
                                    baseCurrency,
                                    fxRates
                                  ),
                                  baseCurrency
                                )}
                              </strong>
                            </div>
                          </>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      {!isUndoAvailable ? (
                        <p className="table-note">
                          Tej {transactionName} nie mozna juz cofnac, bo nowsza transakcja rozliczyla
                          te same zakupy.
                        </p>
                      ) : (
                        <span className="table-note">
                          Cofniecie przywroci ilosc, wynik i statystyki sprzed tej transakcji.
                        </span>
                      )}

                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => onUndoSale(sale.id)}
                        disabled={!isUndoAvailable}
                      >
                        Cofnij
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </details>
      )}
    </section>
  );
}
