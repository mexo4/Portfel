"use client";

import { useMemo } from "react";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { PortfolioSale } from "@/types/portfolio";

type SalesHistoryPanelProps = {
  sales: PortfolioSale[];
  canUndoSale: (saleId: string) => boolean;
  onUndoSale: (saleId: string) => void;
};

const getTime = (value?: string) => {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
};

export default function SalesHistoryPanel({
  sales,
  canUndoSale,
  onUndoSale,
}: SalesHistoryPanelProps) {
  const displaySales = useMemo(
    () =>
      [...sales].sort(
        (left, right) =>
          getTime(right.createdAt) - getTime(left.createdAt) ||
          getTime(right.saleDate) - getTime(left.saleDate) ||
          right.id.localeCompare(left.id)
      ),
    [sales]
  );

  return (
    <section className="panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Historia</p>
          <h2 className="section-title">Historia sprzedazy, wykupu i zamian</h2>
        </div>

        <p className="section-copy">Ostatnio dodane transakcje sa na gorze.</p>
      </div>

      {displaySales.length === 0 ? (
        <p className="field-note mt-5">Brak zapisanych transakcji.</p>
      ) : (
        <div className="mt-6 grid gap-4">
          {displaySales.map((sale) => {
            const isUndoAvailable = canUndoSale(sale.id);
            const isBondSettlement =
              sale.transactionKind === "bond-redemption" ||
              sale.transactionKind === "bond-swap";
            const displayCurrency = sale.realizedValueCurrency ?? "PLN";
            const displayProfit =
              sale.realizedProfitLossValue ?? sale.realizedProfitLossPln;
            const displayInvested =
              sale.realizedInvestedValue ?? sale.realizedInvestedPln;
            const displayProceeds = isBondSettlement
              ? sale.grossProceedsValue ??
                sale.grossProceedsPln ??
                sale.realizedProceedsValue ??
                sale.realizedProceedsPln
              : sale.realizedProceedsValue ?? sale.realizedProceedsPln;
            const netProceeds =
              sale.realizedProceedsValue ?? sale.realizedProceedsPln;
            const transactionLabel =
              sale.transactionKind === "bond-swap"
                ? "Zamiana obligacji"
                : sale.transactionKind === "bond-redemption"
                  ? "Wykup obligacji"
                  : "Sprzedaz aktywa";
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
                    <p className="table-title">
                      {sale.name} ({sale.symbol})
                    </p>
                    <p className="table-note">
                      {transactionLabel} · {formatDate(sale.saleDate)}
                    </p>
                    {sale.settlementDate ? (
                      <p className="table-note">
                        Rozliczenie: {formatDate(sale.settlementDate)}
                      </p>
                    ) : null}
                    {sale.realizedValueCurrency && sale.realizedValueCurrency !== "PLN" ? (
                      <p className="table-note">
                        Wynik bazowy: {formatCurrency(sale.realizedProfitLossPln)}
                      </p>
                    ) : null}
                  </div>

                  <strong
                    className={displayProfit >= 0 ? "tone-positive" : "tone-negative"}
                  >
                    {formatCurrency(displayProfit, displayCurrency)}
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
                    <strong>{formatCurrency(displayProceeds, displayCurrency)}</strong>
                  </div>
                  <div>
                    <p className="table-note">Koszt FIFO</p>
                    <strong>{formatCurrency(displayInvested, displayCurrency)}</strong>
                  </div>
                  <div>
                    <p className="table-note">
                      {isBondSettlement ? "Wplyw netto" : "Prowizja"}
                    </p>
                    <strong>
                      {isBondSettlement
                        ? formatCurrency(netProceeds, displayCurrency)
                        : formatCurrency(sale.feePln)}
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
                        {formatCurrency(
                          sale.grossProfitLossValue ??
                            sale.grossProfitLossPln ??
                            displayProfit,
                          displayCurrency
                        )}
                      </strong>
                    </div>
                    <div>
                      <p className="table-note">Podatek</p>
                      <strong>{formatCurrency(sale.taxTotalPln ?? 0)}</strong>
                    </div>
                    <div>
                      <p className="table-note">Oplata</p>
                      <strong>{formatCurrency(sale.redemptionFeeTotalPln ?? 0)}</strong>
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
                            {formatCurrency(sale.swapResidualCashPln ?? 0)}
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
    </section>
  );
}
