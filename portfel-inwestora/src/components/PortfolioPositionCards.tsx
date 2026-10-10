"use client";

import { useMemo, useState } from "react";
import ManualAssetPriceDialog, {
  getManualAssetPriceUpdatedAt,
  hasManualAssetPrice,
  isManualAssetPriceGroup,
} from "@/components/ManualAssetPriceDialog";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { getGroupedPortfolioAssets, type PortfolioAssetGroup } from "@/lib/pricing";
import { sortPortfolioAssetGroups } from "@/lib/portfolio-position-sort";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/utils";
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
  isManualPricePending?: boolean;
  manualPriceError?: string | null;
  onUpdateManualPrice?: (group: PortfolioAssetGroup, price: number, currency: CurrencyCode) => Promise<void>;
  onClearManualPrice?: (group: PortfolioAssetGroup) => Promise<void>;
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

const getPositionTypeLabel = (group: PortfolioAssetGroup) =>
  group.instrumentType === "CFD"
    ? `CFD ${group.positionDirection}`
    : group.instrumentType === "OTHER"
      ? "IMPORTOWANY"
      : group.kind.toUpperCase();

export default function PortfolioPositionCards({
  assets,
  groups: providedGroups,
  fxRates,
  baseCurrency,
  filter,
  sortMode: controlledSortMode,
  isRefreshing,
  isManualPricePending = false,
  manualPriceError = null,
  onUpdateManualPrice,
  onClearManualPrice,
  onSortModeChange: onControlledSortModeChange,
  onRemove,
}: PortfolioPositionCardsProps) {
  const workspace = usePortfolioWorkspace();
  const [localSortMode, setLocalSortMode] = useState<AssetTableSortMode>("manual");
  const [manualPriceGroupKey, setManualPriceGroupKey] = useState<string | null>(null);
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
  const manualPriceGroup = manualPriceGroupKey
    ? sortedGroups.find((group) => group.key === manualPriceGroupKey) ?? null
    : null;

  return (
    <section className="workspace-position-cards" aria-label="Bieżące pozycje — widok mobilny">
      <div className="workspace-position-filter">
        <span>Bieżące pozycje</span>
        <label className="workspace-position-sort"><span>Sortuj</span><select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as AssetTableSortMode)}>{MOBILE_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {isRefreshing ? <small>Aktualizowanie kursów…</small> : <small>{sortedGroups.length} pozycji</small>}
      </div>
      {sortedGroups.length === 0 ? <p className="workspace-empty-state">Nie ma pozycji pasujących do tego widoku.</p> : null}
      {sortedGroups.map((group) => {
        const isManualPrice = hasManualAssetPrice(group);
        const manualPriceUpdatedAt = isManualPrice ? getManualAssetPriceUpdatedAt(group) : undefined;

        return (
          <article className="workspace-position-card" key={group.key}>
            <header>
              <div>
                <strong title={group.name}>{group.name}</strong>
                <span>{group.symbol} · {getPositionTypeLabel(group)}{group.portfolioName ? ` · ${group.portfolioName}` : ""}</span>
              </div>
              <strong className={`portfolio-number ${group.hasBaseValuation ? getValueTone(group.profitLossBase) ?? "" : "tone-neutral"}`}>
                {group.hasBaseValuation ? formatCurrency(group.profitLossBase, baseCurrency) : group.hasCompleteQuote ? "Brak przeliczenia FX" : "Brak kursu"}
              </strong>
            </header>
            <dl>
              <div><dt>Ilość</dt><dd className="portfolio-number">{formatNumber(group.quantity, group.kind === "crypto" ? 12 : 6)}</dd></div>
              <div><dt>Kurs jednostkowy</dt><dd className="portfolio-number">{group.currentUnitPrice !== undefined ? formatCurrency(group.currentUnitPrice, group.marketCurrency) : "Brak kursu"}{isManualPrice ? <small className="block text-xs font-normal text-slate-500">Ręczna{manualPriceUpdatedAt ? ` · ${formatDateTime(manualPriceUpdatedAt)}` : ""}</small> : null}</dd></div>
              <div><dt>Zysk %</dt><dd className={`portfolio-number ${getValueTone(group.hasBaseValuation ? group.profitLossPercent : undefined) ?? ""}`}>{group.hasBaseValuation ? formatSignedPercent(group.profitLossPercent) : group.hasCompleteQuote ? "Brak przeliczenia FX" : "Brak kursu"}</dd></div>
              <div><dt>Wartość</dt><dd className="portfolio-number">{group.hasBaseValuation ? formatCurrency(group.marketValueBase, baseCurrency) : group.hasCompleteQuote ? "Brak przeliczenia FX" : "Brak kursu"}</dd></div>
              <div><dt>Wynik dzienny</dt><dd className={`portfolio-number ${getValueTone(group.dailyChangeBase) ?? ""}`}>{group.dailyChangeBase === undefined ? "—" : formatSignedCurrency(group.dailyChangeBase, baseCurrency)}</dd></div>
              <div><dt>Zmiana dzienna %</dt><dd className={`portfolio-number ${getValueTone(group.dailyChangePercent) ?? ""}`}>{group.dailyChangePercent === undefined ? "—" : formatSignedPercent(group.dailyChangePercent)}</dd></div>
              <div><dt>Notowanie</dt><dd>{group.latestPriceDate ? formatDate(group.latestPriceDate) : "Do odświeżenia"}</dd></div>
            </dl>
            {!workspace.isAllPortfoliosSelected && onUpdateManualPrice && onClearManualPrice && isManualAssetPriceGroup(group) ? (
              <button
                type="button"
                className="ghost-button w-full"
                onClick={() => setManualPriceGroupKey(group.key)}
                disabled={isManualPricePending}
              >
                {isManualPricePending ? "Zapisywanie…" : isManualPrice ? "Zmień cenę ręczną" : "Ustaw cenę ręcznie"}
              </button>
            ) : null}
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
        );
      })}
      {manualPriceGroup && onUpdateManualPrice && onClearManualPrice ? (
        <ManualAssetPriceDialog
          group={manualPriceGroup}
          pending={isManualPricePending}
          error={manualPriceError}
          onUpdate={onUpdateManualPrice}
          onClear={onClearManualPrice}
          onClose={() => setManualPriceGroupKey(null)}
        />
      ) : null}
    </section>
  );
}
