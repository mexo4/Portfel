import { formatCurrency } from "@/lib/utils";
import type { CurrencyCode } from "@/types/portfolio";

/** The confirmation shown after a purchase or a sale has been saved. */
export type TradeNotice = { id: number; side: "buy" | "sell"; title: string; detail: string };

export type TradeAction =
  | "buy" | "sell"
  | "open-cfd" | "open-short" | "close-position"
  | "buy-bond" | "sell-bond" | "redeem-bond" | "swap-bond";

const ACTIONS: Record<TradeAction, { side: TradeNotice["side"]; title: string }> = {
  buy: { side: "buy", title: "Kupiono" },
  sell: { side: "sell", title: "Sprzedano" },
  "open-cfd": { side: "buy", title: "Otwarto pozycję CFD" },
  "open-short": { side: "sell", title: "Otwarto krótką pozycję" },
  "close-position": { side: "sell", title: "Zamknięto pozycję" },
  "buy-bond": { side: "buy", title: "Kupiono obligacje" },
  "sell-bond": { side: "sell", title: "Sprzedano obligacje" },
  "redeem-bond": { side: "sell", title: "Wykupiono obligacje" },
  "swap-bond": { side: "buy", title: "Zamieniono obligacje" },
};

const quantityFormatter = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 8 });

export const describeTrade = (trade: {
  action: TradeAction;
  quantity: number;
  name: string;
  symbol: string;
  /** Price of one unit; left out when the trade has no single price, as in a bond swap. */
  price?: number;
  currency?: CurrencyCode;
  portfolioName: string;
}): Omit<TradeNotice, "id"> => {
  const { side, title } = ACTIONS[trade.action];
  const instrument = trade.name && trade.name !== trade.symbol ? `${trade.name} (${trade.symbol})` : trade.symbol;
  const price = typeof trade.price === "number" && trade.price > 0 ? ` po ${formatCurrency(trade.price, trade.currency ?? "PLN")}` : "";
  return { side, title, detail: `${quantityFormatter.format(trade.quantity)} × ${instrument}${price} · portfel „${trade.portfolioName}”` };
};
