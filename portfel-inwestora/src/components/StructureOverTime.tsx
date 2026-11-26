"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { usePortfolioStructure } from "@/components/usePortfolioStructure";
import { monthTick } from "@/components/instrument-chart-parts";
import { buildStructureSeries, rangeStartIndex, sharesAt, type StructureRange, type StructureSeries, type StructureView } from "@/lib/portfolio-structure-series";
import { formatCurrency, formatDate } from "@/lib/utils";

/**
 * Struktura w czasie: how the portfolio was made up week by week, by asset class, instrument or
 * portfolio, as shares or amounts.
 */

const VIEW_LABELS: Record<StructureView, string> = { classes: "Klasy aktywów", instruments: "Walory", portfolios: "Portfele" };
const RANGE_LABELS: Record<StructureRange, string> = { "6M": "6M", "1Y": "1R", "3Y": "3L", ALL: "Wszystko" };

const percent = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("pl-PL", { notation: "compact", maximumFractionDigits: 1 });
const toTime = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
const AXIS = { fill: "#5e6975", fontSize: 11 };

type Row = { date: string; index: number } & Record<string, number | string>;

function StructureTooltip({ active, payload, series, currency }: { active?: boolean; payload?: Array<{ payload?: Row }>; series: StructureSeries[]; currency: string }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  const shares = sharesAt(series, row.index);
  const items = series.map((item) => ({ ...item, value: item.values[row.index] ?? 0 })).filter((item) => Math.abs(item.value) >= 0.005).sort((left, right) => right.value - left.value);
  return (
    <div className="report-tooltip">
      <strong>{formatDate(row.date)}</strong>
      {items.map((item) => (
        <span key={item.id}><i className="report-tooltip-swatch" style={{ background: item.color }} />{item.label}: {formatCurrency(item.value, currency)}{item.value > 0 ? ` · ${percent.format(shares.get(item.id) ?? 0)}%` : ""}</span>
      ))}
    </div>
  );
}

export default function StructureOverTime() {
  const workspace = usePortfolioWorkspace();
  const ids = useMemo(() => workspace.selectedPortfolios.map((portfolio) => portfolio.id), [workspace.selectedPortfolios]);
  const { data, failed, isLoading } = usePortfolioStructure(ids, workspace.presentationCurrency);
  const [view, setView] = useState<StructureView>("classes");
  const [unit, setUnit] = useState<"share" | "value">("share");
  const [range, setRange] = useState<StructureRange>("ALL");
  const hasPortfolioView = ids.length > 1;
  const activeView = view === "portfolios" && !hasPortfolioView ? "classes" : view;

  const series = useMemo(() => (data ? buildStructureSeries(data, activeView) : []), [activeView, data]);
  const from = data ? rangeStartIndex(data.dates, range) : 0;
  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    return data.dates.slice(from).map((date, offset) => {
      const index = from + offset;
      const shares = sharesAt(series, index);
      const row = { date, index } as Row;
      for (const item of series) row[item.id] = unit === "share" ? shares.get(item.id) ?? 0 : Math.max(0, item.values[index] ?? 0);
      return row;
    });
  }, [data, from, series, unit]);

  const last = data ? data.dates.length - 1 : 0;
  const sharesNow = sharesAt(series, last);
  const sharesThen = sharesAt(series, from);
  const hasNegative = series.some((item) => item.values.slice(from).some((value) => value < -0.5));
  const currency = data?.currency ?? workspace.presentationCurrency;
  const ticks = useMemo(() => {
    const starts = rows.filter((row, index) => index > 0 && row.date.slice(0, 7) !== rows[index - 1]!.date.slice(0, 7));
    const step = Math.max(1, Math.ceil(starts.length / 7));
    return starts.filter((_, index) => index % step === 0).map((row) => row.date);
  }, [rows]);

  return (
    <section className="panel structure-over-time">
      <div className="risk-section-heading">
        <h2 className="section-title">Struktura w czasie</h2>
        <span>{data && data.dates.length ? `Co tydzień · do ${formatDate(data.dates.at(-1)!)}` : null}</span>
      </div>
      <div className="structure-controls">
        <div className="view-switch" role="group" aria-label="Podział">
          {(Object.keys(VIEW_LABELS) as StructureView[]).filter((item) => item !== "portfolios" || hasPortfolioView).map((item) => (
            <button key={item} type="button" aria-pressed={activeView === item} onClick={() => setView(item)}>{VIEW_LABELS[item]}</button>
          ))}
        </div>
        <div className="view-switch" role="group" aria-label="Jednostka">
          <button type="button" aria-pressed={unit === "share"} onClick={() => setUnit("share")}>Udział %</button>
          <button type="button" aria-pressed={unit === "value"} onClick={() => setUnit("value")}>Wartość</button>
        </div>
        <div className="view-switch" role="group" aria-label="Zakres">
          {(Object.keys(RANGE_LABELS) as StructureRange[]).map((item) => (
            <button key={item} type="button" aria-pressed={range === item} onClick={() => setRange(item)}>{RANGE_LABELS[item]}</button>
          ))}
        </div>
      </div>

      {isLoading ? <p className="empty-row">Liczę strukturę portfela z historii notowań…</p> : null}
      {failed ? <p className="field-note field-note-error">Nie udało się policzyć struktury. Odśwież stronę, aby spróbować ponownie.</p> : null}
      {data && rows.length < 2 ? <p className="empty-row">Za mało historii, żeby pokazać zmiany w czasie.</p> : null}

      {data && rows.length >= 2 ? (
        <>
          <ul className="structure-legend" aria-label="Legenda">
            {series.map((item) => <li key={item.id}><i style={{ background: item.color }} />{item.label}<strong>{percent.format(sharesNow.get(item.id) ?? 0)}%</strong></li>)}
          </ul>
          <div className="structure-chart" role="img" aria-label={`Struktura portfela od ${formatDate(rows[0]!.date)} do ${formatDate(rows.at(-1)!.date)} według: ${VIEW_LABELS[activeView].toLowerCase()}. Wartości są też w tabeli pod wykresem.`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="#e7e9ec" vertical={false} />
                <XAxis dataKey="date" ticks={ticks} interval={0} axisLine={false} tickLine={false} tick={AXIS} tickFormatter={(date: string) => monthTick(toTime(date))} />
                <YAxis orientation="right" width={56} axisLine={false} tickLine={false} tick={AXIS} domain={unit === "share" ? [0, 100] : [0, "auto"]} allowDataOverflow={unit === "share"} tickFormatter={(value: number) => (unit === "share" ? `${Math.round(value)}%` : compact.format(value))} />
                <Tooltip content={<StructureTooltip series={series} currency={currency} />} cursor={{ stroke: "#16202a", strokeOpacity: 0.35 }} wrapperStyle={{ outline: "none", zIndex: 20 }} />
                {series.map((item) => <Area key={item.id} type="linear" dataKey={item.id} name={item.label} stackId="structure" stroke="#ffffff" strokeWidth={1} fill={item.color} fillOpacity={1} isAnimationActive={false} />)}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          {hasNegative ? <p className="field-note">Ujemna gotówka (brakujące wpłaty) nie ma udziału na wykresie.</p> : null}
          <details className="structure-table">
            <summary>Tabela</summary>
            <div className="sprint-table-wrap">
              <table className="portfolio-table sprint-table report-table">
                <thead><tr><th>{VIEW_LABELS[activeView]}</th><th className="num">Wartość teraz</th><th className="num">Udział teraz</th><th className="num">Udział {formatDate(rows[0]!.date)}</th><th className="num">Zmiana (pkt proc.)</th></tr></thead>
                <tbody>
                  {series.map((item) => {
                    const now = sharesNow.get(item.id) ?? 0;
                    const then = sharesThen.get(item.id) ?? 0;
                    return (
                      <tr key={item.id}>
                        <td><i className="report-tooltip-swatch" style={{ background: item.color }} />{item.label}</td>
                        <td className="num" data-label="Wartość teraz">{formatCurrency(item.values[last] ?? 0, currency)}</td>
                        <td className="num" data-label="Udział teraz">{percent.format(now)}%</td>
                        <td className="num" data-label="Udział na początku">{percent.format(then)}%</td>
                        <td className="num" data-label="Zmiana">{now - then > 0.05 ? "+" : ""}{percent.format(now - then)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
          {data.warnings.length > 0 ? <details className="structure-table"><summary>Uwagi o danych ({data.warnings.length})</summary><ul>{data.warnings.slice(0, 12).map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
        </>
      ) : null}
    </section>
  );
}
