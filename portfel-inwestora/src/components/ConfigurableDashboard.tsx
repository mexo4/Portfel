"use client";

import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CorporateEventsPanel from "@/components/CorporateEventsPanel";
import PortfolioLineCharts from "@/components/PortfolioLineCharts";
import UpcomingDividendsPanel from "@/components/UpcomingDividendsPanel";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import {
  DASHBOARD_WIDGET_DEFINITIONS,
  DEFAULT_DASHBOARD_LAYOUT,
  dashboardLayoutsEqual,
  getDashboardWidgetDefinition,
  normalizeDashboardLayout,
  type DashboardLayout,
  type DashboardWidgetCategory,
  type DashboardWidgetId,
  type DashboardWidgetLayout,
} from "@/lib/dashboard-layout";
import { fetchDashboardLayout, saveDashboardLayout } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";

const CATEGORY_LABELS: Record<DashboardWidgetCategory, string> = {
  summary: "Podsumowanie",
  charts: "Wykresy",
  portfolio: "Portfel",
  calendar: "Kalendarz i dywidendy",
};

const OPERATION_LABELS: Record<string, string> = {
  BUY: "Zakup",
  SELL: "Sprzedaż",
  DIVIDEND: "Dywidenda",
  DEPOSIT: "Wpłata",
  WITHDRAWAL: "Wypłata",
  FEE: "Opłata",
};

const getWorkspaceHistoryScopes = (workspace: ReturnType<typeof usePortfolioWorkspace>) =>
  workspace.isAllPortfoliosSelected
    ? workspace.portfolios.map((portfolio) => ({
        portfolioId: portfolio.id,
        assets: portfolio.assets,
        sales: portfolio.sales,
        realizedAdjustments: portfolio.realizedAdjustments,
      }))
    : undefined;

const getWorkspaceHistoryProps = (workspace: ReturnType<typeof usePortfolioWorkspace>) => ({
  assets: workspace.assets,
  sales: workspace.sales,
  realizedAdjustments: workspace.effectiveRealizedAdjustments,
  fxRates: workspace.fxRates,
  baseCurrency: workspace.activeBaseCurrency,
  combinedProfitLoss: workspace.summaryCombinedProfitLoss,
  refreshRevision: workspace.refreshRevision,
  portfolioScopes: getWorkspaceHistoryScopes(workspace),
});

const getAssetKindLabel = (kind: string) => {
  if (kind === "stock") return "Akcje";
  if (kind === "etf") return "ETF";
  if (kind === "crypto") return "Krypto";
  if (kind === "bond") return "Obligacje";
  return "Inne";
};

const getOperationSymbol = (metadata: unknown) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const symbol = (metadata as { symbol?: unknown }).symbol;
  return typeof symbol === "string" && symbol.trim() ? symbol.trim() : null;
};

function DashboardMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative";
}) {
  return (
    <article className="panel dashboard-metric-card">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function DashboardPositions() {
  const workspace = usePortfolioWorkspace();
  const groups = workspace.groupedAssets.slice(0, 6);

  return (
    <section className="panel panel-compact dashboard-list-panel">
      <div className="workspace-section-head">
        <div>
          <p className="eyebrow">Portfel</p>
          <h2 className="section-title">Bieżące pozycje</h2>
        </div>
        <Link href={workspace.getReadHref("/portfolio/positions")}>Wszystkie</Link>
      </div>
      {groups.length ? (
        <div className="workspace-preview-list">
          {groups.map((group) => (
            <div key={group.key}>
              <span>
                <strong title={group.name}>{group.name}</strong>
                <small>
                  {group.symbol} · {group.quantity}
                  {group.portfolioName ? ` · ${group.portfolioName}` : ""}
                </small>
              </span>
              <span>
                <strong>{formatCurrency(group.totalValue, workspace.activeBaseCurrency)}</strong>
                <small className={group.profitLossBase >= 0 ? "tone-positive" : "tone-negative"}>
                  {formatCurrency(group.profitLossBase, workspace.activeBaseCurrency)}
                </small>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="workspace-empty-state">Dodaj pierwszy instrument, aby zobaczyć pozycje.</p>
      )}
    </section>
  );
}

function DashboardRanking({ direction }: { direction: "gains" | "losses" }) {
  const workspace = usePortfolioWorkspace();
  const groups = [...workspace.groupedAssets]
    .filter((group) => (direction === "gains" ? group.profitLossBase > 0 : group.profitLossBase < 0))
    .sort((left, right) =>
      direction === "gains"
        ? right.profitLossBase - left.profitLossBase
        : left.profitLossBase - right.profitLossBase
    )
    .slice(0, 5);
  const isGains = direction === "gains";

  return (
    <section className="panel panel-compact dashboard-list-panel">
      <div className="workspace-section-head">
        <div>
          <p className="eyebrow">Wynik</p>
          <h2 className="section-title">{isGains ? "Największe wzrosty" : "Największe spadki"}</h2>
        </div>
        <Link href={workspace.getReadHref("/analytics/performance")}>Analizuj</Link>
      </div>
      {groups.length ? (
        <div className="workspace-preview-list">
          {groups.map((group) => (
            <div key={group.key}>
              <span>
                <strong title={group.name}>{group.name}</strong>
                <small>{group.symbol}</small>
              </span>
              <span>
                <strong className={isGains ? "tone-positive" : "tone-negative"}>
                  {formatCurrency(group.profitLossBase, workspace.activeBaseCurrency)}
                </strong>
                <small>{formatCurrency(group.totalValue, workspace.activeBaseCurrency)}</small>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="workspace-empty-state">
          {isGains ? "Brak pozycji na plusie." : "Brak pozycji ze stratą."}
        </p>
      )}
    </section>
  );
}

function DashboardStructure() {
  const workspace = usePortfolioWorkspace();
  const allocation = Array.from(
    workspace.groupedAssets.reduce((items, group) => {
      items.set(group.kind, (items.get(group.kind) ?? 0) + group.totalValue);
      return items;
    }, new Map<(typeof workspace.groupedAssets)[number]["kind"], number>()).entries()
  ).sort((left, right) => right[1] - left[1]);

  return (
    <section className="panel panel-compact dashboard-list-panel">
      <div className="workspace-section-head">
        <div>
          <p className="eyebrow">Struktura</p>
          <h2 className="section-title">Struktura portfela</h2>
        </div>
        <Link href={workspace.getReadHref("/analytics/structure")}>Analizuj</Link>
      </div>
      {allocation.length ? (
        <div className="workspace-allocation-list">
          {allocation.map(([kind, value]) => (
            <div key={kind}>
              <span>{getAssetKindLabel(kind)}</span>
              <strong>
                {workspace.summaryTotalValue > 0
                  ? `${Math.round((value / workspace.summaryTotalValue) * 100)}%`
                  : "0%"}
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="workspace-empty-state">Struktura pojawi się po dodaniu aktywów.</p>
      )}
    </section>
  );
}

function DashboardRecentOperations() {
  const workspace = usePortfolioWorkspace();
  const scopedPortfolios = workspace.isAllPortfoliosSelected
    ? workspace.portfolios
    : workspace.activePortfolio
      ? [workspace.activePortfolio]
      : [];
  const operations = scopedPortfolios
    .flatMap((portfolio) =>
      (portfolio.operations ?? []).map((operation) => ({ operation, portfolioName: portfolio.name }))
    )
    .sort((left, right) => right.operation.date.localeCompare(left.operation.date))
    .slice(0, 6);

  return (
    <section className="panel panel-compact dashboard-list-panel">
      <div className="workspace-section-head">
        <div>
          <p className="eyebrow">Historia</p>
          <h2 className="section-title">Ostatnie operacje</h2>
        </div>
        <Link href={workspace.getReadHref("/portfolio/operations")}>Wszystkie</Link>
      </div>
      {operations.length ? (
        <div className="workspace-preview-list dashboard-operation-list">
          {operations.map(({ operation, portfolioName }) => {
            const symbol = getOperationSymbol(operation.metadata);
            return (
              <div key={`${portfolioName}:${operation.id}`}>
                <span>
                  <strong>{symbol ?? OPERATION_LABELS[operation.operationType] ?? "Operacja"}</strong>
                  <small>{OPERATION_LABELS[operation.operationType] ?? operation.operationType}</small>
                </span>
                <span>
                  <strong>{formatDate(operation.date)}</strong>
                  {workspace.isAllPortfoliosSelected ? <small>{portfolioName}</small> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="workspace-empty-state">Nie ma jeszcze zapisanych operacji.</p>
      )}
    </section>
  );
}

function DashboardWidgetContent({ widgetId }: { widgetId: DashboardWidgetId }) {
  const workspace = usePortfolioWorkspace();
  const portfolioId = workspace.isAllPortfoliosSelected ? "all" : workspace.activePortfolioId;
  const chartProps = getWorkspaceHistoryProps(workspace);

  switch (widgetId) {
    case "portfolio-value":
      return (
        <DashboardMetric
          label="Wartość portfela"
          value={formatCurrency(workspace.summaryTotalValue, workspace.activeBaseCurrency)}
          detail={workspace.isAllPortfoliosSelected ? "Wszystkie portfele" : "Bieżący portfel"}
        />
      );
    case "profit-loss":
      return (
        <DashboardMetric
          label="P/L"
          value={formatCurrency(workspace.summaryCombinedProfitLoss, workspace.activeBaseCurrency)}
          detail="Wynik łączny"
          tone={workspace.summaryCombinedProfitLoss >= 0 ? "positive" : "negative"}
        />
      );
    case "return-rate":
      return <PortfolioLineCharts {...chartProps} initialMode="return" />;
    case "dividends-ytd":
      return (
        <DashboardMetric
          label="Dywidendy YTD"
          value={formatCurrency(workspace.activeDividendYtd, workspace.activeBaseCurrency)}
          detail="Otrzymane w bieżącym roku"
        />
      );
    case "daily-result":
      return <PortfolioLineCharts {...chartProps} dailyInvestmentResultOnly />;
    case "portfolio-chart":
      return <PortfolioLineCharts {...chartProps} initialMode="value" />;
    case "portfolio-vs-benchmark":
      return <PortfolioLineCharts {...chartProps} initialMode="portfolio-vs-benchmark" />;
    case "current-positions":
      return <DashboardPositions />;
    case "biggest-gains":
      return <DashboardRanking direction="gains" />;
    case "biggest-losses":
      return <DashboardRanking direction="losses" />;
    case "portfolio-structure":
      return <DashboardStructure />;
    case "recent-operations":
      return <DashboardRecentOperations />;
    case "gpw-events":
      return <CorporateEventsPanel portfolioId={portfolioId} />;
    case "upcoming-dividends":
      return <UpcomingDividendsPanel portfolioId={portfolioId} />;
  }
}

function SortableDashboardWidget({
  widget,
  isEditing,
  index,
  total,
  onRemove,
  onResize,
  onMove,
}: {
  widget: DashboardWidgetLayout;
  isEditing: boolean;
  index: number;
  total: number;
  onRemove: (id: DashboardWidgetId) => void;
  onResize: (id: DashboardWidgetId, size: DashboardWidgetLayout["size"]) => void;
  onMove: (id: DashboardWidgetId, direction: -1 | 1) => void;
}) {
  const definition = getDashboardWidgetDefinition(widget.id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !isEditing,
  });

  if (!definition) return null;

  return (
    <div
      ref={setNodeRef}
      className={`dashboard-widget dashboard-widget--${widget.size}${isEditing ? " is-editing" : ""}${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {isEditing ? (
        <div className="dashboard-widget-editor" aria-label={`Edytuj widget ${definition.label}`}>
          <button
            type="button"
            className="dashboard-widget-drag-handle"
            aria-label={`Przeciągnij ${definition.label}`}
            title="Przeciągnij, aby zmienić kolejność"
            {...attributes}
            {...listeners}
          >
            ⠿
          </button>
          <strong>{definition.label}</strong>
          <label>
            <span className="sr-only">Rozmiar widgetu {definition.label}</span>
            <select
              value={widget.size}
              onChange={(event) => onResize(widget.id, event.target.value as DashboardWidgetLayout["size"])}
            >
              {definition.sizes.map((size) => (
                <option key={size} value={size}>
                  {{ small: "Mały", medium: "Średni", large: "Duży", full: "Pełna szerokość" }[size]}
                </option>
              ))}
            </select>
          </label>
          <div className="dashboard-widget-move-actions">
            <button
              type="button"
              className="dashboard-widget-icon-button"
              onClick={() => onMove(widget.id, -1)}
              disabled={index === 0}
              aria-label={`Przenieś ${definition.label} wyżej`}
              title="Przenieś wyżej"
            >
              ↑
            </button>
            <button
              type="button"
              className="dashboard-widget-icon-button"
              onClick={() => onMove(widget.id, 1)}
              disabled={index === total - 1}
              aria-label={`Przenieś ${definition.label} niżej`}
              title="Przenieś niżej"
            >
              ↓
            </button>
            <button
              type="button"
              className="dashboard-widget-icon-button is-danger"
              onClick={() => onRemove(widget.id)}
              aria-label={`Usuń ${definition.label} z pulpitu`}
              title="Usuń z pulpitu"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      <div className="dashboard-widget-content">
        <DashboardWidgetContent widgetId={widget.id} />
      </div>
    </div>
  );
}

export default function ConfigurableDashboard() {
  const workspace = usePortfolioWorkspace();
  const [layout, setLayout] = useState<DashboardLayout>(() => normalizeDashboardLayout(null));
  const [draftLayout, setDraftLayout] = useState<DashboardLayout>(() => normalizeDashboardLayout(null));
  const [isEditing, setIsEditing] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingLayout, setIsLoadingLayout] = useState(true);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const libraryTitleRef = useRef<HTMLHeadingElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const libraryTriggerRef = useRef<HTMLButtonElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const controller = new AbortController();

    void fetchDashboardLayout(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) {
          const normalized = normalizeDashboardLayout(response.layout);
          setLayout(normalized);
          setDraftLayout(normalized);
          setLayoutError(null);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
          setLayoutError("Nie udało się wczytać zapisanego układu. Pokazujemy układ domyślny.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingLayout(false);
      });

    return () => controller.abort();
  }, []);

  const openLibrary = (trigger: HTMLButtonElement) => {
    libraryTriggerRef.current = trigger;
    setIsLibraryOpen(true);
  };

  const closeLibrary = useCallback(() => {
    setIsLibraryOpen(false);
    window.requestAnimationFrame(() => libraryTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isLibraryOpen) return;

    const frame = window.requestAnimationFrame(() => libraryTitleRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLibrary();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = Array.from(
        libraryRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], select, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeLibrary, isLibraryOpen]);

  const displayedLayout = isEditing ? draftLayout : layout;
  const existingWidgetIds = useMemo(
    () => new Set(draftLayout.widgets.map((widget) => widget.id)),
    [draftLayout.widgets]
  );

  const persistLayout = useCallback(
    (nextLayout: DashboardLayout, closeEditor = false): Promise<boolean> => {
      // A double click or delayed mobile tap must share the in-flight save.
      if (saveInFlightRef.current) return saveInFlightRef.current;

      const priorLayout = layout;
      const normalized = normalizeDashboardLayout(nextLayout);
      setIsSaving(true);
      setLayoutError(null);
      // The UI immediately reflects the intended arrangement. A failed write
      // restores the previous confirmed layout rather than leaving a partial state.
      setLayout(normalized);

      const saveRequest = (async () => {
        try {
          const response = await saveDashboardLayout(normalized);
          const savedLayout = normalizeDashboardLayout(response.layout);
          setLayout(savedLayout);
          setDraftLayout(savedLayout);
          if (closeEditor) setIsEditing(false);
          return true;
      } catch {
          setLayout(priorLayout);
          setDraftLayout(priorLayout);
        setLayoutError("Nie udało się zapisać układu pulpitu. Przywróciliśmy poprzednią wersję.");
          return false;
        } finally {
          setIsSaving(false);
        }
      })();

      saveInFlightRef.current = saveRequest;
      void saveRequest.finally(() => {
        if (saveInFlightRef.current === saveRequest) saveInFlightRef.current = null;
      });
      return saveRequest;
    },
    [layout]
  );

  const updateDraft = useCallback((updater: (current: DashboardLayout) => DashboardLayout) => {
    setDraftLayout((current) => normalizeDashboardLayout(updater(current)));
  }, []);

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oldIndex = draftLayout.widgets.findIndex((widget) => widget.id === active.id);
    const newIndex = draftLayout.widgets.findIndex((widget) => widget.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    updateDraft((current) => ({
      ...current,
      widgets: arrayMove(current.widgets, oldIndex, newIndex),
    }));
  };

  const startEditing = () => {
    setDraftLayout(layout);
    setLayoutError(null);
    setIsEditing(true);
  };

  const resetToDefault = () => {
    const defaultLayout = normalizeDashboardLayout(DEFAULT_DASHBOARD_LAYOUT);
    setDraftLayout(defaultLayout);
    void persistLayout(defaultLayout);
  };

  const finishEditing = () => {
    if (dashboardLayoutsEqual(layout, draftLayout)) {
      setIsEditing(false);
      editButtonRef.current?.focus();
      return;
    }
    void persistLayout(draftLayout, true).then((didSave) => {
      if (didSave) window.requestAnimationFrame(() => editButtonRef.current?.focus());
    });
  };

  const addWidget = (id: DashboardWidgetId) => {
    const definition = getDashboardWidgetDefinition(id);
    if (!definition || existingWidgetIds.has(id)) return;
    updateDraft((current) => ({
      ...current,
      widgets: [...current.widgets, { id, size: definition.defaultSize }],
    }));
  };

  const removeWidget = (id: DashboardWidgetId) => {
    updateDraft((current) => ({
      ...current,
      widgets: current.widgets.filter((widget) => widget.id !== id),
    }));
  };

  const resizeWidget = (id: DashboardWidgetId, size: DashboardWidgetLayout["size"]) => {
    updateDraft((current) => ({
      ...current,
      widgets: current.widgets.map((widget) => (widget.id === id ? { ...widget, size } : widget)),
    }));
  };

  const moveWidget = (id: DashboardWidgetId, direction: -1 | 1) => {
    const index = draftLayout.widgets.findIndex((widget) => widget.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= draftLayout.widgets.length) return;
    updateDraft((current) => ({
      ...current,
      widgets: arrayMove(current.widgets, index, targetIndex),
    }));
  };

  const portfolioScopeLabel = workspace.isAllPortfoliosSelected
    ? "Wszystkie portfele"
    : workspace.activePortfolio?.name ?? "Aktywny portfel";

  return (
    <div className="workspace-page dashboard-builder" aria-busy={isLoadingLayout}>
      <section className="workspace-dashboard-intro dashboard-builder-intro">
        <div>
          <p className="eyebrow">{portfolioScopeLabel}</p>
          <h2>Twój pulpit inwestycyjny.</h2>
          <p className="section-copy">Dane automatycznie reagują na wybrany portfel, a układ pozostaje tylko Twój.</p>
        </div>
        <div className="dashboard-builder-actions">
          {isEditing ? (
            <>
              <button className="ghost-button" type="button" onClick={(event) => openLibrary(event.currentTarget)}>
                Dodaj widget
              </button>
              <button
                className="ghost-button"
                type="button"
                onClick={resetToDefault}
                disabled={isSaving}
              >
                Przywróć domyślny układ
              </button>
              <button className="primary-button" type="button" onClick={finishEditing} disabled={isSaving}>
                {isSaving ? "Zapisywanie…" : "Zakończ edycję"}
              </button>
            </>
          ) : (
            <button ref={editButtonRef} className="primary-button" type="button" onClick={startEditing}>
              Edytuj pulpit
            </button>
          )}
        </div>
      </section>

      {isEditing ? (
        <section className="dashboard-edit-notice" aria-live="polite">
          <span>Tryb edycji</span>
          <p>Przeciągaj uchwyt lub użyj strzałek. Rozmiary są dopasowane do siatki, nie do pikseli.</p>
          <button
            type="button"
            className="dashboard-save-link"
            disabled={isSaving || dashboardLayoutsEqual(layout, draftLayout)}
            onClick={() => void persistLayout(draftLayout)}
          >
            {isSaving ? "Zapisywanie…" : "Zapisz układ"}
          </button>
        </section>
      ) : null}

      {layoutError ? <p className="field-note field-note-error">{layoutError}</p> : null}

      {isEditing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={displayedLayout.widgets.map((widget) => widget.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="dashboard-widget-grid" aria-label="Układ widgetów pulpitu">
              {displayedLayout.widgets.map((widget, index) => (
                <SortableDashboardWidget
                  key={widget.id}
                  widget={widget}
                  isEditing
                  index={index}
                  total={displayedLayout.widgets.length}
                  onRemove={removeWidget}
                  onResize={resizeWidget}
                  onMove={moveWidget}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="dashboard-widget-grid" aria-label="Pulpit inwestycyjny">
          {displayedLayout.widgets.map((widget, index) => (
            <SortableDashboardWidget
              key={widget.id}
              widget={widget}
              isEditing={false}
              index={index}
              total={displayedLayout.widgets.length}
              onRemove={removeWidget}
              onResize={resizeWidget}
              onMove={moveWidget}
            />
          ))}
        </div>
      )}

      {displayedLayout.widgets.length === 0 ? (
        <section className="panel dashboard-empty-layout">
          <p className="eyebrow">Pusty pulpit</p>
          <h2 className="section-title">Ułóż widok po swojemu</h2>
          <p className="section-copy">Dodaj pierwszy widget lub przywróć domyślny układ. Dane portfela pozostają bez zmian.</p>
          {isEditing ? (
            <button type="button" className="primary-button mt-5" onClick={(event) => openLibrary(event.currentTarget)}>
              Dodaj widget
            </button>
          ) : (
            <button type="button" className="primary-button mt-5" onClick={startEditing}>
              Edytuj pulpit
            </button>
          )}
        </section>
      ) : null}

      {isLibraryOpen ? (
        <div className="dashboard-library-backdrop" role="presentation" onMouseDown={closeLibrary}>
          <section
            ref={libraryRef}
            className="dashboard-widget-library"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-widget-library-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="dashboard-widget-library-head">
              <div>
                <p className="eyebrow">Biblioteka widgetów</p>
                <h2 id="dashboard-widget-library-title" className="section-title" ref={libraryTitleRef} tabIndex={-1}>
                  Dodaj do pulpitu
                </h2>
                <p className="section-copy">Każdy widok wykorzystuje istniejące dane i może wystąpić tylko raz.</p>
              </div>
              <button
                className="dashboard-widget-icon-button"
                type="button"
                aria-label="Zamknij bibliotekę widgetów"
                onClick={closeLibrary}
              >
                ×
              </button>
            </div>
            {(Object.keys(CATEGORY_LABELS) as DashboardWidgetCategory[]).map((category) => {
              const definitions = DASHBOARD_WIDGET_DEFINITIONS.filter(
                (definition) => definition.category === category
              );
              return (
                <section className="dashboard-library-group" key={category} aria-labelledby={`dashboard-category-${category}`}>
                  <h3 id={`dashboard-category-${category}`}>{CATEGORY_LABELS[category]}</h3>
                  <div className="dashboard-library-items">
                    {definitions.map((definition) => {
                      const isAdded = existingWidgetIds.has(definition.id);
                      return (
                        <button
                          key={definition.id}
                          type="button"
                          className={isAdded ? "dashboard-library-item is-added" : "dashboard-library-item"}
                          disabled={isAdded}
                          onClick={() => addWidget(definition.id)}
                        >
                          <span>
                            <strong>{definition.label}</strong>
                            <small>{definition.description}</small>
                          </span>
                          <em>{isAdded ? "Dodano" : "Dodaj"}</em>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </section>
        </div>
      ) : null}
    </div>
  );
}
