"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { ChartEventNotes, ChartReportList, ChartStyleSwitch, InstrumentChartLegend, InstrumentPriceChartBody, RangePicker, useInstrumentChartData, type RangeKey } from "@/components/InstrumentChartsWorkspace";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { getAssetEntryHref, getDividendEntryHref, getLatestLot, type AssetEntrySide } from "@/lib/asset-entry-prefill";
import { getAssetClassGroup } from "@/lib/geographic-allocation";
import { instrumentKeyOf, listChartInstruments } from "@/lib/instrument-chart";
import type { PortfolioAssetGroup } from "@/lib/portfolio-engine";
import { formatCurrency, formatDate } from "@/lib/utils";

/**
 * Pozycje as a list with a preview: holdings grouped by asset class on the left, the selected
 * holding on the right (price chart with the user's trades, key numbers, purchases). On a narrow
 * screen the preview opens under the selected row.
 */

/** The newest company reports under the chart; the rest are on the instrument's own page. */
const PREVIEW_REPORTS = 4;

const pct = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 6 });
const formatPercent = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? `${value > 0 ? "+" : ""}${pct.format(value)}%` : "—");
const tone = (value: number | null | undefined) => (typeof value === "number" ? (value > 0.004 ? "tone-positive" : value < -0.004 ? "tone-negative" : undefined) : undefined);
const signed = (value: number, currency: string) => `${value > 0 ? "+" : ""}${formatCurrency(value, currency)}`;
const DAY_MS = 86_400_000;

const rowId = (group: PortfolioAssetGroup) => `${group.portfolioId ?? "p"}|${group.key}`;

type ActionKey = "buy" | "sell" | "dividend" | "history" | "analysis";

function Icon({ name }: { name: ActionKey }) {
  const paths = {
    buy: <><path d="M3 5h10v8H3z" /><path d="M8 7v4M6 9h4" /></>,
    sell: <><path d="M3 5h10v8H3z" /><path d="M6 9h4" /></>,
    dividend: <><circle cx="8" cy="8" r="5.5" /><path d="M8 5v6M6.5 6.5h2.2a1.2 1.2 0 0 1 0 2.4H7.3a1.2 1.2 0 0 0 0 2.4h2.2" /></>,
    history: <><path d="M3 8a5 5 0 1 0 1.5-3.5" /><path d="M3 3v2.5h2.5" /><path d="M8 5.5V8l1.8 1.2" /></>,
    analysis: <><path d="M2.5 12.5h11" /><path d="M3.5 10l3-3 2.5 2 4-4.5" /></>,
  };
  return <svg viewBox="0 0 16 16" aria-hidden="true" className="positions-icon">{paths[name]}</svg>;
}

type HoldingAction = { key: ActionKey; label: string; shortLabel: string; href: string; entrySide?: AssetEntrySide };

/**
 * The actions of one holding, shown as icons on its row and as buttons in its preview. In the
 * combined view each one carries the portfolio that holds the position.
 */
function useHoldingActions(group: PortfolioAssetGroup, showPortfolio: boolean, hasAnalysis: boolean) {
  const workspace = usePortfolioWorkspace();
  const searchParams = useSearchParams();
  const lot = getLatestLot(group.lots);
  const targetId = showPortfolio ? group.portfolioId : undefined;
  const paysDividends = (group.kind === "stock" || group.kind === "etf") && group.instrumentType !== "CFD" && group.positionDirection !== "SHORT";
  const operationsParams = new URLSearchParams({ walor: group.symbol });
  if (targetId) operationsParams.set("cel", targetId);
  const actions: HoldingAction[] = [];
  if (lot) {
    actions.push(
      { key: "buy", label: "Kup", shortLabel: "Kup", entrySide: "buy", href: workspace.getReadHref(getAssetEntryHref(lot.id, "buy", targetId)) },
      { key: "sell", label: "Sprzedaj", shortLabel: "Sprzedaj", entrySide: "sell", href: workspace.getReadHref(getAssetEntryHref(lot.id, "sell", targetId)) },
    );
    if (paysDividends) actions.push({ key: "dividend", label: "Dodaj dywidendę", shortLabel: "Dywidenda", href: workspace.getReadHref(getDividendEntryHref(lot.id, targetId)) });
  }
  actions.push({ key: "history", label: "Historia operacji", shortLabel: "Operacje", href: workspace.getReadHref(`/portfolio/operations?${operationsParams.toString()}`) });
  if (hasAnalysis) actions.push({ key: "analysis", label: "Wykres i analiza", shortLabel: "Analiza waloru", href: workspace.getReadHref(`/analytics/assets?instrument=${encodeURIComponent(instrumentKeyOf(group))}`) });
  // With the form already open it changes on the click itself. Waiting for the new address would
  // leave the previous instrument in the form for a moment, ready to be bought or sold.
  const applyToOpenForm = (action: HoldingAction, event: MouseEvent) => {
    if (!action.entrySide || !lot || searchParams.get("add") !== "asset") return;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    workspace.prefillAssetEntry({ lotId: lot.id, targetPortfolioId: targetId ?? null, side: action.entrySide, again: true });
  };
  return { actions, applyToOpenForm };
}

function RowActions({ group, showPortfolio, hasAnalysis }: { group: PortfolioAssetGroup; showPortfolio: boolean; hasAnalysis: boolean }) {
  const { actions, applyToOpenForm } = useHoldingActions(group, showPortfolio, hasAnalysis);
  return (
    <span className="positions-row-icons" onClick={(event) => event.stopPropagation()}>
      {actions.map((action) => (
        <Link key={action.key} href={action.href} prefetch={false} className={`action-${action.key}`} title={action.label} aria-label={`${action.label}: ${group.name}`} onClick={(event: MouseEvent) => applyToOpenForm(action, event)}><Icon name={action.key} /></Link>
      ))}
    </span>
  );
}

function useNarrow(query = "(max-width: 1100px)") {
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setIsNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return isNarrow;
}

function Preview({ group, showPortfolio }: { group: PortfolioAssetGroup; showPortfolio: boolean }) {
  const workspace = usePortfolioWorkspace();
  const [range, setRange] = useState<RangeKey>("ALL");
  const [now] = useState(() => Date.now());
  const instruments = useMemo(() => listChartInstruments(workspace.selectedPortfolios), [workspace.selectedPortfolios]);
  const instrumentKey = instrumentKeyOf(group);
  const instrument = instruments.find((item) => item.key === instrumentKey);
  const data = useInstrumentChartData(instrument, workspace.selectedPortfolios, range);
  const base = group.baseCurrency;
  const total = workspace.summaryTotalValue;
  const share = total > 0 ? (group.marketValueBase / total) * 100 : null;
  const firstPurchase = group.lots.map((lot) => lot.purchaseDate).filter(Boolean).sort()[0];
  const days = firstPurchase ? Math.max(0, Math.round((now - Date.parse(`${firstPurchase}T00:00:00Z`)) / DAY_MS)) : null;
  const { actions, applyToOpenForm } = useHoldingActions(group, showPortfolio, Boolean(instrument));

  return (
    <div className="positions-preview">
      <div className="positions-preview-head">
        <div>
          <h2>{group.name} <span>{group.symbol}</span></h2>
          <p>
            {typeof group.currentUnitPrice === "number" ? formatCurrency(group.currentUnitPrice, group.marketCurrency) : "brak kursu"}
            {group.hasDailyChange ? <> <span className={tone(group.dailyChangePercent)}>{formatPercent(group.dailyChangePercent)}</span></> : null}
            {group.latestPriceDate ? <> · kurs z {formatDate(group.latestPriceDate)}</> : null}
          </p>
        </div>
        <div className="positions-actions">
          {actions.map((action) => (
            <Link key={action.key} href={action.href} prefetch={false} className={`ghost-button action-${action.key}`} onClick={(event: MouseEvent) => applyToOpenForm(action, event)}><Icon name={action.key} />{action.shortLabel}</Link>
          ))}
        </div>
      </div>

      <dl className="positions-facts">
        <div><dt>Wartość</dt><dd>{formatCurrency(group.marketValueBase, base)}</dd></div>
        <div><dt>Zysk</dt><dd className={tone(group.profitLossBase)}>{signed(group.profitLossBase, base)}</dd></div>
        <div><dt>Zwrot</dt><dd className={tone(group.profitLossPercent)}>{formatPercent(group.profitLossPercent)}</dd></div>
        <div><dt>Udział</dt><dd>{share === null ? "—" : `${pct.format(share)}%`}</dd></div>
        <div><dt>Ilość</dt><dd>{qty.format(group.quantity)}</dd></div>
        <div><dt>Śr. cena kupna</dt><dd>{formatCurrency(group.averagePurchasePrice, group.averagePurchasePriceCurrency)}</dd></div>
        <div><dt>Dni w portfelu</dt><dd>{days ?? "—"}</dd></div>
        <div><dt>{showPortfolio ? "Portfel" : "Zakupy"}</dt><dd>{showPortfolio ? group.portfolioName ?? "—" : group.lotsCount}</dd></div>
      </dl>

      {instrument ? (
        <section className="positions-card">
          <div className="positions-card-bar">
            <h3>Kurs i Twoje transakcje</h3>
            <div className="positions-chart-switches">
              <ChartStyleSwitch />
              <RangePicker value={range} onChange={setRange} label="Zakres wykresu" />
            </div>
          </div>
          <InstrumentChartLegend data={data} />
          <InstrumentPriceChartBody instrument={instrument} data={data} height={300} />
          <ChartEventNotes data={data} />
        </section>
      ) : group.kind === "bond" ? (
        <p className="field-note">Obligacje skarbowe nie mają notowań rynkowych: ich wartość rośnie z naliczonymi odsetkami.</p>
      ) : null}

      {instrument && data.announcements.length > 0 ? (
        <section className="positions-card">
          <div className="positions-card-bar">
            <h3>Komunikaty spółki (ESPI)</h3>
            {data.announcements.length > PREVIEW_REPORTS ? <Link href={workspace.getReadHref(`/analytics/assets?instrument=${encodeURIComponent(instrumentKey)}`)} prefetch={false}>Wszystkie ({data.announcements.length}) →</Link> : null}
          </div>
          <ChartReportList data={data} limit={PREVIEW_REPORTS} />
        </section>
      ) : null}

      <section className="positions-card">
        <h3>Zakupy w pozycji</h3>
        <div className="sprint-table-wrap">
          <table className="portfolio-table positions-lots">
            <thead><tr><th>Data</th><th className="num">Ilość</th><th className="num">Cena</th><th className="num">Prowizja</th></tr></thead>
            <tbody>
              {[...group.lots].sort((left, right) => right.purchaseDate.localeCompare(left.purchaseDate)).map((lot) => (
                <tr key={lot.id}>
                  <td>{formatDate(lot.purchaseDate)}</td>
                  <td className="num">{qty.format(lot.quantity)}</td>
                  <td className="num">{formatCurrency(lot.purchasePrice, lot.purchasePriceCurrency ?? lot.purchaseCurrency)}</td>
                  <td className="num">{formatCurrency(lot.feePln ?? 0, "PLN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function PositionsWorkspace({ toolbar }: { toolbar?: ReactNode }) {
  const workspace = usePortfolioWorkspace();
  const isNarrow = useNarrow();
  const showPortfolio = workspace.isAllPortfoliosSelected;
  const base = workspace.activeBaseCurrency;
  const filter = workspace.filter.trim().toLocaleLowerCase("pl-PL");

  const sections = useMemo(() => {
    const map = new Map<string, { id: string; label: string; rows: PortfolioAssetGroup[]; value: number; profit: number; daily: number }>();
    for (const group of workspace.groupedAssets) {
      if (filter && !`${group.name} ${group.symbol} ${group.portfolioName ?? ""}`.toLocaleLowerCase("pl-PL").includes(filter)) continue;
      const bucket = getAssetClassGroup(group);
      const section = map.get(bucket.id) ?? { id: bucket.id, label: bucket.label, rows: [], value: 0, profit: 0, daily: 0 };
      section.rows.push(group);
      section.value += group.marketValueBase;
      section.profit += group.profitLossBase;
      section.daily += group.hasDailyChange ? group.dailyChangeBase ?? 0 : 0;
      map.set(bucket.id, section);
    }
    return [...map.values()]
      .map((section) => ({ ...section, rows: [...section.rows].sort((left, right) => right.marketValueBase - left.marketValueBase) }))
      .sort((left, right) => right.value - left.value);
  }, [filter, workspace.groupedAssets]);

  const allRows = useMemo(() => sections.flatMap((section) => section.rows), [sections]);
  const chartInstrumentKeys = useMemo(() => new Set(listChartInstruments(workspace.selectedPortfolios).map((item) => item.key)), [workspace.selectedPortfolios]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = allRows.find((group) => rowId(group) === selectedId) ?? (isNarrow ? undefined : allRows[0]);

  const daily = workspace.groupedAssets.reduce((sum, group) => sum + (group.hasDailyChange ? group.dailyChangeBase ?? 0 : 0), 0);
  const dailyBase = workspace.summaryTotalValue - daily;
  const invested = workspace.summaryTotalInvested;

  const select = (group: PortfolioAssetGroup) => {
    const id = rowId(group);
    setSelectedId((current) => (isNarrow && current === id ? null : id));
  };

  return (
    <div className="positions-workspace">
      <div className="positions-top">
      <dl className="summary-strip">
        <div><dt>Wartość</dt><dd>{formatCurrency(workspace.summaryTotalValue, base)}</dd></div>
        <div><dt>Dziś</dt><dd className={tone(daily)}>{signed(daily, base)}{dailyBase > 0 ? ` (${formatPercent((daily / dailyBase) * 100)})` : ""}</dd></div>
        <div><dt>Zysk</dt><dd className={tone(workspace.summaryCombinedProfitLoss)}>{signed(workspace.summaryCombinedProfitLoss, base)}</dd></div>
        <div><dt>Zwrot</dt><dd className={tone(workspace.summaryCombinedProfitLoss)}>{invested > 0 ? formatPercent((workspace.summaryCombinedProfitLoss / invested) * 100) : "—"}</dd></div>
        <div><dt>Gotówka</dt><dd>{formatCurrency(workspace.summaryCashValue, base)}</dd></div>
      </dl>
      {toolbar ? <div className="positions-top-actions">{toolbar}</div> : null}
      </div>

      <div className="positions-split">
        <section className="positions-list" aria-label="Lista pozycji">
          <div className="positions-list-bar">
            <input type="search" value={workspace.filter} onChange={(event) => workspace.onFilterChange(event.target.value)} placeholder="Filtruj walory" aria-label="Filtruj walory" />
            <span>{allRows.length} {allRows.length === 1 ? "pozycja" : "pozycji"}</span>
          </div>
          {allRows.length === 0 ? (
            <p className="empty-row">{workspace.groupedAssets.length === 0 ? "Nie masz jeszcze pozycji. Dodaj pierwszą transakcję albo zaimportuj historię od brokera." : "Żaden walor nie pasuje do filtra."}</p>
          ) : (
            <table className="positions-table">
              <thead><tr><th>Walor</th>{isNarrow ? null : <th aria-label="Akcje" />}<th className="num">Wartość</th><th className="num">Dziś</th><th className="num">Zysk</th></tr></thead>
              <tbody>
                {sections.map((section) => (
                  <Fragment key={section.id}>
                    <tr className="positions-group">
                      <th scope="rowgroup" colSpan={isNarrow ? 1 : 2}>{section.label} · {section.rows.length}</th>
                      <td className="num">{formatCurrency(section.value, base)}</td>
                      <td className={`num ${tone(section.daily) ?? ""}`}>{section.value - section.daily > 0 ? formatPercent((section.daily / (section.value - section.daily)) * 100) : "—"}</td>
                      <td className={`num ${tone(section.profit) ?? ""}`}>{signed(section.profit, base)}</td>
                    </tr>
                    {section.rows.map((group) => {
                      const id = rowId(group);
                      const isSelected = selected ? rowId(selected) === id : false;
                      const share = workspace.summaryTotalValue > 0 ? (group.marketValueBase / workspace.summaryTotalValue) * 100 : 0;
                      return (
                        <Fragment key={id}>
                          <tr className={isSelected ? "positions-row is-selected" : "positions-row"} onClick={() => select(group)}>
                            <td>
                              <button type="button" className="positions-name" aria-expanded={isNarrow ? isSelected : undefined} aria-pressed={isNarrow ? undefined : isSelected} onClick={(event) => { event.stopPropagation(); select(group); }}>
                                <strong>{group.name}</strong>
                                <small>{group.symbol} · {qty.format(group.quantity)} szt.{showPortfolio && group.portfolioName ? ` · ${group.portfolioName}` : ""}</small>
                              </button>
                            </td>
                            {isNarrow ? null : <td className="positions-actions-cell"><RowActions group={group} showPortfolio={showPortfolio} hasAnalysis={chartInstrumentKeys.has(instrumentKeyOf(group))} /></td>}
                            <td className="num">{formatCurrency(group.marketValueBase, base)}<small>{pct.format(share)}%</small></td>
                            <td className={`num ${tone(group.dailyChangePercent) ?? ""}`}>{group.hasDailyChange ? formatPercent(group.dailyChangePercent) : "—"}</td>
                            <td className={`num ${tone(group.profitLossBase) ?? ""}`}>{signed(group.profitLossBase, base)}<small>{formatPercent(group.profitLossPercent)}</small></td>
                          </tr>
                          {isNarrow && isSelected ? (
                            <tr className="positions-inline-preview"><td colSpan={isNarrow ? 4 : 5}><Preview key={id} group={group} showPortfolio={showPortfolio} /></td></tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>
        {!isNarrow ? (
          <section className="positions-pane" aria-label="Podgląd waloru">
            {selected ? <Preview key={rowId(selected)} group={selected} showPortfolio={showPortfolio} /> : <p className="empty-row">Wybierz walor z listy.</p>}
          </section>
        ) : null}
      </div>
    </div>
  );
}
