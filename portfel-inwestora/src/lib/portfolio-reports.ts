import { getPortfolioDividends } from "@/lib/dividend-engine";
import type { PortfolioAssetGroup } from "@/lib/portfolio-engine";
import { getAssetMarketValuePln, getAssetProfitLossPln, getAssetPurchaseValuePln, hasAssetBaseCurrencyValuation } from "@/lib/portfolio-engine";
import { buildCalendarReturns, deriveDailyCashFlowNeutralReturns } from "@/lib/portfolio-risk-analytics";
import { getPortfolioAssetGroupKey } from "@/lib/ticker";
import { round } from "@/lib/utils";
import type { AssetKind, FxRates, InstrumentType, InvestmentPortfolio, PortfolioAccount, PortfolioHistoryPoint } from "@/types/portfolio";

/**
 * Reports built from what Mexo already stores: the result split by kind of investment and by the
 * broker account a trade went through, the holdings of each account, the heat map of open
 * positions and the return of each day, week, month or year.
 *
 * The result of a group is: the open result of its positions (value now minus cost with fees), the
 * result stored with each sale, results added by hand or imported, and dividends after tax. The
 * first three add up to the nominal result in the summary; dividends come on top, as on the
 * results page.
 */

export type ProfitGroupRow = {
  key: string;
  label: string;
  detail?: string;
  /** Value of the open positions now. */
  valuePln: number;
  /** Cost of the open positions, with buy fees. */
  openCostPln: number;
  openProfitPln: number;
  realizedProfitPln: number;
  /** Cost of the lots already sold: with the open cost, the capital the result was earned on. */
  realizedCostPln: number;
  dividendsPln: number;
  totalProfitPln: number;
  /** Total result / (open cost + cost of what was sold); null when nothing was invested. */
  returnPercent: number | null;
  openPositions: number;
};

export type ProfitGroupReport = { rows: ProfitGroupRow[]; total: ProfitGroupRow };

type Sums = Omit<ProfitGroupRow, "key" | "label" | "detail" | "totalProfitPln" | "returnPercent" | "openPositions"> & { groups: Set<string> };

const emptySums = (): Sums => ({ valuePln: 0, openCostPln: 0, openProfitPln: 0, realizedProfitPln: 0, realizedCostPln: 0, dividendsPln: 0, groups: new Set() });

const toRow = (key: string, label: string, sums: Sums, detail?: string): ProfitGroupRow => {
  const totalProfitPln = sums.openProfitPln + sums.realizedProfitPln + sums.dividendsPln;
  const capital = sums.openCostPln + sums.realizedCostPln;
  return {
    key,
    label,
    ...(detail ? { detail } : {}),
    valuePln: round(sums.valuePln, 2),
    openCostPln: round(sums.openCostPln, 2),
    openProfitPln: round(sums.openProfitPln, 2),
    realizedProfitPln: round(sums.realizedProfitPln, 2),
    realizedCostPln: round(sums.realizedCostPln, 2),
    dividendsPln: round(sums.dividendsPln, 2),
    totalProfitPln: round(totalProfitPln, 2),
    returnPercent: capital > 0 ? round((totalProfitPln / capital) * 100, 2) : null,
    openPositions: sums.groups.size,
  };
};

const addTotals = (rows: ProfitGroupRow[]): ProfitGroupReport => {
  const sums = emptySums();
  let openPositions = 0;
  for (const row of rows) {
    sums.valuePln += row.valuePln;
    sums.openCostPln += row.openCostPln;
    sums.openProfitPln += row.openProfitPln;
    sums.realizedProfitPln += row.realizedProfitPln;
    sums.realizedCostPln += row.realizedCostPln;
    sums.dividendsPln += row.dividendsPln;
    openPositions += row.openPositions;
  }
  return { rows, total: { ...toRow("total", "Razem", sums), openPositions } };
};

// ---------------------------------------------------------------------------------------------
// By kind of investment

export type InvestmentTypeKey = "stock" | "etf" | "crypto" | "bond" | "cfd" | "other";

const TYPE_LABELS: Record<InvestmentTypeKey, string> = {
  stock: "Akcje",
  etf: "ETF",
  crypto: "Kryptowaluty",
  bond: "Obligacje skarbowe",
  cfd: "CFD",
  other: "Wyniki bez przypisanego waloru",
};
const TYPE_ORDER: InvestmentTypeKey[] = ["stock", "etf", "crypto", "bond", "cfd", "other"];

const typeOf = (item: { kind?: AssetKind; instrumentType?: InstrumentType }): InvestmentTypeKey =>
  item.instrumentType === "CFD" ? "cfd" : item.kind && item.kind in TYPE_LABELS ? item.kind : "stock";

const lotCostPln = (asset: InvestmentPortfolio["assets"][number], fxRates: FxRates) => getAssetPurchaseValuePln(asset, fxRates) + (asset.feePln ?? 0);

export const buildProfitByType = (portfolios: InvestmentPortfolio[], fxRates: FxRates): ProfitGroupReport => {
  const sums = new Map<InvestmentTypeKey, Sums>();
  const bucket = (key: InvestmentTypeKey) => sums.get(key) ?? sums.set(key, emptySums()).get(key)!;

  for (const portfolio of portfolios) {
    for (const asset of portfolio.assets ?? []) {
      const target = bucket(typeOf(asset));
      target.groups.add(`${portfolio.id}|${getPortfolioAssetGroupKey(asset)}`);
      target.openCostPln += lotCostPln(asset, fxRates);
      if (!hasAssetBaseCurrencyValuation(asset, fxRates)) continue;
      target.valuePln += getAssetMarketValuePln(asset, fxRates);
      target.openProfitPln += getAssetProfitLossPln(asset, fxRates);
    }
    for (const sale of portfolio.sales ?? []) {
      const target = bucket(typeOf(sale));
      target.realizedProfitPln += sale.realizedProfitLossPln;
      target.realizedCostPln += sale.realizedInvestedPln;
    }
    for (const adjustment of portfolio.realizedAdjustments ?? []) {
      bucket(adjustment.source === "bond-coupon" ? "bond" : "other").realizedProfitPln += adjustment.amountPlnSnapshot;
    }
    const instruments = new Map((portfolio.instruments ?? []).map((instrument) => [instrument.id, instrument]));
    for (const dividend of getPortfolioDividends(portfolio, fxRates)) {
      const instrument = instruments.get(dividend.instrumentId);
      bucket(typeOf({ kind: instrument?.assetKind, instrumentType: instrument?.type })).dividendsPln += dividend.netAmountPln;
    }
  }

  return addTotals(TYPE_ORDER.filter((key) => sums.has(key)).map((key) => toRow(key, TYPE_LABELS[key], sums.get(key)!)));
};

// ---------------------------------------------------------------------------------------------
// By broker account

const DEFAULT_ACCOUNT = "default";

/** The account a trade went through: a broker account, or the portfolio's main account. */
const accountKey = (portfolio: InvestmentPortfolio, accountsById: Map<string, PortfolioAccount>, accountId: string | undefined) => {
  let account = accountId ? accountsById.get(accountId) : undefined;
  // A currency sub-account counts with the broker account it belongs to.
  if (account?.parentAccountId && accountsById.has(account.parentAccountId)) account = accountsById.get(account.parentAccountId);
  return !account || account.isDefault ? DEFAULT_ACCOUNT : account.id;
};

export type AccountLabel = { key: string; label: string; detail: string };

const accountLabel = (portfolio: InvestmentPortfolio, accountsById: Map<string, PortfolioAccount>, key: string, showPortfolio: boolean): AccountLabel => {
  const id = `${portfolio.id}|${key}`;
  if (key === DEFAULT_ACCOUNT) {
    return { key: id, label: showPortfolio ? portfolio.name : "Konto główne portfela", detail: showPortfolio ? "Konto główne portfela" : portfolio.name };
  }
  return { key: id, label: accountsById.get(key)?.name ?? "Konto inwestycyjne", detail: portfolio.name };
};

/** Maps each lot and sale to the account of the operation recorded with it. */
const tradeAccounts = (portfolio: InvestmentPortfolio, accountsById: Map<string, PortfolioAccount>) => {
  const byLot = new Map<string, string>();
  const bySale = new Map<string, string>();
  for (const operation of portfolio.operations ?? []) {
    const lotId = typeof operation.metadata?.lotId === "string" ? operation.metadata.lotId : null;
    const saleId = typeof operation.metadata?.saleId === "string" ? operation.metadata.saleId : null;
    if (lotId && (operation.operationType === "BUY" || operation.operationType === "SELL") && !byLot.has(lotId)) {
      byLot.set(lotId, accountKey(portfolio, accountsById, operation.accountId));
    }
    if (saleId && (operation.operationType === "SELL" || operation.operationType === "BUY") && !bySale.has(saleId)) {
      bySale.set(saleId, accountKey(portfolio, accountsById, operation.accountId));
    }
  }
  return { byLot, bySale };
};

export const buildProfitByAccount = (portfolios: InvestmentPortfolio[], fxRates: FxRates): ProfitGroupReport => {
  const sums = new Map<string, { label: AccountLabel; sums: Sums }>();
  const showPortfolio = portfolios.length > 1;

  for (const portfolio of portfolios) {
    const accountsById = new Map((portfolio.accounts ?? []).map((account) => [account.id, account]));
    const { byLot, bySale } = tradeAccounts(portfolio, accountsById);
    const bucket = (key: string) => {
      const label = accountLabel(portfolio, accountsById, key, showPortfolio);
      return (sums.get(label.key) ?? sums.set(label.key, { label, sums: emptySums() }).get(label.key)!).sums;
    };

    for (const asset of portfolio.assets ?? []) {
      const target = bucket(byLot.get(asset.id) ?? DEFAULT_ACCOUNT);
      target.groups.add(getPortfolioAssetGroupKey(asset));
      target.openCostPln += lotCostPln(asset, fxRates);
      if (!hasAssetBaseCurrencyValuation(asset, fxRates)) continue;
      target.valuePln += getAssetMarketValuePln(asset, fxRates);
      target.openProfitPln += getAssetProfitLossPln(asset, fxRates);
    }
    for (const sale of portfolio.sales ?? []) {
      const target = bucket(bySale.get(sale.id) ?? DEFAULT_ACCOUNT);
      target.realizedProfitPln += sale.realizedProfitLossPln;
      target.realizedCostPln += sale.realizedInvestedPln;
    }
    for (const adjustment of portfolio.realizedAdjustments ?? []) bucket(DEFAULT_ACCOUNT).realizedProfitPln += adjustment.amountPlnSnapshot;
    for (const dividend of getPortfolioDividends(portfolio, fxRates)) {
      bucket(accountKey(portfolio, accountsById, dividend.accountId)).dividendsPln += dividend.netAmountPln;
    }
  }

  const rows = [...sums.values()]
    .map(({ label, sums: values }) => toRow(label.key, label.label, values, label.detail))
    .sort((left, right) => right.valuePln - left.valuePln || right.totalProfitPln - left.totalProfitPln);
  return addTotals(rows);
};

// ---------------------------------------------------------------------------------------------
// Holdings of each account

export type AccountHolding = { key: string; name: string; symbol: string; valuePln: number; sharePercent: number; profitPln: number };
export type AccountHoldings = { key: string; label: string; detail: string; valuePln: number; holdings: AccountHolding[] };

export const buildHoldingsByAccount = (portfolios: InvestmentPortfolio[], fxRates: FxRates): AccountHoldings[] => {
  const accounts = new Map<string, { label: AccountLabel; holdings: Map<string, Omit<AccountHolding, "sharePercent">> }>();
  const showPortfolio = portfolios.length > 1;

  for (const portfolio of portfolios) {
    const accountsById = new Map((portfolio.accounts ?? []).map((account) => [account.id, account]));
    const { byLot } = tradeAccounts(portfolio, accountsById);
    for (const asset of portfolio.assets ?? []) {
      if (!hasAssetBaseCurrencyValuation(asset, fxRates)) continue;
      const label = accountLabel(portfolio, accountsById, byLot.get(asset.id) ?? DEFAULT_ACCOUNT, showPortfolio);
      const account = accounts.get(label.key) ?? accounts.set(label.key, { label, holdings: new Map() }).get(label.key)!;
      const groupKey = getPortfolioAssetGroupKey(asset);
      const holding = account.holdings.get(groupKey) ?? { key: groupKey, name: asset.name, symbol: asset.symbol, valuePln: 0, profitPln: 0 };
      holding.valuePln += getAssetMarketValuePln(asset, fxRates);
      holding.profitPln += getAssetProfitLossPln(asset, fxRates);
      account.holdings.set(groupKey, holding);
    }
  }

  return [...accounts.values()]
    .map(({ label, holdings }) => {
      const list = [...holdings.values()].filter((holding) => holding.valuePln > 0);
      const valuePln = list.reduce((total, holding) => total + holding.valuePln, 0);
      return {
        key: label.key,
        label: label.label,
        detail: label.detail,
        valuePln: round(valuePln, 2),
        holdings: list
          .map((holding) => ({ ...holding, valuePln: round(holding.valuePln, 2), profitPln: round(holding.profitPln, 2), sharePercent: valuePln > 0 ? round((holding.valuePln / valuePln) * 100, 2) : 0 }))
          .sort((left, right) => right.valuePln - left.valuePln),
      };
    })
    .filter((account) => account.holdings.length > 0)
    .sort((left, right) => right.valuePln - left.valuePln);
};

// ---------------------------------------------------------------------------------------------
// Heat map

export type HeatmapCell = {
  key: string;
  name: string;
  symbol: string;
  valuePln: number;
  sharePercent: number;
  dailyChangePercent: number | null;
  profitPercent: number | null;
  profitPln: number;
};

/** One cell per holding (the same instrument in several portfolios is one cell), sized by value. */
export const buildHeatmapCells = (groups: PortfolioAssetGroup[]): HeatmapCell[] => {
  const cells = new Map<string, { name: string; symbol: string; valuePln: number; costPln: number; profitPln: number; dailyBase: number; dailyValue: number; hasDaily: boolean }>();
  for (const group of groups) {
    if (!(group.totalValuePln > 0) || !group.hasBaseValuation) continue;
    const cell = cells.get(group.key) ?? { name: group.name, symbol: group.symbol, valuePln: 0, costPln: 0, profitPln: 0, dailyBase: 0, dailyValue: 0, hasDaily: false };
    cell.valuePln += group.totalValuePln;
    cell.costPln += group.totalInvestedPln;
    cell.profitPln += group.totalProfitLossPln;
    if (group.hasDailyChange && typeof group.dailyChangePercent === "number" && Number.isFinite(group.dailyChangePercent)) {
      // Weighted by value, so two lots of one instrument in two portfolios give the same percent.
      cell.dailyBase += group.totalValuePln;
      cell.dailyValue += group.dailyChangePercent * group.totalValuePln;
      cell.hasDaily = true;
    }
    cells.set(group.key, cell);
  }
  const total = [...cells.values()].reduce((sum, cell) => sum + cell.valuePln, 0);
  return [...cells.entries()]
    .map(([key, cell]) => ({
      key,
      name: cell.name,
      symbol: cell.symbol,
      valuePln: round(cell.valuePln, 2),
      sharePercent: total > 0 ? round((cell.valuePln / total) * 100, 2) : 0,
      dailyChangePercent: cell.hasDaily && cell.dailyBase > 0 ? round(cell.dailyValue / cell.dailyBase, 2) : null,
      profitPercent: cell.costPln > 0 ? round((cell.profitPln / cell.costPln) * 100, 2) : null,
      profitPln: round(cell.profitPln, 2),
    }))
    .sort((left, right) => right.valuePln - left.valuePln);
};

// ---------------------------------------------------------------------------------------------
// Return of each period (the "volatility" bars)

export type PeriodGranularity = "day" | "week" | "month" | "year";
export type PeriodReturn = { key: string; label: string; dateFrom: string; dateTo: string; returnPercent: number; resultPln: number; isComplete: boolean };
export type PeriodReturnStats = { count: number; positive: number; negative: number; averagePercent: number; bestPercent: number; worstPercent: number; deviationPercent: number };

const MONTHS = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

const isoWeekStart = (date: string) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - day);
  return value.toISOString().slice(0, 10);
};

const shortDate = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

/**
 * The return of each day, week, month or year from the daily cash-flow-neutral series of the
 * portfolio history (deposits and withdrawals do not count as gains), the same series the
 * calendar tables on the results page use.
 */
export const buildPeriodReturns = (points: PortfolioHistoryPoint[], granularity: PeriodGranularity): PeriodReturn[] => {
  const daily = deriveDailyCashFlowNeutralReturns(points);
  if (granularity === "day") {
    return daily.map((item) => ({ key: item.endDate, label: shortDate(item.endDate), dateFrom: item.startDate, dateTo: item.endDate, returnPercent: round(item.returnDecimal * 100, 4), resultPln: round(item.resultPln, 2), isComplete: true }));
  }
  if (granularity === "month" || granularity === "year") {
    return buildCalendarReturns(daily, granularity).map((bucket) => ({
      key: bucket.key,
      label: bucket.month ? `${MONTHS[bucket.month - 1]} ${bucket.year}` : String(bucket.year),
      dateFrom: bucket.dateFrom,
      dateTo: bucket.dateTo,
      returnPercent: round(bucket.returnDecimal * 100, 4),
      resultPln: round(bucket.resultAmount, 2),
      isComplete: bucket.isComplete,
    }));
  }
  const weeks = new Map<string, typeof daily>();
  for (const item of daily) {
    const key = isoWeekStart(item.endDate);
    weeks.set(key, [...(weeks.get(key) ?? []), item]);
  }
  return [...weeks.entries()].map(([key, bucket]) => {
    const growth = bucket.reduce((total, item) => total * (1 + item.returnDecimal), 1);
    return {
      key,
      label: `tydz. od ${shortDate(key)}`,
      dateFrom: bucket[0]!.startDate,
      dateTo: bucket.at(-1)!.endDate,
      returnPercent: round((growth - 1) * 100, 4),
      resultPln: round(bucket.reduce((total, item) => total + item.resultPln, 0), 2),
      // From the close before Monday to Friday's close (or later).
      isComplete: bucket[0]!.startDate < key && bucket.at(-1)!.endDate >= addDaysIso(key, 4),
    };
  });
};

function addDaysIso(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export const summarizePeriodReturns = (periods: PeriodReturn[]): PeriodReturnStats | null => {
  if (periods.length === 0) return null;
  const values = periods.map((period) => period.returnPercent);
  const average = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((total, value) => total + (value - average) ** 2, 0) / (values.length - 1) : 0;
  return {
    count: values.length,
    positive: values.filter((value) => value > 0).length,
    negative: values.filter((value) => value < 0).length,
    averagePercent: round(average, 2),
    bestPercent: round(Math.max(...values), 2),
    worstPercent: round(Math.min(...values), 2),
    deviationPercent: round(Math.sqrt(variance), 2),
  };
};
