"use client";

import { useMemo } from "react";
import { buildWealthReport } from "@/lib/wealth-report";
import { formatCurrency, getTodayDateInputValue } from "@/lib/utils";
import type { FxRates, InvestmentPortfolio, PortfolioSummary, WealthItem } from "@/types/portfolio";

const percent = (value: number) => `${String(value).replace(".", ",")}%`;

export default function WealthReportPanel({
  portfolioSummaries,
  wealthItems,
  fxRates,
}: {
  portfolioSummaries: Array<{ portfolio: InvestmentPortfolio; summary: PortfolioSummary }>;
  wealthItems: WealthItem[];
  fxRates: FxRates;
}) {
  const report = useMemo(
    () => buildWealthReport({ portfolioSummaries, wealthItems, fxRates, today: getTodayDateInputValue() }),
    [fxRates, portfolioSummaries, wealthItems]
  );
  const assetCategories = report.categories.filter((category) => category.key !== "liabilities");
  const liabilities = report.categories.find((category) => category.key === "liabilities");

  if (report.places.length === 0) return null;

  return (
    <section className="panel wealth-report-panel" aria-labelledby="wealth-report-title">
      <div className="sprint-panel-head">
        <div>
          <p className="eyebrow">Raport majątkowy</p>
          <h2 id="wealth-report-title" className="section-title">Cały majątek w jednym miejscu</h2>
          <p className="section-copy">Wszystkie portfele inwestycyjne i pozycje spoza giełdy, przeliczone na złote po bieżących kursach.</p>
        </div>
      </div>

      <div className="wealth-report-totals mt-5">
        <div><span>Aktywa</span><strong>{formatCurrency(report.assetsPln)}</strong></div>
        <div><span>Zobowiązania</span><strong>{formatCurrency(report.liabilitiesPln)}</strong></div>
        <div><span>Majątek netto</span><strong className={report.netWorthPln >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(report.netWorthPln)}</strong></div>
      </div>

      {assetCategories.length > 0 ? (
        <div className="wealth-report-bar mt-5" role="img" aria-label={assetCategories.map((category) => `${category.label} ${percent(category.sharePercent)}`).join(", ")}>
          {assetCategories.map((category, index) => (
            <span key={category.key} className={`wealth-report-bar-part tone-${index % 6}`} style={{ flexGrow: Math.max(category.valuePln, 0) }} title={`${category.label}: ${percent(category.sharePercent)}`} />
          ))}
        </div>
      ) : null}

      <div className="wealth-report-columns mt-5">
        <div>
          <h3 className="table-title">Struktura majątku</h3>
          <ul className="wealth-report-list">
            {assetCategories.map((category, index) => (
              <li key={category.key}>
                <span><i className={`wealth-report-dot tone-${index % 6}`} aria-hidden="true" />{category.label}</span>
                <span><strong>{formatCurrency(category.valuePln)}</strong><small>{percent(category.sharePercent)}</small></span>
              </li>
            ))}
            {liabilities ? (
              <li className="is-liability">
                <span>{liabilities.label}</span>
                <span><strong>−{formatCurrency(liabilities.valuePln)}</strong><small>{percent(liabilities.sharePercent)} aktywów</small></span>
              </li>
            ) : null}
          </ul>
        </div>
        <div>
          <h3 className="table-title">Gdzie są pieniądze</h3>
          <ul className="wealth-report-list">
            {report.places.map((place) => (
              <li key={place.id} className={place.isLiability ? "is-liability" : undefined}>
                <span><strong>{place.name}</strong><small>{place.detail}</small></span>
                <span><strong>{place.isLiability ? "−" : ""}{formatCurrency(place.valuePln)}</strong></span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
