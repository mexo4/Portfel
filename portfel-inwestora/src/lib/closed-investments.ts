import { readClosedCfdTrade } from "@/lib/cfd";
import type { AssetKind, CurrencyCode, InstrumentType, InvestmentPortfolio, PortfolioSale } from "@/types/portfolio";
import { round } from "@/lib/utils";

/**
 * Closed investments: every sale (and bond redemption or swap) with the lots it closed, in the
 * first-in first-out order in which the sale consumed them, and a summary per instrument.
 *
 * The amounts are the ones Mexo stored when the sale was recorded (realized invested, proceeds
 * and result in PLN), so this report always agrees with the results page. The tax report
 * recalculates the same sales with official NBP rates; see `tax-pit38.ts`.
 */

export type ClosedInvestmentLot = {
  lotId: string;
  purchaseDate: string;
  quantity: number;
  purchasePrice: number;
  priceCurrency: CurrencyCode;
  investedPln: number;
  buyFeePln: number;
  holdingDays: number;
};

export type ClosedInvestmentTrade = {
  id: string;
  portfolioId: string;
  portfolioName: string;
  instrumentKey: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  instrumentType?: InstrumentType;
  direction: "LONG" | "SHORT";
  transactionKind: PortfolioSale["transactionKind"];
  saleDate: string;
  quantity: number;
  salePrice: number;
  saleCurrency: CurrencyCode;
  saleFeePln: number;
  investedPln: number;
  proceedsPln: number;
  profitLossPln: number;
  /** null when nothing was invested (e.g. a bonus share), so a percentage would be meaningless. */
  returnPercent: number | null;
  /** Average holding period of the closed units, weighted by quantity. */
  holdingDays: number;
  lots: ClosedInvestmentLot[];
  /** A CFD from the broker's file: its cost is the margin deposit, and null leverage means no deposit is known. */
  cfd?: { leverage: number | null };
};

export type ClosedInvestmentSummaryRow = {
  instrumentKey: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  trades: number;
  quantity: number;
  investedPln: number;
  proceedsPln: number;
  profitLossPln: number;
  returnPercent: number | null;
  winningTrades: number;
  losingTrades: number;
  firstSaleDate: string;
  lastSaleDate: string;
};

export type ClosedInvestmentTotals = {
  trades: number;
  investedPln: number;
  proceedsPln: number;
  profitLossPln: number;
  returnPercent: number | null;
  winningTrades: number;
  losingTrades: number;
  /** Share of closes with a positive result, 0-100; null without closes. */
  winRatePercent: number | null;
  grossProfitPln: number;
  grossLossPln: number;
  /** Gross profit divided by gross loss; null when there is no loss to divide by. */
  profitFactor: number | null;
  averageHoldingDays: number | null;
};

export type ClosedInvestmentsReport = {
  trades: ClosedInvestmentTrade[];
  summary: ClosedInvestmentSummaryRow[];
  totals: ClosedInvestmentTotals;
  years: number[];
};

const DAY_MS = 24 * 60 * 60 * 1_000;

export const daysBetween = (from: string, to: string) => {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / DAY_MS));
};

const percentOf = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100, 2) : null);

/** Groups the same instrument held in different portfolios under one summary row. */
const instrumentGroupKey = (sale: PortfolioSale) =>
  `${sale.kind}:${(sale.isin || sale.symbol || sale.name).trim().toUpperCase()}`;

const toTrade = (portfolio: InvestmentPortfolio, sale: PortfolioSale): ClosedInvestmentTrade => {
  const lots = (sale.allocations ?? []).map((allocation) => ({
    lotId: allocation.lotId,
    purchaseDate: allocation.purchaseDate,
    quantity: allocation.quantity,
    purchasePrice: allocation.purchasePrice,
    priceCurrency: allocation.purchasePriceCurrency ?? allocation.purchaseCurrency ?? sale.marketCurrency,
    investedPln: round(allocation.investedPln),
    buyFeePln: round(allocation.allocatedBuyFeePln ?? 0),
    holdingDays: daysBetween(allocation.purchaseDate, sale.saleDate),
  }));
  const lotQuantity = lots.reduce((total, lot) => total + lot.quantity, 0);
  const holdingDays =
    lotQuantity > 0
      ? Math.round(lots.reduce((total, lot) => total + lot.holdingDays * lot.quantity, 0) / lotQuantity)
      : 0;
  const investedPln = round(sale.realizedInvestedPln);
  const profitLossPln = round(sale.realizedProfitLossPln);

  return {
    id: sale.id,
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    instrumentKey: instrumentGroupKey(sale),
    name: sale.name,
    symbol: sale.symbol,
    kind: sale.kind,
    instrumentType: sale.instrumentType,
    direction: sale.positionDirection === "SHORT" ? "SHORT" : "LONG",
    transactionKind: sale.transactionKind,
    saleDate: sale.saleDate,
    quantity: sale.quantity,
    salePrice: sale.salePrice,
    saleCurrency: sale.marketCurrency,
    saleFeePln: round(sale.feePln ?? 0),
    investedPln,
    proceedsPln: round(sale.realizedProceedsPln),
    profitLossPln,
    returnPercent: percentOf(profitLossPln, investedPln),
    holdingDays,
    lots,
  };
};

/*
 * Closed CFDs imported from a broker are not sales: their money is the "Close trade" cash row and
 * the result booked from it. The row carries the details, and the amount shown here is the booked
 * one, so this list and the results always agree.
 */
export const listImportedCfdCloses = (portfolio: InvestmentPortfolio) => {
  const results = new Map((portfolio.realizedAdjustments ?? []).flatMap((adjustment) =>
    adjustment.importKey ? [[adjustment.importKey, adjustment] as const] : []));
  return (portfolio.operations ?? []).flatMap((operation) => {
    const trade = readClosedCfdTrade(operation.metadata.cfdTrade);
    const adjustment = typeof operation.metadata.importKey === "string" ? results.get(`${operation.metadata.importKey}:result`) : undefined;
    return trade && adjustment ? [{ operation, trade, adjustment }] : [];
  });
};

const toCfdTrade = (portfolio: InvestmentPortfolio, { operation, trade, adjustment }: ReturnType<typeof listImportedCfdCloses>[number]): ClosedInvestmentTrade => {
  const profitLossPln = round(adjustment.amountPlnSnapshot);
  // The rate the result was booked at also converts the deposit.
  const rate = adjustment.amount !== 0 ? adjustment.amountPlnSnapshot / adjustment.amount : 0;
  const margin = trade.leverage ? (trade.openPrice * trade.volume * trade.contractMultiplier) / trade.leverage : 0;
  const investedPln = rate > 0 ? round(margin * rate) : 0;
  const holdingDays = daysBetween(trade.openDate, trade.closeDate);
  return {
    id: operation.id,
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    instrumentKey: `cfd:${trade.ticker.trim().toUpperCase()}`,
    name: trade.name,
    symbol: trade.ticker,
    kind: "stock",
    instrumentType: "CFD",
    direction: trade.side === "SELL" ? "SHORT" : "LONG",
    transactionKind: "sale",
    saleDate: trade.closeDate,
    quantity: trade.volume,
    salePrice: trade.closePrice,
    saleCurrency: trade.currency,
    saleFeePln: 0,
    investedPln,
    proceedsPln: round(investedPln + profitLossPln),
    profitLossPln,
    returnPercent: percentOf(profitLossPln, investedPln),
    holdingDays,
    lots: [{ lotId: `cfd:${trade.positionId}`, purchaseDate: trade.openDate, quantity: trade.volume, purchasePrice: trade.openPrice, priceCurrency: trade.currency, investedPln, buyFeePln: 0, holdingDays }],
    cfd: { leverage: trade.leverage ?? null },
  };
};

export const buildClosedInvestments = (
  portfolios: InvestmentPortfolio[],
  options: { year?: number | null } = {}
): ClosedInvestmentsReport => {
  const allTrades = portfolios
    .flatMap((portfolio) => [
      ...(portfolio.sales ?? []).map((sale) => toTrade(portfolio, sale)),
      ...listImportedCfdCloses(portfolio).map((close) => toCfdTrade(portfolio, close)),
    ])
    .sort((left, right) => right.saleDate.localeCompare(left.saleDate) || left.name.localeCompare(right.name, "pl"));
  const years = [...new Set(allTrades.map((trade) => Number(trade.saleDate.slice(0, 4))).filter(Number.isFinite))].sort(
    (left, right) => right - left
  );
  const trades = options.year ? allTrades.filter((trade) => trade.saleDate.startsWith(`${options.year}-`)) : allTrades;

  const groups = new Map<string, ClosedInvestmentTrade[]>();
  for (const trade of trades) groups.set(trade.instrumentKey, [...(groups.get(trade.instrumentKey) ?? []), trade]);

  const summary: ClosedInvestmentSummaryRow[] = [...groups.entries()]
    .map(([instrumentKey, group]) => {
      const newest = group[0];
      const investedPln = round(group.reduce((total, trade) => total + trade.investedPln, 0));
      const profitLossPln = round(group.reduce((total, trade) => total + trade.profitLossPln, 0));
      const dates = group.map((trade) => trade.saleDate).sort();

      return {
        instrumentKey,
        name: newest.name,
        symbol: newest.symbol,
        kind: newest.kind,
        trades: group.length,
        quantity: round(group.reduce((total, trade) => total + trade.quantity, 0), 6),
        investedPln,
        proceedsPln: round(group.reduce((total, trade) => total + trade.proceedsPln, 0)),
        profitLossPln,
        returnPercent: percentOf(profitLossPln, investedPln),
        winningTrades: group.filter((trade) => trade.profitLossPln > 0).length,
        losingTrades: group.filter((trade) => trade.profitLossPln < 0).length,
        firstSaleDate: dates[0],
        lastSaleDate: dates[dates.length - 1],
      };
    })
    .sort((left, right) => right.profitLossPln - left.profitLossPln || left.name.localeCompare(right.name, "pl"));

  const investedPln = round(trades.reduce((total, trade) => total + trade.investedPln, 0));
  const profitLossPln = round(trades.reduce((total, trade) => total + trade.profitLossPln, 0));
  const grossProfitPln = round(trades.filter((trade) => trade.profitLossPln > 0).reduce((total, trade) => total + trade.profitLossPln, 0));
  const grossLossPln = round(-trades.filter((trade) => trade.profitLossPln < 0).reduce((total, trade) => total + trade.profitLossPln, 0));
  const winningTrades = trades.filter((trade) => trade.profitLossPln > 0).length;
  const closedQuantityDays = trades.reduce((total, trade) => total + trade.holdingDays * trade.quantity, 0);
  const closedQuantity = trades.reduce((total, trade) => total + trade.quantity, 0);

  return {
    trades,
    summary,
    years,
    totals: {
      trades: trades.length,
      investedPln,
      proceedsPln: round(trades.reduce((total, trade) => total + trade.proceedsPln, 0)),
      profitLossPln,
      returnPercent: percentOf(profitLossPln, investedPln),
      winningTrades,
      losingTrades: trades.filter((trade) => trade.profitLossPln < 0).length,
      winRatePercent: trades.length > 0 ? round((winningTrades / trades.length) * 100, 1) : null,
      grossProfitPln,
      grossLossPln,
      profitFactor: grossLossPln > 0 ? round(grossProfitPln / grossLossPln, 2) : null,
      averageHoldingDays: closedQuantity > 0 ? Math.round(closedQuantityDays / closedQuantity) : null,
    },
  };
};
