import type { PortfolioAsset } from "@/types/portfolio";

/** A public quote that follows a broker's CFD closely enough to value and chart it. */
export type CfdQuoteSource = { yahooSymbol: string; label: string };

/*
 * Only sources that were compared with the broker's own prices belong here; a CFD's ticker alone
 * says nothing (XTB's "GOLD" is not the share Yahoo calls GOLD). Without a source a CFD keeps
 * the price from the last imported file.
 * US100: the NQ future stayed within 20 points (0.08%) of XTB's US100 prices.
 */
const CFD_QUOTE_SOURCES: Readonly<Record<string, CfdQuoteSource>> = {
  US100: { yahooSymbol: "NQ=F", label: "kontraktu NQ na Nasdaq 100" },
};

export const getCfdQuoteSource = ({ instrumentType, symbol }: { instrumentType?: string; symbol: string }): CfdQuoteSource | null => {
  const key = symbol.trim().toUpperCase();
  return instrumentType === "CFD" && Object.hasOwn(CFD_QUOTE_SOURCES, key) ? CFD_QUOTE_SOURCES[key]! : null;
};

/** The Polish unit of a held or traded quantity: a CFD's volume is in lots, as the broker names it. */
export const getQuantityUnit = (quantity: number, isCfd?: boolean) => {
  if (!isCfd) return "szt.";
  if (!Number.isInteger(quantity)) return "lota";
  if (quantity === 1) return "lot";
  const [last, lastTwo] = [quantity % 10, quantity % 100];
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? "loty" : "lotów";
};

/** The leverage behind a margin deposit. Brokers offer whole steps, and the margin is rounded to cents. */
export const getCfdLeverage = (notional: number, margin: number) => {
  if (!(notional > 0) || !(margin > 0)) return undefined;
  const exact = notional / margin;
  const whole = Math.round(exact);
  return whole >= 1 && Math.abs(exact - whole) / exact < 0.01 ? whole : Math.round(exact * 100) / 100;
};

/**
 * A closed CFD as the broker describes it. It adds no money: the result is booked once, from the
 * broker's "Close trade" cash row, which carries these details.
 */
export type ClosedCfdTrade = {
  positionId: string;
  ticker: string;
  name: string;
  side: "BUY" | "SELL";
  volume: number;
  openDate: string;
  openPrice: number;
  closeDate: string;
  closePrice: number;
  contractMultiplier: number;
  leverage?: number;
  /** The result before swaps, in the account currency: the amount of the cash row. */
  grossResult: number;
  currency: string;
};

export const readClosedCfdTrade = (value: unknown): ClosedCfdTrade | null => {
  if (!value || typeof value !== "object") return null;
  const trade = value as Partial<ClosedCfdTrade>;
  const positive = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number > 0;
  return typeof trade.positionId === "string" && typeof trade.ticker === "string" && typeof trade.openDate === "string" &&
    typeof trade.closeDate === "string" && typeof trade.currency === "string" && (trade.side === "BUY" || trade.side === "SELL") &&
    positive(trade.volume) && positive(trade.openPrice) && positive(trade.closePrice) && positive(trade.contractMultiplier) &&
    typeof trade.grossResult === "number" && Number.isFinite(trade.grossResult)
    ? (trade as ClosedCfdTrade)
    : null;
};

export type CfdFigures = {
  /** Contract value now: quote × volume × contract size, in the instrument's currency. */
  exposure: number | null;
  /** How far the price has moved in the position's favour, in percent of the opening price. */
  priceMovePercent: number | null;
  /** The leverage, when every lot has the same one. */
  leverage: number | null;
  /** Margin deposit of the open lots in the instrument's currency, when every lot has a leverage. */
  margin: number | null;
  /** Result in percent of the margin, as brokers show it. */
  returnOnMarginPercent: number | null;
};

export const getCfdFigures = (lots: PortfolioAsset[]): CfdFigures => {
  let openValue = 0;
  let currentValue = 0;
  let result = 0;
  let margin = 0;
  let priced = lots.length > 0;
  let leveraged = lots.length > 0;
  const leverages = new Set<number>();
  for (const lot of lots) {
    const size = lot.quantity * (lot.contractMultiplier && lot.contractMultiplier > 0 ? lot.contractMultiplier : 1);
    const opened = lot.purchasePrice * size;
    openValue += opened;
    if (lot.latestPrice && lot.latestPrice > 0) {
      currentValue += lot.latestPrice * size;
      result += (lot.latestPrice - lot.purchasePrice) * size * (lot.positionDirection === "SHORT" ? -1 : 1);
    } else {
      priced = false;
    }
    if (lot.leverage && lot.leverage > 0) {
      leverages.add(lot.leverage);
      margin += opened / lot.leverage;
    } else {
      leveraged = false;
    }
  }
  return {
    exposure: priced ? currentValue : null,
    priceMovePercent: priced && openValue > 0 ? (result / openValue) * 100 : null,
    leverage: leveraged && leverages.size === 1 ? [...leverages][0]! : null,
    margin: leveraged ? margin : null,
    returnOnMarginPercent: priced && leveraged && margin > 0 ? (result / margin) * 100 : null,
  };
};
