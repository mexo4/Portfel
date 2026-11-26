import { getPortfolioAssetGroupKey } from "@/lib/ticker";
import { round } from "@/lib/utils";
import type { AssetKind, CurrencyCode, InvestmentPortfolio, PortfolioSale, QuoteProvider } from "@/types/portfolio";

/**
 * The instrument chart: the price of one holding with every purchase and sale on it, the average
 * purchase price of what was held at each moment and the highest and lowest price in view.
 *
 * Purchases come from the lots: a lot that is still open, plus the part of it already sold, or a
 * lot sold in full, known only from the sale allocations. The average purchase price follows the
 * first-in first-out allocations stored with each sale, so it changes exactly as the cost of the
 * remaining position did.
 */

export type ChartInstrument = {
  key: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
  quantity: number;
  isOpen: boolean;
  portfolioNames: string[];
  firstTradeDate: string;
};

export type InstrumentTrade = {
  id: string;
  side: "buy" | "sell";
  date: string;
  quantity: number;
  price: number;
  currency: CurrencyCode;
  /** price × quantity (× contract multiplier) in the price currency. */
  amount: number;
  portfolioName: string;
};

export type AveragePriceStep = { date: string; averagePrice: number | null };

export type InstrumentTimeline = {
  instrument: ChartInstrument;
  /** Trades priced in the instrument's quote currency, drawn on the chart, oldest first. */
  trades: InstrumentTrade[];
  /** Trades priced in another currency than the quote, left off the chart. */
  skippedTrades: number;
  averagePriceSteps: AveragePriceStep[];
};

/**
 * The instrument key of a holding group. In the all-portfolios view a group key is
 * `portfolioId:groupKey`, so the same instrument in two portfolios has two group keys.
 */
export const instrumentKeyOf = (group: { key: string; portfolioId?: string }) =>
  group.portfolioId && group.key.startsWith(`${group.portfolioId}:`) ? group.key.slice(group.portfolioId.length + 1) : group.key;

const saleKey = (sale: PortfolioSale) => sale.assetKey || getPortfolioAssetGroupKey(sale);

/** Holdings that have a market price (bonds have none), open ones first, then by name. */
export const listChartInstruments = (portfolios: InvestmentPortfolio[]): ChartInstrument[] => {
  const instruments = new Map<string, ChartInstrument>();
  const touch = (key: string, base: Omit<ChartInstrument, "quantity" | "isOpen" | "portfolioNames" | "firstTradeDate">, portfolioName: string, date: string) => {
    const current = instruments.get(key) ?? { ...base, quantity: 0, isOpen: false, portfolioNames: [], firstTradeDate: date };
    if (!current.portfolioNames.includes(portfolioName)) current.portfolioNames.push(portfolioName);
    if (date && date < current.firstTradeDate) current.firstTradeDate = date;
    instruments.set(key, current);
    return current;
  };

  for (const portfolio of portfolios) {
    for (const asset of portfolio.assets ?? []) {
      if (asset.kind === "bond") continue;
      const instrument = touch(getPortfolioAssetGroupKey(asset), {
        key: getPortfolioAssetGroupKey(asset),
        name: asset.name,
        symbol: asset.symbol,
        kind: asset.kind,
        marketCurrency: asset.marketCurrency,
        provider: asset.provider,
        ...(asset.providerId ? { providerId: asset.providerId } : {}),
        ...(asset.priceScale ? { priceScale: asset.priceScale } : {}),
      }, portfolio.name, asset.purchaseDate);
      instrument.quantity = round(instrument.quantity + asset.quantity, 8);
      instrument.isOpen = instrument.quantity > 0;
    }
    for (const sale of portfolio.sales ?? []) {
      if (sale.kind === "bond" || sale.transactionKind === "bond-redemption" || sale.transactionKind === "bond-swap") continue;
      const firstBuy = (sale.allocations ?? []).map((allocation) => allocation.purchaseDate).filter(Boolean).sort()[0] ?? sale.saleDate;
      touch(saleKey(sale), {
        key: saleKey(sale),
        name: sale.name,
        symbol: sale.symbol,
        kind: sale.kind,
        marketCurrency: sale.marketCurrency,
        provider: sale.provider,
        ...(sale.providerId ? { providerId: sale.providerId } : {}),
        ...(sale.priceScale ? { priceScale: sale.priceScale } : {}),
      }, portfolio.name, firstBuy);
    }
  }

  return [...instruments.values()].sort((left, right) => Number(right.isOpen) - Number(left.isOpen) || left.name.localeCompare(right.name, "pl"));
};

type LotState = { id: string; date: string; quantity: number; price: number; currency: CurrencyCode; multiplier: number; portfolioName: string };

export const buildInstrumentTimeline = (portfolios: InvestmentPortfolio[], instrument: ChartInstrument): InstrumentTimeline => {
  // Lots by `portfolioId|lotId`: open lots with the part already sold added back, and lots sold in
  // full, known only from the allocations of their sales.
  const lots = new Map<string, LotState>();
  const sales: Array<{ sale: PortfolioSale; portfolioId: string; portfolioName: string }> = [];

  for (const portfolio of portfolios) {
    const portfolioSales = (portfolio.sales ?? []).filter((sale) => saleKey(sale) === instrument.key);
    const soldByLot = new Map<string, number>();
    for (const sale of portfolioSales) {
      sales.push({ sale, portfolioId: portfolio.id, portfolioName: portfolio.name });
      for (const allocation of sale.allocations ?? []) soldByLot.set(allocation.lotId, (soldByLot.get(allocation.lotId) ?? 0) + allocation.quantity);
    }
    const openLotIds = new Set<string>();
    for (const asset of portfolio.assets ?? []) {
      if (getPortfolioAssetGroupKey(asset) !== instrument.key) continue;
      openLotIds.add(asset.id);
      lots.set(`${portfolio.id}|${asset.id}`, {
        id: `${portfolio.id}|${asset.id}`,
        date: asset.purchaseDate,
        quantity: round(asset.quantity + (soldByLot.get(asset.id) ?? 0), 8),
        price: asset.purchasePrice,
        currency: asset.purchasePriceCurrency ?? asset.purchaseCurrency,
        multiplier: asset.contractMultiplier && asset.contractMultiplier > 0 ? asset.contractMultiplier : 1,
        portfolioName: portfolio.name,
      });
    }
    for (const sale of portfolioSales) {
      for (const allocation of sale.allocations ?? []) {
        if (openLotIds.has(allocation.lotId)) continue;
        const id = `${portfolio.id}|${allocation.lotId}`;
        const existing = lots.get(id);
        if (existing) {
          existing.quantity = round(existing.quantity + allocation.quantity, 8);
          continue;
        }
        lots.set(id, {
          id,
          date: allocation.purchaseDate,
          quantity: allocation.quantity,
          price: allocation.purchasePrice,
          currency: allocation.purchasePriceCurrency ?? allocation.purchaseCurrency,
          multiplier: allocation.contractMultiplier && allocation.contractMultiplier > 0 ? allocation.contractMultiplier : 1,
          portfolioName: portfolio.name,
        });
      }
    }
  }

  const trades: InstrumentTrade[] = [];
  let skippedTrades = 0;
  for (const lot of lots.values()) {
    if (lot.currency !== instrument.marketCurrency) { skippedTrades += 1; continue; }
    trades.push({ id: `buy:${lot.id}`, side: "buy", date: lot.date, quantity: lot.quantity, price: lot.price, currency: lot.currency, amount: round(lot.price * lot.quantity * lot.multiplier, 2), portfolioName: lot.portfolioName });
  }
  for (const { sale, portfolioName } of sales) {
    if (sale.marketCurrency !== instrument.marketCurrency) { skippedTrades += 1; continue; }
    const multiplier = sale.contractMultiplier && sale.contractMultiplier > 0 ? sale.contractMultiplier : 1;
    trades.push({ id: `sell:${sale.id}`, side: "sell", date: sale.saleDate, quantity: sale.quantity, price: sale.salePrice, currency: sale.marketCurrency, amount: round(sale.salePrice * sale.quantity * multiplier, 2), portfolioName });
  }
  // Buys before sells on the same day, as a same-day sale can only close what was bought.
  trades.sort((left, right) => left.date.localeCompare(right.date) || (left.side === right.side ? 0 : left.side === "buy" ? -1 : 1));

  // The average purchase price of what is held, after every buy and sale.
  const remaining = new Map<string, number>();
  const average = () => {
    let quantity = 0;
    let cost = 0;
    for (const [id, left] of remaining) {
      const lot = lots.get(id)!;
      if (left <= 1e-9 || lot.currency !== instrument.marketCurrency) continue;
      quantity += left;
      cost += left * lot.price;
    }
    return quantity > 1e-9 ? round(cost / quantity, 6) : null;
  };
  const events = [
    ...[...lots.values()].map((lot) => ({ date: lot.date, order: 0, apply: () => remaining.set(lot.id, lot.quantity) })),
    ...sales.map(({ sale, portfolioId }) => ({
      date: sale.saleDate,
      order: 1,
      apply: () => {
        for (const allocation of sale.allocations ?? []) {
          const id = `${portfolioId}|${allocation.lotId}`;
          if (lots.has(id)) remaining.set(id, round((remaining.get(id) ?? lots.get(id)!.quantity) - allocation.quantity, 8));
        }
      },
    })),
  ].sort((left, right) => left.date.localeCompare(right.date) || left.order - right.order);
  const steps: AveragePriceStep[] = [];
  for (const event of events) {
    event.apply();
    const value = average();
    if (steps.at(-1)?.date === event.date) steps[steps.length - 1] = { date: event.date, averagePrice: value };
    else steps.push({ date: event.date, averagePrice: value });
  }

  return { instrument, trades, skippedTrades, averagePriceSteps: steps };
};

/** The average purchase price in force on a date (null before the first buy and after selling all). */
export const averagePriceOn = (steps: AveragePriceStep[], date: string) => {
  let value: number | null = null;
  for (const step of steps) {
    if (step.date > date) break;
    value = step.averagePrice;
  }
  return value;
};

export type PricePoint = { date: string; close: number };

/** Highest and lowest close in a range, with their dates. */
export const priceExtremes = (points: PricePoint[]) => {
  if (points.length === 0) return null;
  let max = points[0]!;
  let min = points[0]!;
  for (const point of points) {
    if (point.close > max.close) max = point;
    if (point.close < min.close) min = point;
  }
  return { max, min, last: points.at(-1)! };
};

/**
 * Several instruments on one scale: each line is the change in percent since the first date on
 * which every selected instrument has a price, so they start together at 0%.
 */
export const buildComparisonRows = (series: Array<{ key: string; points: PricePoint[] }>, startDate: string) => {
  const usable = series.filter((item) => item.points.some((point) => point.date >= startDate));
  if (usable.length === 0) return { rows: [] as Array<Record<string, number | string | null>>, baseDate: null as string | null };
  const firstDates = usable.map((item) => item.points.find((point) => point.date >= startDate)!.date);
  const baseDate = firstDates.sort().at(-1)!;
  const bases = new Map<string, number>();
  for (const item of usable) {
    // The close on the base date or the last one before it.
    const base = [...item.points].reverse().find((point) => point.date <= baseDate) ?? item.points.find((point) => point.date >= baseDate);
    if (base && base.close > 0) bases.set(item.key, base.close);
  }
  const dates = Array.from(new Set(usable.flatMap((item) => item.points.filter((point) => point.date >= baseDate).map((point) => point.date)))).sort();
  const cursors = new Map(usable.map((item) => [item.key, { index: 0, last: null as number | null }]));
  const rows = dates.map((date) => {
    const row: Record<string, number | string | null> = { date };
    for (const item of usable) {
      const cursor = cursors.get(item.key)!;
      while (cursor.index < item.points.length && item.points[cursor.index]!.date <= date) {
        cursor.last = item.points[cursor.index]!.close;
        cursor.index += 1;
      }
      const base = bases.get(item.key);
      row[item.key] = base && cursor.last !== null ? round((cursor.last / base - 1) * 100, 2) : null;
    }
    return row;
  });
  return { rows, baseDate };
};
