"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, Treemap, XAxis, YAxis } from "recharts";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { useWorkspaceHistory } from "@/components/useWorkspaceHistory";
import {
  buildHeatmapCells,
  buildHoldingsByAccount,
  buildPeriodReturns,
  buildProfitByAccount,
  buildProfitByType,
  summarizePeriodReturns,
  type HeatmapCell,
  type PeriodGranularity,
  type PeriodReturn,
  type ProfitGroupReport,
} from "@/lib/portfolio-reports";
import { formatCurrency } from "@/lib/utils";

const POSITIVE = "#087657";
const NEGATIVE = "#b42318";
const NEUTRAL = "#e7e1d7";
const AXIS = { fill: "#7b8895", fontSize: 11, fontWeight: 700 };

const percentFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatPercent = (value: number | null) => (value === null ? "—" : `${value > 0 ? "+" : ""}${percentFormatter.format(value)}%`);
const tone = (value: number) => (value > 0 ? "tone-positive" : value < 0 ? "tone-negative" : undefined);

function ProfitTable({ report, firstColumn, caption }: { report: ProfitGroupReport; firstColumn: string; caption: string }) {
  const scale = Math.max(0, ...report.rows.map((row) => Math.abs(row.totalProfitPln)));
  return (
    <div className="sprint-table-wrap mt-4">
      <table className="portfolio-table sprint-table report-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th>{firstColumn}</th>
            <th>Wartość</th>
            <th>Otwarte</th>
            <th>Sprzedane</th>
            <th>Dywidendy</th>
            <th>Wynik</th>
            <th>Zwrot</th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((row) => (
            <tr key={row.key}>
              <td>
                <strong>{row.label}</strong>
                {row.detail ? <small className="block">{row.detail}</small> : null}
                <span className="report-bar" aria-hidden="true">
                  <i className={row.totalProfitPln < 0 ? "is-negative" : undefined} style={{ width: `${scale > 0 ? Math.max(2, Math.round((Math.abs(row.totalProfitPln) / scale) * 100)) : 0}%` }} />
                </span>
              </td>
              <td data-label="Wartość teraz">{row.valuePln === 0 && row.openCostPln > 0 ? "brak wyceny" : formatCurrency(row.valuePln, "PLN")}<small className="block">{row.openPositions > 0 ? `${row.openPositions} ${row.openPositions === 1 ? "walor" : row.openPositions < 5 ? "walory" : "walorów"}` : "brak otwartych"}</small></td>
              <td data-label="Otwarte pozycje" className={tone(row.openProfitPln)}>{formatCurrency(row.openProfitPln, "PLN")}</td>
              <td data-label="Sprzedane" className={tone(row.realizedProfitPln)}>{formatCurrency(row.realizedProfitPln, "PLN")}</td>
              <td data-label="Dywidendy" className={tone(row.dividendsPln)}>{formatCurrency(row.dividendsPln, "PLN")}</td>
              <td data-label="Wynik łącznie" className={tone(row.totalProfitPln)}><strong>{formatCurrency(row.totalProfitPln, "PLN")}</strong></td>
              <td data-label="Zwrot" className={tone(row.returnPercent ?? 0)}>{formatPercent(row.returnPercent)}</td>
            </tr>
          ))}
        </tbody>
        {report.rows.length > 1 ? (
          <tfoot>
            <tr>
              <td><strong>Razem</strong></td>
              <td data-label="Wartość teraz">{formatCurrency(report.total.valuePln, "PLN")}</td>
              <td data-label="Otwarte pozycje" className={tone(report.total.openProfitPln)}>{formatCurrency(report.total.openProfitPln, "PLN")}</td>
              <td data-label="Sprzedane" className={tone(report.total.realizedProfitPln)}>{formatCurrency(report.total.realizedProfitPln, "PLN")}</td>
              <td data-label="Dywidendy" className={tone(report.total.dividendsPln)}>{formatCurrency(report.total.dividendsPln, "PLN")}</td>
              <td data-label="Wynik łącznie" className={tone(report.total.totalProfitPln)}><strong>{formatCurrency(report.total.totalProfitPln, "PLN")}</strong></td>
              <td data-label="Zwrot" className={tone(report.total.returnPercent ?? 0)}>{formatPercent(report.total.returnPercent)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Heat map

type HeatMode = "daily" | "total";

/** Gray at zero, deeper green or red with the size of the move, full at `cap` percent. */
const heatColor = (value: number | null, cap: number) => {
  if (value === null) return { fill: NEUTRAL, text: "#142330" };
  const intensity = Math.min(1, Math.abs(value) / cap);
  const [r, g, b] = value >= 0 ? [8, 118, 87] : [180, 35, 24];
  const [nr, ng, nb] = [231, 225, 215];
  const mix = (from: number, to: number) => Math.round(from + (to - from) * (0.18 + 0.82 * intensity));
  return { fill: `rgb(${mix(nr, r)}, ${mix(ng, g)}, ${mix(nb, b)})`, text: intensity > 0.45 ? "#ffffff" : "#142330" };
};

// Treemap passes the cell size as `value`, so the colour value travels as `change`.
type TreemapNodeProps = { x?: number; y?: number; width?: number; height?: number; symbol?: string; name?: string; change?: number | null; cap?: number; depth?: number };

function HeatmapNode(props: TreemapNodeProps) {
  const { x = 0, y = 0, width = 0, height = 0, symbol, change = null, cap = 3, depth } = props;
  if (depth === 0 || width <= 0 || height <= 0) return null;
  const color = heatColor(change, cap);
  const showSymbol = width > 46 && height > 26;
  const showValue = width > 56 && height > 42;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={6} fill={color.fill} stroke="#fffdf8" strokeWidth={2} />
      {showSymbol ? (
        <text x={x + width / 2} y={y + height / 2 - (showValue ? 7 : 0)} textAnchor="middle" dominantBaseline="middle" fill={color.text} fontSize={Math.min(16, Math.max(11, width / 7))} fontWeight={800}>
          {(symbol ?? "").replace(/\.(PL|WA|US|DE|UK|L)$/i, "")}
        </text>
      ) : null}
      {showValue ? (
        <text x={x + width / 2} y={y + height / 2 + 11} textAnchor="middle" dominantBaseline="middle" fill={color.text} fontSize={11} fontWeight={700}>
          {formatPercent(change)}
        </text>
      ) : null}
    </g>
  );
}

function HeatmapTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: HeatmapCell }> }) {
  const cell = active ? payload?.[0]?.payload : undefined;
  if (!cell) return null;
  return (
    <div className="report-tooltip">
      <strong>{cell.name}</strong>
      <span>{cell.symbol} · {percentFormatter.format(cell.sharePercent)}% portfela</span>
      <span>Wartość: {formatCurrency(cell.valuePln, "PLN")}</span>
      <span>Dziś: {formatPercent(cell.dailyChangePercent)}</span>
      <span>Od zakupu: {formatPercent(cell.profitPercent)} ({formatCurrency(cell.profitPln, "PLN")})</span>
    </div>
  );
}

function PortfolioHeatmap() {
  const { groupedAssets } = usePortfolioWorkspace();
  const [mode, setMode] = useState<HeatMode>("daily");
  const cells = useMemo(() => buildHeatmapCells(groupedAssets), [groupedAssets]);
  const cap = mode === "daily" ? 3 : 40;
  const data = useMemo(() => cells.map((cell) => ({ ...cell, size: cell.valuePln, change: mode === "daily" ? cell.dailyChangePercent : cell.profitPercent, cap })), [cap, cells, mode]);

  return (
    <section className="panel">
      <div className="risk-section-heading">
        <div>
          <p className="eyebrow">Mapa cieplna</p>
          <h2 className="section-title">Portfel na jednym obrazku</h2>
        </div>
        <div className="risk-period-selector" role="group" aria-label="Kolor pola">
          <button type="button" className={mode === "daily" ? "is-active" : ""} aria-pressed={mode === "daily"} onClick={() => setMode("daily")}>Dzisiejsza zmiana</button>
          <button type="button" className={mode === "total" ? "is-active" : ""} aria-pressed={mode === "total"} onClick={() => setMode("total")}>Wynik od zakupu</button>
        </div>
      </div>
      {cells.length === 0 ? (
        <p className="empty-row mt-4">Mapa pojawi się, gdy portfel będzie miał wycenione pozycje.</p>
      ) : (
        <>
          <div className="report-heatmap mt-4" role="img" aria-label={`Mapa cieplna ${cells.length} walorów: wielkość pola to wartość pozycji, kolor to ${mode === "daily" ? "dzisiejsza zmiana ceny" : "wynik od zakupu"}.`}>
            <ResponsiveContainer width="100%" height="100%">
              <Treemap data={data} dataKey="size" nameKey="symbol" isAnimationActive={false} content={<HeatmapNode />}>
                <Tooltip content={<HeatmapTooltip />} wrapperStyle={{ outline: "none", zIndex: 20 }} />
              </Treemap>
            </ResponsiveContainer>
          </div>
          <div className="report-heat-legend" aria-hidden="true">
            <span>{formatPercent(-cap)} lub mniej</span>
            <i style={{ background: `linear-gradient(90deg, ${heatColor(-cap, cap).fill}, ${NEUTRAL}, ${heatColor(cap, cap).fill})` }} />
            <span>{formatPercent(cap)} lub więcej</span>
          </div>
          <p className="field-note">Wielkość pola to wartość pozycji. Ten sam walor w kilku portfelach jest jednym polem. Szare pole: brak dzisiejszego notowania.</p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Return of each period

const GRANULARITY_LABELS: Record<PeriodGranularity, string> = { day: "Dni", week: "Tygodnie", month: "Miesiące", year: "Lata" };
const GRANULARITY_LIMITS: Record<PeriodGranularity, number> = { day: 90, week: 104, month: 120, year: 50 };

function PeriodTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: PeriodReturn }> }) {
  const period = active ? payload?.[0]?.payload : undefined;
  if (!period) return null;
  return (
    <div className="report-tooltip">
      <strong>{period.label}</strong>
      <span className={tone(period.returnPercent)}>{formatPercent(period.returnPercent)}</span>
      <span>Wynik: {formatCurrency(period.resultPln, "PLN")}</span>
      {!period.isComplete ? <span>Okres niepełny</span> : null}
    </div>
  );
}

function PeriodReturnsChart() {
  const { history, error, isLoading, hasInputs } = useWorkspaceHistory();
  const [granularity, setGranularity] = useState<PeriodGranularity>("month");
  const periods = useMemo(() => (history ? buildPeriodReturns(history.points, granularity).slice(-GRANULARITY_LIMITS[granularity]) : []), [granularity, history]);
  const stats = useMemo(() => summarizePeriodReturns(periods), [periods]);

  return (
    <section className="panel">
      <div className="risk-section-heading">
        <div>
          <p className="eyebrow">Zmienność stopy zwrotu</p>
          <h2 className="section-title">Plusy i minusy w kolejnych okresach</h2>
        </div>
        <div className="risk-period-selector" role="group" aria-label="Długość okresu">
          {(Object.keys(GRANULARITY_LABELS) as PeriodGranularity[]).map((item) => (
            <button key={item} type="button" className={granularity === item ? "is-active" : ""} aria-pressed={granularity === item} onClick={() => setGranularity(item)}>{GRANULARITY_LABELS[item]}</button>
          ))}
        </div>
      </div>
      {!hasInputs ? (
        <p className="empty-row mt-4">Dodaj operacje, aby zobaczyć stopy zwrotu w kolejnych okresach.</p>
      ) : isLoading ? (
        <p className="empty-row mt-4">Wczytywanie historii portfela…</p>
      ) : error ? (
        <p className="empty-row mt-4">{error}</p>
      ) : periods.length === 0 ? (
        <p className="empty-row mt-4">Za mało danych w historii portfela.</p>
      ) : (
        <>
          {stats ? (
            <div className="risk-metric-grid risk-metric-grid-summary mt-5">
              <article className="risk-metric-card"><div className="risk-metric-label"><span>Okresy na plusie</span></div><strong className="tone-positive">{stats.positive}</strong><small>z {stats.count} · na minusie {stats.negative}</small></article>
              <article className="risk-metric-card"><div className="risk-metric-label"><span>Średnio</span></div><strong className={tone(stats.averagePercent)}>{formatPercent(stats.averagePercent)}</strong><small>Średnia z okresów</small></article>
              <article className="risk-metric-card"><div className="risk-metric-label"><span>Najlepszy</span></div><strong className="tone-positive">{formatPercent(stats.bestPercent)}</strong><small>Najwyższy wynik okresu</small></article>
              <article className="risk-metric-card"><div className="risk-metric-label"><span>Najgorszy</span></div><strong className="tone-negative">{formatPercent(stats.worstPercent)}</strong><small>Najniższy wynik okresu</small></article>
              <article className="risk-metric-card"><div className="risk-metric-label"><span>Odchylenie</span></div><strong>{percentFormatter.format(stats.deviationPercent)} p.p.</strong><small>Jak mocno okresy różnią się od średniej</small></article>
            </div>
          ) : null}
          <div className="report-bars mt-4" role="img" aria-label={`Wykres słupkowy: stopa zwrotu w ${periods.length} okresach, słupki w górę to zysk, w dół strata.`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={periods} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid stroke="rgba(20, 35, 48, 0.08)" strokeDasharray="3 10" vertical={false} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS} minTickGap={24} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS} orientation="right" width={56} tickFormatter={(value: number) => `${percentFormatter.format(value)}%`} />
                <ReferenceLine y={0} stroke="rgba(20, 35, 48, 0.35)" />
                <Tooltip content={<PeriodTooltip />} cursor={{ fill: "rgba(20, 35, 48, 0.05)" }} wrapperStyle={{ outline: "none", zIndex: 20 }} />
                <Bar dataKey="returnPercent" radius={[3, 3, 3, 3]} maxBarSize={28} isAnimationActive={false}>
                  {periods.map((period) => <Cell key={period.key} fill={period.returnPercent >= 0 ? POSITIVE : NEGATIVE} fillOpacity={period.isComplete ? 1 : 0.55} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="field-note">
            Stopa zwrotu okresu nie liczy wpłat i wypłat jako zysku: to ta sama dzienna seria, z której powstają tabele miesięczne i roczne w wynikach. Jaśniejszy słupek to okres niepełny (początek historii albo bieżący okres).
            {granularity === "day" ? " Widać ostatnie 90 dni." : granularity === "week" ? " Widać ostatnie 104 tygodnie." : ""}
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function AccountHoldings() {
  const { selectedPortfolios, fxRates } = usePortfolioWorkspace();
  const accounts = useMemo(() => buildHoldingsByAccount(selectedPortfolios, fxRates), [fxRates, selectedPortfolios]);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section className="panel">
      <div className="risk-section-heading">
        <div>
          <p className="eyebrow">Udział walorów</p>
          <h2 className="section-title">Co jest na każdym koncie</h2>
        </div>
      </div>
      {accounts.length === 0 ? (
        <p className="empty-row mt-4">Brak wycenionych pozycji.</p>
      ) : (
        <div className="report-accounts mt-4">
          {accounts.map((account) => {
            const isOpen = expanded === account.key;
            const visible = isOpen ? account.holdings : account.holdings.slice(0, 6);
            return (
              <article key={account.key} className="report-account">
                <header>
                  <div><strong>{account.label}</strong><small>{account.detail}</small></div>
                  <span>{formatCurrency(account.valuePln, "PLN")}</span>
                </header>
                <ul>
                  {visible.map((holding) => (
                    <li key={holding.key}>
                      <div className="report-account-row">
                        <span title={holding.name}><strong>{holding.symbol}</strong> {holding.name}</span>
                        <span>{percentFormatter.format(holding.sharePercent)}%</span>
                      </div>
                      <span className="report-share" aria-hidden="true"><i style={{ width: `${Math.max(1, holding.sharePercent)}%` }} /></span>
                      <small>{formatCurrency(holding.valuePln, "PLN")} · wynik <span className={tone(holding.profitPln)}>{formatCurrency(holding.profitPln, "PLN")}</span></small>
                    </li>
                  ))}
                </ul>
                {account.holdings.length > 6 ? (
                  <button type="button" className="ghost-button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : account.key)}>
                    {isOpen ? "Pokaż mniej" : `Pokaż wszystkie (${account.holdings.length})`}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function ReportsWorkspace() {
  const { selectedPortfolios, fxRates } = usePortfolioWorkspace();
  const byType = useMemo(() => buildProfitByType(selectedPortfolios, fxRates), [fxRates, selectedPortfolios]);
  const byAccount = useMemo(() => buildProfitByAccount(selectedPortfolios, fxRates), [fxRates, selectedPortfolios]);

  return (
    <div className="reports-workspace">
      <section className="panel">
        <div className="risk-section-heading">
          <div>
            <p className="eyebrow">Zysk według typu inwestycji</p>
            <h2 className="section-title">Akcje, ETF, krypto, obligacje</h2>
          </div>
        </div>
        {byType.rows.length === 0 ? <p className="empty-row mt-4">Brak pozycji i sprzedaży.</p> : <ProfitTable report={byType} firstColumn="Typ" caption="Wynik według typu inwestycji" />}
        <p className="field-note mt-4">
          Wynik łącznie = wynik otwartych pozycji (wartość minus koszt z prowizjami) + wynik sprzedaży zapisany przy każdej transakcji + dywidendy po podatku. Zwrot liczony jest od kosztu otwartych pozycji i kosztu tego, co już sprzedane. Kwoty w PLN.
        </p>
      </section>

      <section className="panel">
        <div className="risk-section-heading">
          <div>
            <p className="eyebrow">Zysk według konta</p>
            <h2 className="section-title">Rachunki maklerskie</h2>
          </div>
        </div>
        {byAccount.rows.length === 0 ? <p className="empty-row mt-4">Brak pozycji i sprzedaży.</p> : <ProfitTable report={byAccount} firstColumn="Konto" caption="Wynik według konta" />}
        <p className="field-note mt-4">Transakcja trafia na konto, z którego ją zapisano (np. z importu XTB). Pozycje dodane ręcznie, obligacje i wyniki dopisane bez konta są na koncie głównym portfela.</p>
      </section>

      <AccountHoldings />
      <PortfolioHeatmap />
      <PeriodReturnsChart />
    </div>
  );
}
