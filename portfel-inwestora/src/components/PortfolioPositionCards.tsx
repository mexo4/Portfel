"use client";

import { useMemo, useState } from "react";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { getGroupedPortfolioAssets, type PortfolioAssetGroup } from "@/lib/pricing";
import { sortPortfolioAssetGroups } from "@/lib/portfolio-position-sort";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import type {
  AssetTableSortMode,
  CurrencyCode,
  FxRates,
  PortfolioAsset,
} from "@/types/portfolio";

type PortfolioPositionCardsProps = {
  assets: PortfolioAsset[];
  /** Pre-scoped groups preserve portfolio identity in the virtual aggregate view. */
  groups?: PortfolioAssetGroup[];
  fxRates: FxRates;
  baseCurrency: CurrencyCode;
  filter: string;
  sortMode?: AssetTableSortMode;
  isRefreshing: boolean;
  onSortModeChange?: (mode: AssetTableSortMode) => void;
  onRemove: (assetId: string) => void;
};

const MOBILE_SORT_OPTIONS: Array<{ value: AssetTableSortMode; label: string }> = [
  { value: "manual", label: "Własne ustawienie" },
  { value: "value-desc", label: "Największa wartość" },
  { value: "value-asc", label: "Najmniejsza wartość" },
  { value: "profit-desc", label: "Największy zysk" },
  { value: "loss-asc", label: "Największa strata" },
  { value: "profit-percent-desc", label: "Największy zysk %" },
  { value: "profit-percent-asc", label: "Najmniejszy zysk %" },
  { value: "daily-gain-desc", label: "Największy wynik dzienny" },
  { value: "daily-loss-asc", label: "Najmniejszy wynik dzienny" },
];

const getValueTone = (value: number | undefined) =>
  value === undefined
    ? undefined
    : value > 0
      ? "tone-positive"
      : value < 0
        ? "tone-negative"
        : "tone-neutral";

const formatSignedCurrency = (value: number, currency: CurrencyCode) =>
  `${value > 0 ? "+" : ""}${formatCurrency(value, currency)}`;

const formatSignedPercent = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function PortfolioPositionCards({
  assets,
  groups: providedGroups,
  fxRates,
  baseCurrency,
  filter,
  sortMode: controlledSortMode,
  isRefreshing,
  onSortModeChange: onControlledSortModeChange,
  onRemove,
}: PortfolioPositionCardsProps) {
  const workspace = usePortfolioWorkspace();
  const [localSortMode, setLocalSortMode] = useState<AssetTableSortMode>("manual");
  // The workspace mode is the same controlled source used by AssetTable.
  // Local state remains a safe fallback only for any isolated reuse.
  const sortMode = controlledSortMode ?? workspace.assetSortMode ?? localSortMode;
  const onSortModeChange = onControlledSortModeChange ?? workspace.onSortModeChange ?? setLocalSortMode;
  const groups = useMemo(() => {
    const normalizedFilter = filter.trim().toLocaleLowerCase("pl-PL");

    return (providedGroups ?? getGroupedPortfolioAssets(assets, fxRates, baseCurrency))
      .filter(
        (group) =>
          !normalizedFilter ||
          `${group.name} ${group.symbol}`.toLocaleLowerCase("pl-PL").includes(normalizedFilter)
      );
  }, [assets, baseCurrency, filter, fxRates, providedGroups]);
  const sortedGroups = useMemo(
    () => sortPortfolioAssetGroups(groups, sortMode),
    [groups, sortMode]
  );

  return (
    <section className="workspace-position-cards" aria-label="Bieżące pozycje — widok mobilny">
      <div className="workspace-position-filter">
        <span>Bieżące pozycje</span>
        <label className="workspace-position-sort"><span>Sortuj</span><select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as AssetTableSortMode)}>{MOBILE_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {isRefreshing ? <small>Aktualizowanie kursów…</small> : <small>{sortedGroups.length} pozycji</small>}
      </div>
      {sortedGroups.length === 0 ? <p className="workspace-empty-state">Nie ma pozycji pasujących do tego widoku.</p> : null}
      {sortedGroups.map((group) => (
        <article className="workspace-position-card" key={group.key}>
          <header>
            <div>
              <strong title={group.name}>{group.name}</strong>
              <span>{group.symbol} · {group.kind.toUpperCase()}{group.portfolioName ? ` · ${group.portfolioName}` : ""}</span>
            </div>
            <strong className={`portfolio-number ${getValueTone(group.profitLossBase) ?? ""}`}>
              {formatCurrency(group.profitLossBase, baseCurrency)}
            </strong>
          </header>
          <dl>
            <div><dt>Ilość</dt><dd className="portfolio-number">{formatNumber(group.quantity, group.kind === "crypto" ? 12 : 6)}</dd></div>
            <div><dt>Kurs jednostkowy</dt><dd className="portfolio-number">{group.currentUnitPrice ? formatCurrency(group.currentUnitPrice, group.marketCurrency) : "Brak kursu"}</dd></div>
            <div><dt>Zysk %</dt><dd className={`portfolio-number ${getValueTone(group.hasLivePrice ? group.profitLossPercent : undefined) ?? ""}`}>{group.hasLivePrice ? formatSignedPercent(group.profitLossPercent) : "Brak kursu"}</dd></div>
            <div><dt>Wartość</dt><dd className="portfolio-number">{formatCurrency(group.marketValueBase, baseCurrency)}</dd></div>
            <div><dt>Wynik dzienny</dt><dd className={`portfolio-number ${getValueTone(group.dailyChangeBase) ?? ""}`}>{group.dailyChangeBase === undefined ? "—" : formatSignedCurrency(group.dailyChangeBase, baseCurrency)}</dd></div>
            <div><dt>Zmiana dzienna %</dt><dd className={`portfolio-number ${getValueTone(group.dailyChangePercent) ?? ""}`}>{group.dailyChangePercent === undefined ? "—" : formatSignedPercent(group.dailyChangePercent)}</dd></div>
            <div><dt>Notowanie</dt><dd>{group.latestPriceDate ? formatDate(group.latestPriceDate) : "Do odświeżenia"}</dd></div>
          </dl>
          <details>
            <summary>Więcej informacji</summary>
            <p>Średni zakup: <strong>{formatCurrency(group.averagePurchasePrice, group.averagePurchasePriceCurrency)}</strong></p>
            <p>Wartość w walucie notowania: <strong>{group.marketValueQuote !== undefined ? formatCurrency(group.marketValueQuote, group.marketCurrency) : "Brak kursu"}</strong></p>
            <div className="workspace-position-lots">
              {group.lots.map((lot) => (
                <div key={lot.id}>
                  <span>{formatDate(lot.purchaseDate)} · {formatNumber(lot.quantity, lot.kind === "crypto" ? 12 : 6)}</span>
                  <button type="button" onClick={() => onRemove(lot.id)} aria-label={`Usuń lot ${lot.symbol}`}>Usuń</button>
                </div>
              ))}
            </div>
          </details>
        </article>
      ))}
    </section>
  );
}
