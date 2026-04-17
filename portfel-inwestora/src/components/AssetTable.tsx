"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState, type CSSProperties } from "react";
import { KIND_LABELS } from "@/lib/constants";
import {
  getAssetLatestUnitPrice,
  getAssetProfitLossPln,
  getGroupedPortfolioAssets,
  hasAssetLivePrice,
  type PortfolioAssetGroup,
} from "@/lib/pricing";
import { formatCurrency, formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import type {
  AssetTableSortMode,
  FxRates,
  PortfolioAsset,
} from "@/types/portfolio";

type AssetTableProps = {
  assets: PortfolioAsset[];
  fxRates: FxRates;
  filter: string;
  sortMode: AssetTableSortMode;
  onFilterChange: (value: string) => void;
  onSortModeChange: (mode: AssetTableSortMode) => void;
  onReorderGroups: (nextGroupKeys: string[]) => void;
  onRemove: (assetId: string) => void;
  onStartSale: (group: PortfolioAssetGroup) => void;
};

type SortableGroupSectionProps = {
  group: PortfolioAssetGroup;
  fxRates: FxRates;
  isExpanded: boolean;
  isManualSortMode: boolean;
  isManualReorderLocked: boolean;
  onToggleGroup: (groupKey: string) => void;
  onRemove: (assetId: string) => void;
  onStartSale: (group: PortfolioAssetGroup) => void;
};

const SORT_OPTIONS: Array<{
  value: AssetTableSortMode;
  label: string;
}> = [
  { value: "manual", label: "Wlasne ustawienie" },
  { value: "value-desc", label: "Najwieksza wartosc" },
  { value: "value-asc", label: "Najmniejsza wartosc" },
  { value: "profit-desc", label: "Najwiekszy zysk" },
  { value: "loss-asc", label: "Najwieksza strata" },
  { value: "daily-gain-desc", label: "Najwiekszy dzienny zysk %" },
  { value: "daily-loss-asc", label: "Najwieksza dzienna strata %" },
];

const DRAG_HANDLE_DOTS = Array.from({ length: 6 }, (_, index) => index);

const sortGroupedAssets = (
  groups: PortfolioAssetGroup[],
  sortMode: AssetTableSortMode
) => {
  const rankedGroups = groups.map((group, index) => ({
    group,
    index,
  }));

  const compareByManualOrder = (
    left: (typeof rankedGroups)[number],
    right: (typeof rankedGroups)[number]
  ) =>
    left.group.groupOrder - right.group.groupOrder ||
    left.index - right.index ||
    left.group.name.localeCompare(right.group.name, "pl");

  const compareWithLivePriceLast = (
    left: (typeof rankedGroups)[number],
    right: (typeof rankedGroups)[number]
  ) => {
    const leftRank = left.group.hasLivePrice ? 0 : 1;
    const rightRank = right.group.hasLivePrice ? 0 : 1;

    return leftRank - rightRank;
  };

  const compareWithDailyChangeLast = (
    left: (typeof rankedGroups)[number],
    right: (typeof rankedGroups)[number]
  ) => {
    const leftRank = left.group.hasDailyChange ? 0 : 1;
    const rightRank = right.group.hasDailyChange ? 0 : 1;

    return leftRank - rightRank;
  };

  rankedGroups.sort((left, right) => {
    if (sortMode === "manual") {
      return compareByManualOrder(left, right);
    }

    if (sortMode === "daily-gain-desc" || sortMode === "daily-loss-asc") {
      const dailyChangeComparison = compareWithDailyChangeLast(left, right);

      if (dailyChangeComparison !== 0) {
        return dailyChangeComparison;
      }

      const leftDailyChange = left.group.dailyChangePercent ?? 0;
      const rightDailyChange = right.group.dailyChangePercent ?? 0;

      if (sortMode === "daily-gain-desc") {
        return rightDailyChange - leftDailyChange || compareByManualOrder(left, right);
      }

      return leftDailyChange - rightDailyChange || compareByManualOrder(left, right);
    }

    const livePriceComparison = compareWithLivePriceLast(left, right);

    if (livePriceComparison !== 0) {
      return livePriceComparison;
    }

    if (sortMode === "value-desc") {
      return (
        right.group.totalValuePln - left.group.totalValuePln ||
        compareByManualOrder(left, right)
      );
    }

    if (sortMode === "value-asc") {
      return (
        left.group.totalValuePln - right.group.totalValuePln ||
        compareByManualOrder(left, right)
      );
    }

    if (sortMode === "profit-desc") {
      return (
        right.group.totalProfitLossPln - left.group.totalProfitLossPln ||
        compareByManualOrder(left, right)
      );
    }

    return (
      left.group.totalProfitLossPln - right.group.totalProfitLossPln ||
      compareByManualOrder(left, right)
    );
  });

  return rankedGroups.map((entry) => entry.group);
};

const GroupDragOverlayCard = ({ group }: { group: PortfolioAssetGroup }) => {
  return (
    <article className="drag-overlay-row">
      <div className="drag-overlay-handle" aria-hidden="true">
        <span className="drag-handle-dots">
          {DRAG_HANDLE_DOTS.map((dotIndex) => (
            <span key={`${group.key}-overlay-dot-${dotIndex}`} className="drag-handle-dot" />
          ))}
        </span>
      </div>

      <div className="drag-overlay-copy">
        <p className="table-title">{group.name}</p>
        <p className="drag-overlay-meta">{group.symbol}</p>
      </div>

      <div className="drag-overlay-kind">
        <span className="tag">{KIND_LABELS[group.kind]}</span>
      </div>
    </article>
  );
};

const DragRowPlaceholder = () => <span className="drag-row-placeholder" aria-hidden="true" />;

const SortableGroupSection = ({
  group,
  fxRates,
  isExpanded,
  isManualSortMode,
  isManualReorderLocked,
  onToggleGroup,
  onRemove,
  onStartSale,
}: SortableGroupSectionProps) => {
  const canDrag = isManualSortMode && !isManualReorderLocked;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: group.key,
    disabled: !canDrag,
  });

  const latestUnitPriceLabel =
    group.latestUnitPrice !== undefined
      ? formatCurrency(group.latestUnitPrice, group.marketCurrency)
      : "brak kursu";
  const totalValueLabel = group.hasLivePrice
    ? formatCurrency(group.totalValuePln)
    : "brak kursu";
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const rowClassName = [
    "portfolio-row",
    isExpanded ? "is-expanded" : "",
    isDragging ? "is-drag-source" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <tbody
      ref={setNodeRef}
      style={style}
      className={isDragging ? "portfolio-group-body is-dragging" : "portfolio-group-body"}
    >
      <tr
        className={rowClassName}
        onClick={() => onToggleGroup(group.key)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) {
            return;
          }

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleGroup(group.key);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <td>
          <div className="portfolio-row-main">
            {isManualSortMode ? (
              <button
                type="button"
                className="drag-handle"
                aria-label={`Przeciagnij ${group.name}`}
                disabled={!canDrag}
                onClick={(event) => {
                  event.stopPropagation();
                }}
                {...(canDrag ? { ...attributes, ...listeners } : {})}
              >
                <span className="drag-handle-dots" aria-hidden="true">
                  {DRAG_HANDLE_DOTS.map((dotIndex) => (
                    <span
                      key={`${group.key}-drag-dot-${dotIndex}`}
                      className="drag-handle-dot"
                    />
                  ))}
                </span>
              </button>
            ) : null}

            <div>
              <div className="table-title">{group.name}</div>
              <div className="table-note">
                {group.symbol} - {group.lotsCount}{" "}
                {group.lotsCount === 1 ? "zakup" : "zakupy"}
              </div>
            </div>
          </div>
        </td>
        <td>
          {isDragging ? (
            <span className="drag-row-kind">{KIND_LABELS[group.kind]}</span>
          ) : (
            KIND_LABELS[group.kind]
          )}
        </td>
        <td>{isDragging ? <DragRowPlaceholder /> : formatNumber(group.quantity)}</td>
        <td>
          {isDragging ? (
            <DragRowPlaceholder />
          ) : (
            <>
              {formatCurrency(group.averagePurchasePrice, group.averagePurchasePriceCurrency)}
              <div className="table-note">koszt: {formatCurrency(group.totalInvestedPln)}</div>
            </>
          )}
        </td>
        <td>
          {isDragging ? (
            <DragRowPlaceholder />
          ) : (
            <>
              {latestUnitPriceLabel}
              <div className="table-note">wartosc: {totalValueLabel}</div>
            </>
          )}
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
          {isDragging ? (
            <DragRowPlaceholder />
          ) : group.hasLivePrice ? (
            formatCurrency(group.totalProfitLossPln)
          ) : (
            "brak kursu"
          )}
        </td>
        <td>
          {isDragging ? (
            <DragRowPlaceholder />
          ) : group.hasLivePrice ? (
            formatDateTime(group.lastUpdatedAt)
          ) : (
            "brak"
          )}
        </td>
        <td>
          {isDragging ? null : (
            <div className="table-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onStartSale(group);
                }}
              >
                Sprzedaj
              </button>

              <button
                type="button"
                className="ghost-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleGroup(group.key);
                }}
              >
                {isExpanded ? "Zwin" : "Rozwin"}
              </button>
            </div>
          )}
        </td>
      </tr>

      {isExpanded && !isDragging ? (
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
                        <p className="table-title">Zakup #{group.lotsCount - index}</p>
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
                          {lotHasLivePrice ? formatCurrency(lotProfitLoss) : "brak kursu"}
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
    </tbody>
  );
};

export default function AssetTable({
  assets,
  fxRates,
  filter,
  sortMode,
  onFilterChange,
  onSortModeChange,
  onReorderGroups,
  onRemove,
  onStartSale,
}: AssetTableProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const normalizedFilter = filter.trim().toLowerCase();
  const isManualSortMode = sortMode === "manual";
  const isManualReorderLocked = isManualSortMode && normalizedFilter.length > 0;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const filteredGroups = useMemo(() => {
    const groupedAssets = getGroupedPortfolioAssets(assets, fxRates).filter((group) => {
      if (!normalizedFilter) return true;

      const haystack = [group.name, group.symbol, group.kind].join(" ").toLowerCase();
      return haystack.includes(normalizedFilter);
    });

    return sortGroupedAssets(groupedAssets, sortMode);
  }, [assets, fxRates, normalizedFilter, sortMode]);

  const sortableGroupKeys = filteredGroups.map((group) => group.key);
  const activeGroup = activeGroupKey
    ? filteredGroups.find((group) => group.key === activeGroupKey) ?? null
    : null;

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((currentGroups) => ({
      ...currentGroups,
      [groupKey]: !currentGroups[groupKey],
    }));
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveGroupKey(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveGroupKey(null);

    if (!isManualSortMode || isManualReorderLocked || !event.over) {
      return;
    }

    const activeKey = String(event.active.id);
    const overKey = String(event.over.id);

    if (activeKey === overKey) {
      return;
    }

    const oldIndex = sortableGroupKeys.indexOf(activeKey);
    const newIndex = sortableGroupKeys.indexOf(overKey);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    onReorderGroups(arrayMove(sortableGroupKeys, oldIndex, newIndex));
  };

  return (
    <section className="panel">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Portfel</p>
          <h2 className="section-title">Biezace pozycje</h2>
        </div>

        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <label className="field max-w-xs">
            <span>Sortowanie</span>
            <select
              value={sortMode}
              onChange={(event) =>
                onSortModeChange(event.target.value as AssetTableSortMode)
              }
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field max-w-xs">
            <span>Filtruj po nazwie lub tickerze</span>
            <input
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder="AAPL, KRUK, BTC..."
            />
          </label>
        </div>
      </div>

      {isManualReorderLocked ? (
        <p className="field-note mt-4">
          Wyczysc filtr, aby zmieniac reczna kolejnosc pozycji.
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setActiveGroupKey(null);
          }}
        >
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

            {filteredGroups.length === 0 ? (
              <tbody>
                <tr>
                  <td className="empty-row" colSpan={8}>
                    Brak pozycji. Dodaj pierwsze aktywo formularzem powyzej.
                  </td>
                </tr>
              </tbody>
            ) : (
              <SortableContext
                items={sortableGroupKeys}
                strategy={verticalListSortingStrategy}
              >
                {filteredGroups.map((group) => (
                  <SortableGroupSection
                    key={group.key}
                    group={group}
                    fxRates={fxRates}
                    isExpanded={Boolean(expandedGroups[group.key])}
                    isManualSortMode={isManualSortMode}
                    isManualReorderLocked={isManualReorderLocked}
                    onToggleGroup={toggleGroup}
                    onRemove={onRemove}
                    onStartSale={onStartSale}
                  />
                ))}
              </SortableContext>
            )}
          </table>

          <DragOverlay>
            {activeGroup ? <GroupDragOverlayCard group={activeGroup} /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </section>
  );
}
