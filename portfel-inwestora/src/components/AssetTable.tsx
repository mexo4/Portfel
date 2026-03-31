"use client";

import { Fragment, useMemo, useState } from "react";
import { KIND_LABELS } from "@/lib/constants";
import {
  getAssetLatestUnitPrice,
  hasAssetLivePrice,
  getAssetProfitLossPln,
  getGroupedPortfolioAssets,
} from "@/lib/pricing";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import type { FxRates, PortfolioAsset } from "@/types/portfolio";

type AssetTableProps = {
  assets: PortfolioAsset[];
  fxRates: FxRates;
  filter: string;
  onFilterChange: (value: string) => void;
  onRemove: (assetId: string) => void;
};

export default function AssetTable({
  assets,
  fxRates,
  filter,
  onFilterChange,
  onRemove,
}: AssetTableProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const normalizedFilter = filter.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    return getGroupedPortfolioAssets(assets, fxRates).filter((group) => {
      if (!normalizedFilter) return true;

      const haystack = [group.name, group.symbol, group.kind].join(" ").toLowerCase();
      return haystack.includes(normalizedFilter);
    });
  }, [assets, fxRates, normalizedFilter]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((currentGroups) => ({
      ...currentGroups,
      [groupKey]: !currentGroups[groupKey],
    }));
  };

  return (
    <section className="panel">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Portfel</p>
          <h2 className="section-title">Biezace pozycje</h2>
        </div>

        <label className="field max-w-xs">
          <span>Filtruj po nazwie lub tickerze</span>
          <input
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder="AAPL, KRUK, BTC..."
          />
        </label>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="portfolio-table min-w-full">
          <thead>
            <tr>
              <th>Aktywo</th>
              <th>Typ</th>
              <th>Ilosc</th>
              <th>Sredni zakup</th>
              <th>Rynek</th>
              <th>P/L PLN</th>
              <th>Aktualizacja</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filteredGroups.length === 0 ? (
              <tr>
                <td className="empty-row" colSpan={8}>
                  Brak pozycji. Dodaj pierwsze aktywo formularzem powyzej.
                </td>
              </tr>
            ) : (
              filteredGroups.map((group) => {
                const isExpanded = Boolean(expandedGroups[group.key]);
                const latestUnitPriceLabel =
                  group.latestUnitPrice !== undefined
                    ? formatCurrency(group.latestUnitPrice, group.marketCurrency)
                    : "brak kursu";
                const totalValueLabel = group.hasLivePrice
                  ? formatCurrency(group.totalValuePln)
                  : "brak kursu";

                return (
                  <Fragment key={group.key}>
                    <tr
                      className={isExpanded ? "portfolio-row is-expanded" : "portfolio-row"}
                      onClick={() => toggleGroup(group.key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleGroup(group.key);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <td>
                        <div>
                          <div className="table-title">{group.name}</div>
                          <div className="table-note">
                            {group.symbol} - {group.lotsCount}{" "}
                            {group.lotsCount === 1 ? "zakup" : "zakupy"}
                          </div>
                        </div>
                      </td>
                      <td>{KIND_LABELS[group.kind]}</td>
                      <td>{formatNumber(group.quantity)}</td>
                      <td>
                        {formatCurrency(
                          group.averagePurchasePrice,
                          group.averagePurchasePriceCurrency
                        )}
                        <div className="table-note">
                          koszt: {formatCurrency(group.totalInvestedPln)}
                        </div>
                      </td>
                      <td>
                        {latestUnitPriceLabel}
                        <div className="table-note">
                          wartosc: {totalValueLabel}
                        </div>
                      </td>
                      <td
                        className={
                          group.hasLivePrice
                            ? group.totalProfitLossPln >= 0
                              ? "tone-positive"
                              : "tone-negative"
                            : ""
                        }
                      >
                        {group.hasLivePrice
                          ? formatCurrency(group.totalProfitLossPln)
                          : "brak kursu"}
                      </td>
                      <td>
                        {group.hasLivePrice ? formatDateTime(group.lastUpdatedAt) : "brak"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleGroup(group.key);
                          }}
                        >
                          {isExpanded ? "Zwin" : "Rozwin"}
                        </button>
                      </td>
                    </tr>

                    {isExpanded ? (
                      <tr className="portfolio-detail-row">
                        <td colSpan={8} className="portfolio-detail-cell">
                          <div className="lot-list">
                            {group.lots.map((lot, index) => {
                              const lotProfitLoss = getAssetProfitLossPln(lot, fxRates);
                              const latestLotPrice = getAssetLatestUnitPrice(lot);
                              const lotHasLivePrice = hasAssetLivePrice(lot);

                              return (
                                <article key={lot.id} className="lot-card">
                                  <div className="lot-card-header">
                                    <div>
                                      <p className="table-title">
                                        Zakup #{group.lotsCount - index}
                                      </p>
                                    </div>

                                    <button
                                      type="button"
                                      className="ghost-button"
                                      onClick={() => onRemove(lot.id)}
                                    >
                                      Usun zakup
                                    </button>
                                  </div>

                                  <div className="lot-grid">
                                    <div>
                                      <p className="table-note">Ilosc</p>
                                      <strong>{formatNumber(lot.quantity)}</strong>
                                    </div>
                                    <div>
                                      <p className="table-note">Cena zakupu</p>
                                      <strong>
                                        {formatCurrency(lot.purchasePrice, lot.purchaseCurrency)}
                                      </strong>
                                    </div>
                                    <div>
                                      <p className="table-note">Data zakupu</p>
                                      <strong>{formatDate(lot.purchaseDate)}</strong>
                                    </div>
                                    <div>
                                      <p className="table-note">Aktualna cena</p>
                                      <strong>
                                        {latestLotPrice !== undefined
                                          ? formatCurrency(latestLotPrice, lot.marketCurrency)
                                          : "brak kursu"}
                                      </strong>
                                    </div>
                                    <div>
                                      <p className="table-note">Zysk</p>
                                      <strong
                                        className={
                                          lotHasLivePrice
                                            ? lotProfitLoss >= 0
                                              ? "tone-positive"
                                              : "tone-negative"
                                            : ""
                                        }
                                      >
                                        {lotHasLivePrice
                                          ? formatCurrency(lotProfitLoss)
                                          : "brak kursu"}
                                      </strong>
                                    </div>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
