"use client";

import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { usePortfolioStructure } from "@/components/usePortfolioStructure";
import { SERIES_COLORS, OTHER_COLOR } from "@/lib/portfolio-structure-series";
import { buildWealthTimeline, WEALTH_TIMELINE_KEYS, WEALTH_TIMELINE_LABELS, type WealthTimelineKey, type WealthTimelinePoint } from "@/lib/wealth-timeline";
import { formatCurrency, formatDate, getTodayDateInputValue } from "@/lib/utils";

/** Wartość majątku i zobowiązań w czasie: assets stacked up, debts down, net worth as a line. */

const COLORS: Record<WealthTimelineKey, string> = {
  investments: SERIES_COLORS[0]!,
  deposits: SERIES_COLORS[2]!,
  property: SERIES_COLORS[3]!,
  vehicles: SERIES_COLORS[4]!,
  valuables: SERIES_COLORS[6]!,
  other: OTHER_COLOR,
  liabilities: SERIES_COLORS[7]!,
};
const NET = "#16202a";
const AXIS = { fill: "#5e6975", fontSize: 11 };
const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];
const compact = new Intl.NumberFormat("pl-PL", { notation: "compact", maximumFractionDigits: 1 });
const monthLabel = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(2, 4)}`;

type Row = WealthTimelinePoint & { debt: number };

function WealthTooltip({ active, payload, keys }: { active?: boolean; payload?: Array<{ payload?: Row }>; keys: WealthTimelineKey[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="report-tooltip">
      <strong>{formatDate(row.date)}</strong>
      <span>Majątek netto: {formatCurrency(row.netWorth, "PLN")}</span>
      {keys.filter((key) => Math.abs(row[key]) >= 0.005).map((key) => (
        <span key={key}><i className="report-tooltip-swatch" style={{ background: COLORS[key] }} />{WEALTH_TIMELINE_LABELS[key]}: {formatCurrency(row[key], "PLN")}</span>
      ))}
    </div>
  );
}

export default function WealthTimeline() {
  const workspace = usePortfolioWorkspace();
  // Wealth is everything the user has, whatever scope is chosen at the top.
  const ids = useMemo(() => workspace.portfolios.map((portfolio) => portfolio.id), [workspace.portfolios]);
  const { data, failed, isLoading } = usePortfolioStructure(ids, "PLN");
  const [today] = useState(() => getTodayDateInputValue());
  const wealthItems = workspace.userProfile.wealthItems;
  const rows = useMemo<Row[]>(() => (isLoading ? [] : buildWealthTimeline({ structure: data, wealthItems, fxRates: workspace.fxRates, today }).map((point) => ({ ...point, debt: -point.liabilities }))), [data, isLoading, today, wealthItems, workspace.fxRates]);
  const keys = WEALTH_TIMELINE_KEYS.filter((key) => rows.some((row) => Math.abs(row[key]) >= 0.005));
  const hasForeign = wealthItems.some((item) => item.currency !== "PLN");
  const hasTypedIn = wealthItems.some((item) => !item.deposit && !item.loan);
  const latest = rows.at(-1);
  const yearEnds = rows.filter((row, index) => index === rows.length - 1 || row.date.slice(5, 7) === "12");

  return (
    <section className="panel wealth-timeline">
      <div className="risk-section-heading">
        <h2 className="section-title">Majątek i zobowiązania w czasie</h2>
        <span>{latest ? `Netto ${formatCurrency(latest.netWorth, "PLN")} · wszystkie portfele i pozycje majątku` : null}</span>
      </div>
      {isLoading ? <p className="empty-row">Liczę historię rachunków inwestycyjnych…</p> : null}
      {failed ? <p className="field-note field-note-error">Nie udało się policzyć historii rachunków inwestycyjnych, więc wykres pokazuje tylko pozycje majątku.</p> : null}
      {!isLoading && rows.length < 2 ? <p className="empty-row">Dodaj pozycje majątku albo transakcje, żeby zobaczyć historię.</p> : null}
      {rows.length >= 2 ? (
        <>
          <ul className="structure-legend" aria-label="Legenda">
            {keys.map((key) => <li key={key}><i style={{ background: COLORS[key] }} />{WEALTH_TIMELINE_LABELS[key]}</li>)}
            <li><i className="is-line" style={{ background: NET }} />Majątek netto</li>
          </ul>
          <div className="structure-chart" role="img" aria-label={`Majątek i zobowiązania co miesiąc od ${formatDate(rows[0]!.date)}. Wartości są też w tabeli pod wykresem.`}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} stackOffset="sign" barCategoryGap="18%">
                <CartesianGrid stroke="#e7e9ec" vertical={false} />
                <XAxis dataKey="date" minTickGap={28} axisLine={false} tickLine={false} tick={AXIS} tickFormatter={monthLabel} />
                <YAxis orientation="right" width={56} axisLine={false} tickLine={false} tick={AXIS} tickFormatter={(value: number) => compact.format(value)} />
                <ReferenceLine y={0} stroke="#8d97a3" />
                <Tooltip content={<WealthTooltip keys={keys} />} cursor={{ fill: "rgba(22, 32, 42, 0.06)" }} wrapperStyle={{ outline: "none", zIndex: 20 }} />
                {keys.map((key) => <Bar key={key} dataKey={key === "liabilities" ? "debt" : key} name={WEALTH_TIMELINE_LABELS[key]} stackId="wealth" fill={COLORS[key]} stroke="#ffffff" strokeWidth={1} maxBarSize={28} isAnimationActive={false} />)}
                <Line dataKey="netWorth" name="Majątek netto" stroke={NET} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="field-note">
            Rachunki inwestycyjne pochodzą z historii notowań, lokaty i kredyty z harmonogramów.
            {hasTypedIn ? " Pozycje wpisane ręcznie liczą się od daty dodania, według wartości wpisanej wtedy (kolejne zmiany Mexo zapamiętuje od teraz)." : ""}
            {hasForeign ? " Pozycje w obcych walutach przeliczone po dzisiejszym kursie." : ""}
          </p>
          <details className="structure-table">
            <summary>Tabela (koniec każdego roku i dziś)</summary>
            <div className="sprint-table-wrap">
              <table className="portfolio-table sprint-table report-table">
                <thead><tr><th>Data</th>{keys.map((key) => <th key={key} className="num">{WEALTH_TIMELINE_LABELS[key]}</th>)}<th className="num">Majątek netto</th></tr></thead>
                <tbody>{yearEnds.map((row) => <tr key={row.date}><td>{formatDate(row.date)}</td>{keys.map((key) => <td key={key} className="num" data-label={WEALTH_TIMELINE_LABELS[key]}>{formatCurrency(row[key], "PLN")}</td>)}<td className="num" data-label="Majątek netto"><strong>{formatCurrency(row.netWorth, "PLN")}</strong></td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </>
      ) : null}
    </section>
  );
}
