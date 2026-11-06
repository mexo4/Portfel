"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildDividendForecast } from "@/lib/dividend-engine";
import { convertFromPln } from "@/lib/pricing";
import { formatCurrency, formatDate, getTodayDateInputValue } from "@/lib/utils";
import type { CurrencyCode, FxRates, InvestmentPortfolio, PortfolioDividend } from "@/types/portfolio";

type RangeKey = "YTD" | "1Y" | "3Y" | "5Y" | "MAX";
type AmountMode = "net" | "gross";

type Props = {
  dividends: PortfolioDividend[];
  portfolios: InvestmentPortfolio[];
  fxRates: FxRates;
  currency: CurrencyCode;
  mode: "single" | "aggregate";
};

const ranges: Array<{ key: RangeKey; label: string }> = [
  { key: "YTD", label: "YTD" },
  { key: "1Y", label: "1 rok" },
  { key: "3Y", label: "3 lata" },
  { key: "5Y", label: "5 lat" },
  { key: "MAX", label: "MAX" },
];

const getRangeStart = (range: RangeKey, today: string) => {
  if (range === "MAX") return "0000-00";
  if (range === "YTD") return `${today.slice(0, 4)}-01`;
  const start = new Date(`${today}T12:00:00`);
  start.setMonth(start.getMonth() - (range === "1Y" ? 12 : range === "3Y" ? 36 : 60));
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
};

const getMonthLabel = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("pl-PL", { month: "short" }).format(new Date(year, monthNumber - 1, 1));
};

const getPortfolioColor = (portfolioId: string) => {
  let hash = 2166136261;
  for (let index = 0; index < portfolioId.length; index += 1) {
    hash ^= portfolioId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return `hsl(${hue} 62% 48%)`;
};

export default function DividendIncomeDashboard({ dividends, portfolios, fxRates, currency, mode }: Props) {
  const [range, setRange] = useState<RangeKey>("1Y");
  const [amountMode, setAmountMode] = useState<AmountMode>("net");
  const today = getTodayDateInputValue();
  const portfolioById = useMemo(() => new Map(portfolios.map((portfolio) => [portfolio.id, portfolio])), [portfolios]);
  const received = useMemo(
    () => dividends.filter((dividend) => dividend.paymentDate <= today),
    [dividends, today]
  );
  const forecast = useMemo(() => buildDividendForecast(dividends, today), [dividends, today]);

  const totals = useMemo(() => {
    const ytd = received.filter((dividend) => dividend.paymentDate.slice(0, 4) === today.slice(0, 4));
    const sum = (items: PortfolioDividend[], field: "grossAmountPln" | "netAmountPln") =>
      items.reduce((total, dividend) => total + dividend[field], 0);
    return {
      ytdNet: convertFromPln(sum(ytd, "netAmountPln"), currency, fxRates),
      maxNet: convertFromPln(sum(received, "netAmountPln"), currency, fxRates),
      taxes: convertFromPln(sum(received, "grossAmountPln") - sum(received, "netAmountPln"), currency, fxRates),
      receivedCount: received.length,
    };
  }, [currency, fxRates, received, today]);

  const chartModel = useMemo(() => {
    const startMonth = getRangeStart(range, today);
    const sourceRows = received.filter((dividend) => dividend.paymentDate.slice(0, 7) >= startMonth);
    const portfolioIds = mode === "aggregate"
      ? portfolios.map((portfolio) => portfolio.id)
      : portfolios.slice(0, 1).map((portfolio) => portfolio.id);
    if (sourceRows.length === 0) return { data: [], portfolioIds };
    const monthMap = new Map<string, Record<string, string | number>>();
    sourceRows.forEach((dividend) => {
      const month = dividend.paymentDate.slice(0, 7);
      const dataKey = mode === "aggregate" ? dividend.portfolioId : "__total";
      const row: Record<string, string | number> = monthMap.get(month) ?? { month };
      const amountPln = amountMode === "net"
        ? dividend.netAmountPln
        : dividend.grossAmountPln;
      const previousAmount = typeof row[dataKey] === "number" ? row[dataKey] : 0;
      row[dataKey] = previousAmount + convertFromPln(amountPln, currency, fxRates);
      monthMap.set(month, row);
    });
    const firstDataMonth = sourceRows.reduce<string | null>((first, dividend) => {
      const month = dividend.paymentDate.slice(0, 7);
      return first === null || month < first ? month : first;
    }, null);
    const firstMonth = range === "MAX" ? firstDataMonth : startMonth;
    const data: Array<Record<string, string | number>> = [];
    if (firstMonth) {
      const cursor = new Date(`${firstMonth}-01T12:00:00`);
      const end = new Date(`${today.slice(0, 7)}-01T12:00:00`);
      while (cursor <= end) {
        const month = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
        const row: Record<string, string | number> = monthMap.get(month) ?? { month };
        const series = mode === "aggregate" ? portfolioIds : ["__total"];
        series.forEach((portfolioId) => { if (typeof row[portfolioId] !== "number") row[portfolioId] = 0; });
        data.push({
          ...row,
          monthLabel: `${getMonthLabel(month)} ${month.slice(0, 4)}`,
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }
    return { data, portfolioIds };
  }, [amountMode, currency, fxRates, mode, portfolios, range, received, today]);

  const rankings = useMemo(() => {
    const startMonth = getRangeStart(range, today);
    const periodRows = received.filter((dividend) => dividend.paymentDate.slice(0, 7) >= startMonth);
    if (periodRows.length === 0) return [];
    if (mode === "aggregate") {
      const amountByPortfolio = new Map<string, number>();
      periodRows.forEach((dividend) => amountByPortfolio.set(
        dividend.portfolioId,
        (amountByPortfolio.get(dividend.portfolioId) ?? 0) + dividend.netAmountPln
      ));
      return portfolios.map((portfolio) => ({
        key: portfolio.id,
        name: portfolio.name,
        detail: `${periodRows.filter((dividend) => dividend.portfolioId === portfolio.id).length} wypłat · netto · ${ranges.find((item) => item.key === range)?.label ?? range}`,
        amountPln: amountByPortfolio.get(portfolio.id) ?? 0,
      })).sort((left, right) => right.amountPln - left.amountPln);
    }

    const byInstrument = new Map<string, { key: string; name: string; detail: string; amountPln: number }>();
    periodRows.forEach((dividend) => {
      const key = `${dividend.portfolioId}:${dividend.instrumentId}`;
      const row = byInstrument.get(key) ?? {
        key,
        name: dividend.instrumentName,
        detail: dividend.symbol,
        amountPln: 0,
      };
      row.amountPln += dividend.netAmountPln;
      byInstrument.set(key, row);
    });
    return Array.from(byInstrument.values()).sort((left, right) => right.amountPln - left.amountPln);
  }, [mode, portfolios, range, received, today]);

  const rankingTotal = rankings.reduce((sum, row) => sum + row.amountPln, 0);
  const rangeLabel = ranges.find((item) => item.key === range)?.label ?? range;

  return (
    <div className={`income-dividend-dashboard income-dividend-dashboard-${mode}`}>
      <section className="income-dividend-overview panel panel-compact" aria-label="Podsumowanie dywidend">
        <div className="income-dashboard-heading">
          <div>
            <p className="eyebrow">{mode === "aggregate" ? "Dywidendy · widok łączny" : "Dywidendy portfela"}</p>
            <h2 className="section-title">Dochód z dywidend</h2>
          </div>
          <span className="income-currency-tag">Waluta prezentacji <strong>{currency}</strong></span>
        </div>
        <p className="section-copy">Wypłaty są agregowane po ich istniejącej wartości w PLN i przeliczane do waluty prezentacji. Historia zachowuje walutę każdej operacji.</p>
        <div className="income-dividend-kpis mt-5">
          <article className="income-dividend-kpi income-dividend-kpi-primary"><span>Netto · YTD</span><strong>{formatCurrency(totals.ytdNet, currency)}</strong><small>{today.slice(0, 4)} · wypłaty otrzymane</small></article>
          <article className="income-dividend-kpi"><span>Netto · łącznie</span><strong>{formatCurrency(totals.maxNet, currency)}</strong><small>{totals.receivedCount} zaksięgowanych wypłat</small></article>
          <article className="income-dividend-kpi"><span>Podatki · łącznie</span><strong>{formatCurrency(totals.taxes, currency)}</strong><small>Brutto minus netto</small></article>
          <article className="income-dividend-kpi income-dividend-kpi-next"><span>Najbliższa znana wypłata</span>
            {forecast.nextPayment ? <><strong>{formatCurrency(forecast.nextPayment.netAmount, forecast.nextPayment.currency)}</strong><small>{formatDate(forecast.nextPayment.paymentDate)} · {forecast.nextPayment.symbol}</small></> : <><strong>Brak</strong><small>{forecast.message ?? "Brak zapisanej przyszłej wypłaty."}</small></>}
          </article>
        </div>
      </section>

      <div className="income-dividend-insights-grid">
        <section className="panel income-dividend-chart-panel">
          <div className="income-dashboard-heading income-dashboard-chart-heading">
            <div><p className="eyebrow">Dochód otrzymany</p><h3 className="section-title">Wypłaty miesiąc po miesiącu</h3></div>
            <div className="income-chart-mode" role="group" aria-label="Wartość dywidendy na wykresie">
              <button type="button" className={amountMode === "net" ? "is-active" : ""} aria-pressed={amountMode === "net"} onClick={() => setAmountMode("net")}>Netto</button>
              <button type="button" className={amountMode === "gross" ? "is-active" : ""} aria-pressed={amountMode === "gross"} onClick={() => setAmountMode("gross")}>Brutto</button>
            </div>
          </div>
          <div className="income-range-tabs" role="group" aria-label="Zakres historii dywidend">
            {ranges.map((item) => <button key={item.key} type="button" className={range === item.key ? "is-active" : ""} aria-pressed={range === item.key} onClick={() => setRange(item.key)}>{item.label}</button>)}
          </div>
          {mode === "aggregate" && chartModel.portfolioIds.length ? <div className="income-chart-legend" aria-label="Portfele na wykresie">
            {chartModel.portfolioIds.map((portfolioId) => <span key={portfolioId}><i style={{ backgroundColor: getPortfolioColor(portfolioId) }} aria-hidden="true" />{portfolioById.get(portfolioId)?.name ?? "Portfel"}</span>)}
          </div> : null}
          {chartModel.data.length ? <div className="income-dividend-chart" role="img" aria-label={`Wykres otrzymanych dywidend ${amountMode === "net" ? "netto" : "brutto"} za ${rangeLabel}`}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 480, height: 264 }}>
              <BarChart data={chartModel.data} margin={{ top: 12, right: 8, left: -14, bottom: 2 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
                <XAxis dataKey="monthLabel" axisLine={false} tickLine={false} minTickGap={18} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} width={48} tick={{ fill: "var(--muted)", fontSize: 11 }} tickFormatter={(value: number) => new Intl.NumberFormat("pl-PL", { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 0 }).format(value)} />
                <Tooltip formatter={(value, name) => [formatCurrency(Number(value ?? 0), currency), mode === "aggregate" ? String(name) : amountMode === "net" ? "Netto" : "Brutto"]} labelStyle={{ color: "var(--text)" }} contentStyle={{ borderRadius: 12, borderColor: "var(--line-strong)", background: "var(--surface-strong)", color: "var(--text)" }} />
                {mode === "aggregate" ? chartModel.portfolioIds.map((portfolioId, index) => <Bar key={portfolioId} dataKey={portfolioId} name={portfolioById.get(portfolioId)?.name ?? "Portfel"} stackId="income" fill={getPortfolioColor(portfolioId)} maxBarSize={30} radius={index === chartModel.portfolioIds.length - 1 ? [4, 4, 0, 0] : undefined} />) : <Bar dataKey="__total" name={amountMode === "net" ? "Netto" : "Brutto"} fill="var(--accent)" maxBarSize={34} radius={[5, 5, 0, 0]} />}
              </BarChart>
            </ResponsiveContainer>
          </div> : <div className="income-chart-empty"><strong>Brak wypłat w tym zakresie</strong><span>Prognozy i wydarzenia przyszłe są pokazane osobno — nie wpływają na otrzymany dochód.</span></div>}
        </section>

        <section className="panel income-dividend-sources-panel">
          <div className="income-dashboard-heading"><div><p className="eyebrow">Źródła dochodu</p><h3 className="section-title">{mode === "aggregate" ? "Wkład portfeli" : "Największe wypłaty"}</h3></div><span className="tag">netto</span></div>
          {rankings.length ? <div className="income-source-ranking mt-5">{rankings.slice(0, 6).map((row, index) => {
            const share = rankingTotal > 0 ? (row.amountPln / rankingTotal) * 100 : 0;
            return <div className="income-source-row" key={row.key}><div className="income-source-row-top"><span><i className={`income-source-dot income-source-dot-${index % 6}`} style={mode === "aggregate" ? { backgroundColor: getPortfolioColor(row.key) } : undefined} aria-hidden="true" /><span><strong>{row.name}</strong><small>{row.detail}</small></span></span><strong>{formatCurrency(convertFromPln(row.amountPln, currency, fxRates), currency)}</strong></div><div className="income-source-track" aria-label={`${share.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}% udziału`}><i style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></div><small className="income-source-share">{share.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}% udziału w netto</small></div>;
          })}</div> : <div className="income-source-empty">Po zaksięgowaniu pierwszej dywidendy zobaczysz tu jej źródło.</div>}
        </section>
      </div>
    </div>
  );
}
