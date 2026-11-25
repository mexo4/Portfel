import { getPortfolioDividends } from "@/lib/dividend-engine";
import {
  getAssetMarketValuePln,
  getAssetProfitLossPln,
  getAssetPurchaseFxRateToPln,
  getAssetPurchasePriceCurrency,
  getAssetPurchaseValuePln,
  hasAssetBaseCurrencyValuation,
} from "@/lib/portfolio-engine";
import { convertToPln } from "@/lib/pricing";
import { round } from "@/lib/utils";
import type { FxRates, InvestmentPortfolio, PortfolioOperation, PortfolioSale } from "@/types/portfolio";

/**
 * Where the result comes from: the nominal result split into price moves, currency moves and
 * commissions, plus what the nominal result leaves out (dividends, interest, fees and taxes
 * charged on the cash account). All amounts are in PLN since the portfolio was opened.
 *
 * When the flows-based result of the portfolio history is known (value now minus net external
 * capital), the part no listed source explains is shown as one remainder line: mostly exchange
 * rate moves on cash held in a foreign currency, and amounts recorded at a different rate.
 */

export type ProfitSourceKey =
  | "open-price"
  | "open-fx"
  | "open-fees"
  | "realized-price"
  | "realized-fx"
  | "realized-fees"
  | "bonds"
  | "manual-results"
  | "dividends"
  | "interest"
  | "dividend-tax"
  | "cash-fees"
  | "taxes"
  | "cash-corrections"
  | "remainder";

export type ProfitSource = { key: ProfitSourceKey; label: string; description: string; amountPln: number };

export type ProfitBreakdown = {
  sources: ProfitSource[];
  /** Sum of the position sources: the same figure as the nominal result in the summary. */
  nominalPln: number;
  /** Everything listed, before the remainder. */
  explainedPln: number;
  flowsProfitLossPln: number | null;
};

const SOURCE_TEXT: Record<ProfitSourceKey, { label: string; description: string }> = {
  "open-price": { label: "Zmiana cen otwartych pozycji", description: "Różnica między ceną bieżącą a ceną zakupu, po kursie waluty z dnia zakupu." },
  "open-fx": { label: "Kursy walut na otwartych pozycjach", description: "Zmiana kursu waluty notowania od zakupu do dziś." },
  "open-fees": { label: "Prowizje od zakupu otwartych pozycji", description: "Koszt zakupu zapisany przy lotach, które nadal masz." },
  "realized-price": { label: "Zmiana cen sprzedanych pozycji", description: "Różnica między ceną sprzedaży a ceną zakupu sprzedanych lotów." },
  "realized-fx": { label: "Kursy walut na sprzedanych pozycjach", description: "Zmiana kursu waluty między zakupem a sprzedażą." },
  "realized-fees": { label: "Prowizje od sprzedanych pozycji", description: "Prowizje od zakupu i sprzedaży zamkniętych lotów." },
  bonds: { label: "Obligacje skarbowe", description: "Wynik brutto wykupów i zamian oraz kupony obligacji." },
  "manual-results": { label: "Wyniki dopisane ręcznie lub z importu", description: "Historyczne wyniki bez szczegółów zakupu." },
  dividends: { label: "Dywidendy brutto", description: "Wypłaty dywidend przed podatkiem." },
  interest: { label: "Odsetki", description: "Odsetki od gotówki zapisane na rachunku." },
  "dividend-tax": { label: "Podatek od dywidend", description: "Podatek pobrany u źródła i w Polsce." },
  "cash-fees": { label: "Opłaty z rachunku", description: "Opłaty zapisane jako osobne operacje, bez prowizji przypisanych do transakcji." },
  taxes: { label: "Podatki z rachunku", description: "Podatki zapisane jako osobne operacje i podatek od wykupu obligacji." },
  "cash-corrections": { label: "Korekty gotówki", description: "Ręczne korekty salda." },
  remainder: { label: "Pozostałe różnice", description: "Część wyniku portfela, której nie wyjaśniają źródła powyżej: zwykle zmiana kursów gotówki w walutach, kwoty zapisane po innym kursie oraz pozycje dodane bez historii gotówki." },
};

const source = (key: ProfitSourceKey, amountPln: number): ProfitSource => ({ key, ...SOURCE_TEXT[key], amountPln: round(amountPln, 2) });

/** An operation amount in PLN: the stored PLN snapshot, the rate saved with it, or today's rate. */
const operationAmountPln = (operation: PortfolioOperation, amount: number, fxRates: FxRates) => {
  const snapshot = operation.metadata.amountPlnSnapshot;
  if (typeof snapshot === "number" && Number.isFinite(snapshot) && snapshot > 0 && Math.abs(amount) === Math.abs(operation.amount)) {
    return Math.sign(amount || 1) * snapshot;
  }
  if (operation.currency === "PLN") return amount;
  if (operation.exchangeRate && operation.exchangeRate > 0 && Math.abs(operation.exchangeRate - 1) > 0.0005) return amount * operation.exchangeRate;
  return convertToPln(amount, operation.currency, fxRates);
};

const isCashSettled = (item: { instrumentType?: string; positionDirection?: string }) =>
  item.instrumentType === "CFD" || item.positionDirection === "SHORT";

const splitSale = (sale: PortfolioSale) => {
  const multiplier = sale.contractMultiplier && sale.contractMultiplier > 0 ? sale.contractMultiplier : 1;
  const fees = (sale.feePln ?? 0) + (sale.allocations ?? []).reduce((total, allocation) => total + (allocation.allocatedBuyFeePln ?? 0), 0);
  const total = sale.realizedProfitLossPln;
  const sameCurrency = (sale.allocations ?? []).every((allocation) => (allocation.purchasePriceCurrency ?? allocation.purchaseCurrency) === sale.marketCurrency);
  const sellValue = sale.salePrice * sale.quantity * multiplier;

  if (isCashSettled(sale) || !sameCurrency || sellValue <= 0 || (sale.allocations ?? []).length === 0) {
    return { price: total + fees, fx: 0, fees: -fees };
  }
  const price = (sale.allocations ?? []).reduce((sum, allocation) => {
    const lotCost = allocation.investedPln - (allocation.allocatedBuyFeePln ?? 0);
    const lotValueInCurrency = allocation.purchasePrice * allocation.quantity * (allocation.contractMultiplier ?? multiplier);
    const buyRate = allocation.purchaseFxRateToPln && allocation.purchaseFxRateToPln > 0
      ? allocation.purchaseFxRateToPln
      : lotValueInCurrency > 0 ? lotCost / lotValueInCurrency : 0;
    return sum + (sale.salePrice - allocation.purchasePrice) * allocation.quantity * (allocation.contractMultiplier ?? multiplier) * buyRate;
  }, 0);
  return { price, fx: total + fees - price, fees: -fees };
};

export const buildProfitBreakdown = ({
  portfolios,
  fxRates,
  flowsProfitLossPln = null,
}: {
  portfolios: InvestmentPortfolio[];
  fxRates: FxRates;
  flowsProfitLossPln?: number | null;
}): ProfitBreakdown => {
  const sums: Record<ProfitSourceKey, number> = {
    "open-price": 0, "open-fx": 0, "open-fees": 0, "realized-price": 0, "realized-fx": 0, "realized-fees": 0,
    bonds: 0, "manual-results": 0, dividends: 0, interest: 0, "dividend-tax": 0, "cash-fees": 0, taxes: 0, "cash-corrections": 0, remainder: 0,
  };

  for (const portfolio of portfolios) {
    // Open positions: the same total as the nominal open result, split by cause.
    for (const asset of portfolio.assets ?? []) {
      if (!hasAssetBaseCurrencyValuation(asset, fxRates)) continue;
      const total = getAssetProfitLossPln(asset, fxRates);
      const fees = asset.feePln ?? 0;
      if (isCashSettled(asset) || getAssetPurchasePriceCurrency(asset) !== asset.marketCurrency) {
        sums["open-price"] += total + fees;
      } else {
        const multiplier = asset.contractMultiplier && asset.contractMultiplier > 0 ? asset.contractMultiplier : 1;
        const price = ((asset.latestPrice ?? 0) - asset.purchasePrice) * asset.quantity * multiplier * getAssetPurchaseFxRateToPln(asset, fxRates);
        sums["open-price"] += price;
        sums["open-fx"] += getAssetMarketValuePln(asset, fxRates) - getAssetPurchaseValuePln(asset, fxRates) - price;
      }
      sums["open-fees"] -= fees;
    }

    for (const sale of portfolio.sales ?? []) {
      if (sale.transactionKind === "bond-redemption" || sale.transactionKind === "bond-swap") {
        sums.bonds += sale.grossProfitLossPln ?? sale.realizedProfitLossPln;
        sums.taxes -= sale.taxTotalPln ?? 0;
        continue;
      }
      const split = splitSale(sale);
      sums["realized-price"] += split.price;
      sums["realized-fx"] += split.fx;
      sums["realized-fees"] += split.fees;
    }

    for (const adjustment of portfolio.realizedAdjustments ?? []) {
      // Coupons are part of the realized result in the summary, so they stay with the bonds.
      if (adjustment.source === "bond-coupon") sums.bonds += adjustment.amountPlnSnapshot;
      else sums["manual-results"] += adjustment.amountPlnSnapshot;
    }

    for (const dividend of getPortfolioDividends(portfolio, fxRates)) {
      sums.dividends += dividend.grossAmountPln;
      sums["dividend-tax"] -= Math.max(0, dividend.grossAmountPln - dividend.netAmountPln);
    }

    for (const operation of portfolio.operations ?? []) {
      if (operation.metadata.cashImpact === false) continue;
      const amount = Math.abs(operation.amount);
      switch (operation.operationType) {
        case "INTEREST":
        case "COUPON":
          sums.interest += operationAmountPln(operation, amount, fxRates);
          break;
        case "FEE":
          // A commission imported next to a trade is already part of that trade's cost.
          if (!operation.metadata.linkedFeeImportKey && !operation.metadata.lotId && !operation.metadata.saleId) {
            sums["cash-fees"] -= operationAmountPln(operation, Math.max(amount, Math.abs(operation.fee)), fxRates);
          }
          break;
        case "TAX":
          sums.taxes -= operationAmountPln(operation, Math.max(amount, Math.abs(operation.tax)), fxRates);
          break;
        case "CUSTOM":
          if (operation.metadata.kind === "cash") sums["cash-corrections"] += operationAmountPln(operation, operation.amount, fxRates);
          break;
        default:
          break;
      }
    }
  }

  const positionKeys: ProfitSourceKey[] = ["open-price", "open-fx", "open-fees", "realized-price", "realized-fx", "realized-fees", "bonds", "manual-results"];
  const otherKeys: ProfitSourceKey[] = ["dividends", "interest", "dividend-tax", "cash-fees", "taxes", "cash-corrections"];
  const nominalPln = round(positionKeys.reduce((total, key) => total + sums[key], 0), 2);
  const explainedPln = round(nominalPln + otherKeys.reduce((total, key) => total + sums[key], 0), 2);
  const sources = [...positionKeys, ...otherKeys]
    .filter((key) => Math.abs(sums[key]) >= 0.005)
    .map((key) => source(key, sums[key]));

  if (typeof flowsProfitLossPln === "number" && Number.isFinite(flowsProfitLossPln)) {
    const remainder = round(flowsProfitLossPln - explainedPln, 2);
    if (Math.abs(remainder) >= 0.005) sources.push(source("remainder", remainder));
  }

  return { sources, nominalPln, explainedPln, flowsProfitLossPln: typeof flowsProfitLossPln === "number" ? round(flowsProfitLossPln, 2) : null };
};
