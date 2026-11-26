"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { InstrumentChartLegend, InstrumentPriceChartBody, RangePicker, useInstrumentChartData, type RangeKey } from "@/components/InstrumentChartsWorkspace";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { getAssetClassGroup } from "@/lib/geographic-allocation";
import { instrumentKeyOf, listChartInstruments } from "@/lib/instrument-chart";
import type { PortfolioAssetGroup } from "@/lib/portfolio-engine";
import { formatCurrency, formatDate } from "@/lib/utils";

/**
 * Pozycje as a list with a preview: holdings grouped by asset class on the left, the selected
 * holding on the right (price chart with the user's trades, key numbers, purchases). On a narrow
 * screen the preview opens under the selected row.
 */

const pct = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 6 });
const formatPercent = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) ? `${value > 0 ? "+" : ""}${pct.format(value)}%` : "—");
const tone = (value: number | null | undefined) => (typeof value === "number" ? (value > 0.004 ? "tone-positive" : value < -0.004 ? "tone-negative" : undefined) : undefined);
const signed = (value: number, currency: string) => `${value > 0 ? "+" : ""}${formatCurrency(value, currency)}`;
const DAY_MS = 86_400_000;

const rowId = (group: PortfolioAssetGroup) => `${group.portfolioId ?? "p"}|${group.key}`;

function Icon({ name }: { name: "add" | "chart" | "history" }) {
  const paths = {
    add: <><path d="M3 5h10v8H3z" /><path d="M8 7v4M6 9h4" /></>,
    chart: <><path d="M2.5 12.5h11" /><path d="M3.5 10l3-3 2.5 2 4-4.5" /></>,
    history: <><path d="M3 8a5 5 0 1 0 1.5-3.5" /><path d="M3 3v2.5h2.5" /><path d="M8 5.5V8l1.8 1.2" /></>,
  };
  return <svg viewBox="0 0 16 16" aria-hidden="true" className="positions-icon">{paths[name]}</svg>;
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
  const addHref = workspace.getReadHref(workspace.isAllPortfoliosSelected ? "/portfolios" : "/portfolio/positions?add=asset");
  const analysisHref = workspace.getReadHref(`/analytics/assets?instrument=${encodeURIComponent(instrumentKey)}`);
  const operationsHref = workspace.getReadHref("/portfolio/operations");

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
          <Link href={addHref} className="primary-button"><Icon name="add" />Dodaj transakcję</Link>
          {instrument ? <Link href={analysisHref} className="ghost-button"><Icon name="chart" />Analiza waloru</Link> : null}
          <Link href={operationsHref} className="ghost-button"><Icon name="history" />Operacje</Link>
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
            <RangePicker value={range} onChange={setRange} label="Zakres wykresu" />
          </div>
          <InstrumentChartLegend />
          <InstrumentPriceChartBody instrument={instrument} data={data} height={300} />
        </section>
      ) : group.kind === "bond" ? (
        <p className="field-note">Obligacje skarbowe nie mają notowań rynkowych: ich wartość rośnie z naliczonymi odsetkami.</p>
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
              <thead><tr><th>Walor</th><th className="num">Wartość</th><th className="num">Dziś</th><th className="num">Zysk</th></tr></thead>
              <tbody>
                {sections.map((section) => (
                  <Fragment key={section.id}>
                    <tr className="positions-group">
                      <th scope="rowgroup">{section.label} · {section.rows.length}</th>
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
                            <td className="num">{formatCurrency(group.marketValueBase, base)}<small>{pct.format(share)}%</small></td>
                            <td className={`num ${tone(group.dailyChangePercent) ?? ""}`}>{group.hasDailyChange ? formatPercent(group.dailyChangePercent) : "—"}</td>
                            <td className={`num ${tone(group.profitLossBase) ?? ""}`}>{signed(group.profitLossBase, base)}<small>{formatPercent(group.profitLossPercent)}</small></td>
                          </tr>
                          {isNarrow && isSelected ? (
                            <tr className="positions-inline-preview"><td colSpan={4}><Preview key={id} group={group} showPortfolio={showPortfolio} /></td></tr>
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
