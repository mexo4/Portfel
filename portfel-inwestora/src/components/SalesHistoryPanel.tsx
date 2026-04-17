"use client";

import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type { PortfolioSale } from "@/types/portfolio";

type SalesHistoryPanelProps = {
  sales: PortfolioSale[];
};

export default function SalesHistoryPanel({ sales }: SalesHistoryPanelProps) {
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
          {sales.map((sale) => (
            <article key={sale.id} className="lot-card">
              <div className="lot-card-header">
                <div>
                  <p className="table-title">
                    {sale.name} ({sale.symbol})
                  </p>
                  <p className="table-note">{formatDate(sale.saleDate)}</p>
                </div>

                <strong
                  className={
                    sale.realizedProfitLossPln >= 0 ? "tone-positive" : "tone-negative"
                  }
                >
                  {formatCurrency(sale.realizedProfitLossPln)}
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
                  <strong>{formatCurrency(sale.realizedProceedsPln)}</strong>
                </div>
                <div>
                  <p className="table-note">Koszt FIFO</p>
                  <strong>{formatCurrency(sale.realizedInvestedPln)}</strong>
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
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
