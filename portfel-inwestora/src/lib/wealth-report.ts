import { round } from "@/lib/utils";
import { getWealthItemValue } from "@/lib/wealth-instruments";
import type { FxRates, InvestmentPortfolio, PortfolioSummary, WealthCategory, WealthItem } from "@/types/portfolio";

/**
 * The wealth report: everything the user keeps in Mexo in one place, in PLN. Brokerage portfolios
 * (positions and cash on their accounts) and the items of the wealth page (property, vehicles,
 * deposits, gold, loans) add up to the net worth; the report groups them by kind and lists where
 * the money is.
 */

export type WealthReportCategoryKey = "investments" | "broker-cash" | "deposits" | "property" | "vehicles" | "valuables" | "other" | "liabilities";

export type WealthReportCategory = { key: WealthReportCategoryKey; label: string; valuePln: number; sharePercent: number };
export type WealthReportPlace = { id: string; name: string; detail: string; valuePln: number; isLiability: boolean };

export type WealthReport = {
  assetsPln: number;
  liabilitiesPln: number;
  netWorthPln: number;
  categories: WealthReportCategory[];
  places: WealthReportPlace[];
};

const CATEGORY_LABELS: Record<WealthReportCategoryKey, string> = {
  investments: "Inwestycje na rachunkach",
  "broker-cash": "Gotówka na rachunkach inwestycyjnych",
  deposits: "Lokaty",
  property: "Nieruchomości",
  vehicles: "Pojazdy",
  valuables: "Złoto, sztuka i kolekcje",
  other: "Inne aktywa",
  liabilities: "Kredyty i zobowiązania",
};

const ITEM_CATEGORY: Partial<Record<WealthCategory, WealthReportCategoryKey>> = {
  deposit: "deposits",
  house: "property",
  apartment: "property",
  land: "property",
  car: "vehicles",
  motorcycle: "vehicles",
  gold: "valuables",
  art: "valuables",
  collection: "valuables",
};

const ACCOUNT_TYPE_LABELS: Record<string, string> = { IKE: "IKE", IKZE: "IKZE", OKI: "OKI" };

/** 1 pozycja, 2-4 pozycje (but 12-14 pozycji), 5+ pozycji. */
const positionsLabel = (count: number) => {
  if (count === 1) return "pozycja";
  const lastTwo = count % 100;
  const last = count % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? "pozycje" : "pozycji";
};

const rateToPln = (currency: string, fxRates: FxRates) => (currency === "PLN" ? 1 : fxRates[currency] && fxRates[currency] > 0 ? fxRates[currency] : 1);

export const buildWealthReport = ({
  portfolioSummaries,
  wealthItems,
  fxRates,
  today,
}: {
  portfolioSummaries: Array<{ portfolio: InvestmentPortfolio; summary: PortfolioSummary }>;
  wealthItems: WealthItem[];
  fxRates: FxRates;
  today: string;
}): WealthReport => {
  const sums: Record<WealthReportCategoryKey, number> = { investments: 0, "broker-cash": 0, deposits: 0, property: 0, vehicles: 0, valuables: 0, other: 0, liabilities: 0 };
  const places: WealthReportPlace[] = [];

  for (const { portfolio, summary } of portfolioSummaries) {
    sums.investments += summary.marketValuePln;
    sums["broker-cash"] += summary.cashValuePln;
    const accounts = (portfolio.accounts ?? []).filter((account) => account.kind === "investment").map((account) => account.name);
    const wrapper = ACCOUNT_TYPE_LABELS[portfolio.accountType ?? ""];
    places.push({
      id: `portfolio:${portfolio.id}`,
      name: portfolio.name,
      detail: [wrapper ? `Portfel ${wrapper}` : "Portfel inwestycyjny", accounts.length ? accounts.join(", ") : null, `${summary.positionsCount} ${positionsLabel(summary.positionsCount)}`].filter(Boolean).join(" · "),
      valuePln: round(summary.totalValuePln, 2),
      isLiability: false,
    });
  }

  for (const item of wealthItems) {
    const valuePln = round(getWealthItemValue(item, today) * rateToPln(item.currency, fxRates), 2);
    const key: WealthReportCategoryKey = item.kind === "liability" ? "liabilities" : ITEM_CATEGORY[item.category] ?? "other";
    sums[key] += valuePln;
    places.push({ id: `wealth:${item.id}`, name: item.name, detail: CATEGORY_LABELS[key] + (item.currency !== "PLN" ? ` · ${item.currency}` : ""), valuePln, isLiability: item.kind === "liability" });
  }

  const assetsPln = round((Object.keys(sums) as WealthReportCategoryKey[]).filter((key) => key !== "liabilities").reduce((total, key) => total + sums[key], 0), 2);
  const liabilitiesPln = round(sums.liabilities, 2);
  const categories = (Object.keys(sums) as WealthReportCategoryKey[])
    .filter((key) => Math.abs(sums[key]) >= 0.005)
    .map((key) => ({
      key,
      label: CATEGORY_LABELS[key],
      valuePln: round(sums[key], 2),
      // Assets as a share of all assets; liabilities as a share of assets too (how much is owed against them).
      sharePercent: assetsPln > 0 ? round((sums[key] / assetsPln) * 100, 1) : 0,
    }))
    .sort((left, right) => Number(left.key === "liabilities") - Number(right.key === "liabilities") || right.valuePln - left.valuePln);

  return {
    assetsPln,
    liabilitiesPln,
    netWorthPln: round(assetsPln - liabilitiesPln, 2),
    categories,
    places: places.sort((left, right) => Number(left.isLiability) - Number(right.isLiability) || right.valuePln - left.valuePln),
  };
};
