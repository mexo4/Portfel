"use client";

import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { PortfolioSale } from "@/types/portfolio";

type SalesHistoryPanelProps = {
  sales: PortfolioSale[];
  canUndoSale: (saleId: string) => boolean;
  onUndoSale: (saleId: string) => void;
};

export default function SalesHistoryPanel({
  sales,
  canUndoSale,
  onUndoSale,
}: SalesHistoryPanelProps) {
  return (
    <section className="panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Historia</p>
          <h2 className="section-title">Historia sprzedazy</h2>
        </div>

        <p className="section-copy">Najnowsze transakcje sprzedazy sa na gorze.</p>
      </div>

      {sales.length === 0 ? (
        <p className="field-note mt-5">Brak zapisanych sprzedazy.</p>
      ) : (
        <div className="mt-6 grid gap-4">
          {sales.map((sale) => {
            const isUndoAvailable = canUndoSale(sale.id);
            const displayCurrency = sale.realizedValueCurrency ?? "PLN";
            const displayProfit =
              sale.realizedProfitLossValue ?? sale.realizedProfitLossPln;
            const displayInvested =
              sale.realizedInvestedValue ?? sale.realizedInvestedPln;
            const displayProceeds =
              sale.realizedProceedsValue ?? sale.realizedProceedsPln;

            return (
              <article key={sale.id} className="lot-card">
                <div className="lot-card-header">
                  <div>
                    <p className="table-title">
                      {sale.name} ({sale.symbol})
                    </p>
                    <p className="table-note">{formatDate(sale.saleDate)}</p>
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
                    <p className="table-note">Cena sprzedazy</p>
                    <strong>{formatCurrency(sale.salePrice, sale.marketCurrency)}</strong>
                  </div>
                  <div>
                    <p className="table-note">Wplyw netto</p>
                    <strong>{formatCurrency(displayProceeds, displayCurrency)}</strong>
                  </div>
                  <div>
                    <p className="table-note">Koszt FIFO</p>
                    <strong>{formatCurrency(displayInvested, displayCurrency)}</strong>
                  </div>
                  <div>
                    <p className="table-note">Prowizja</p>
                    <strong>{formatCurrency(sale.feePln)}</strong>
                  </div>
                  <div>
                    <p className="table-note">Rozliczone zakupy</p>
                    <strong>{sale.allocations.length}</strong>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  {!isUndoAvailable ? (
                    <p className="table-note">
                      Tej sprzedazy nie mozna juz cofnac, bo nowsza sprzedaz rozliczyla
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
