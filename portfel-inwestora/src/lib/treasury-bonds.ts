import { getTodayDateInputValue, round, toDateInputValue } from "@/lib/utils";
import type {
  TreasuryBondCouponMode,
  TreasuryBondDraft,
  TreasuryBondSeries,
  TreasuryBondType,
} from "@/types/portfolio";

type TreasuryBondTypeConfig = {
  label: string;
  yearsToMaturity: number;
  offerPath: string;
  couponMode: TreasuryBondCouponMode;
  isFamilyOnly: boolean;
};

type ParsedTreasuryBondCode = {
  code: string;
  type: TreasuryBondType;
  yearsToMaturity: number;
  issueMonth: number;
  issueYear: number;
  redemptionMonth: number;
  redemptionYear: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

export const TREASURY_BOND_TYPE_CONFIG: Record<
  TreasuryBondType,
  TreasuryBondTypeConfig
> = {
  EDO: {
    label: "10-letnie obligacje EDO",
    yearsToMaturity: 10,
    offerPath: "obligacje-10-letnie-edo",
    couponMode: "capitalized",
    isFamilyOnly: false,
  },
  COI: {
    label: "4-letnie obligacje COI",
    yearsToMaturity: 4,
    offerPath: "obligacje-4-letnie-coi",
    couponMode: "paid-out",
    isFamilyOnly: false,
  },
  ROS: {
    label: "6-letnie obligacje ROS",
    yearsToMaturity: 6,
    offerPath: "obligacje-6-letnie-ros",
    couponMode: "capitalized",
    isFamilyOnly: true,
  },
};

const getShortYear = (year: number) => year % 100;

const toUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const addUtcDays = (value: string, days: number) => {
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const addUtcYears = (value: string, years: number) => {
  const date = toUtcDate(value);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
};

export const getDaysBetweenDates = (startDate: string, endDate: string) =>
  Math.max(0, Math.round((toUtcDate(endDate).getTime() - toUtcDate(startDate).getTime()) / MS_PER_DAY));

export const getDaysInBondPeriod = (startDate: string, endDate: string) =>
  Math.max(1, getDaysBetweenDates(startDate, endDate));

export const normalizeTreasuryBondCode = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, "");

export const isTreasuryBondCode = (value: string) =>
  /^[A-Z]{3}\d{4}$/.test(normalizeTreasuryBondCode(value));

export const parseTreasuryBondCode = (value: string): ParsedTreasuryBondCode => {
  const code = normalizeTreasuryBondCode(value);

  if (!/^[A-Z]{3}\d{4}$/.test(code)) {
    throw new Error("Kod obligacji powinien miec format np. EDO0125.");
  }

  const type = code.slice(0, 3) as TreasuryBondType;
  const config = TREASURY_BOND_TYPE_CONFIG[type];

  if (!config) {
    throw new Error("Obslugujemy tylko polskie obligacje EDO, COI i ROS.");
  }

  const redemptionMonth = Number(code.slice(3, 5));
  const redemptionYearSuffix = Number(code.slice(5, 7));

  if (!Number.isInteger(redemptionMonth) || redemptionMonth < 1 || redemptionMonth > 12) {
    throw new Error("Kod obligacji ma niepoprawny miesiac wykupu.");
  }

  const currentCentury = Math.floor(new Date().getUTCFullYear() / 100) * 100;
  let redemptionYear = currentCentury + redemptionYearSuffix;

  while (redemptionYear - config.yearsToMaturity < 1990) {
    redemptionYear += 100;
  }

  while (redemptionYear - config.yearsToMaturity > new Date().getUTCFullYear() + 20) {
    redemptionYear -= 100;
  }

  return {
    code,
    type,
    yearsToMaturity: config.yearsToMaturity,
    issueMonth: redemptionMonth,
    issueYear: redemptionYear - config.yearsToMaturity,
    redemptionMonth,
    redemptionYear,
  };
};

export const getTreasuryBondOfferUrl = (code: string) => {
  const parsed = parseTreasuryBondCode(code);
  const { offerPath } = TREASURY_BOND_TYPE_CONFIG[parsed.type];

  return `https://www.obligacjeskarbowe.pl/oferta-obligacji/${offerPath}/${parsed.code.toLowerCase()}/`;
};

export const createFallbackTreasuryBondSeries = (code: string): TreasuryBondSeries => {
  const parsed = parseTreasuryBondCode(code);
  const config = TREASURY_BOND_TYPE_CONFIG[parsed.type];

  return {
    code: parsed.code,
    type: parsed.type,
    yearsToMaturity: parsed.yearsToMaturity,
    issueMonth: parsed.issueMonth,
    issueYear: parsed.issueYear,
    redemptionMonth: parsed.redemptionMonth,
    redemptionYear: parsed.redemptionYear,
    nominalValue: 100,
    salePrice: 100,
    firstYearRate: 0,
    marginRate: 0,
    earlyRedemptionFee: 0,
    couponMode: config.couponMode,
    interestPaymentDescription:
      config.couponMode === "capitalized"
        ? "Odsetki sa kapitalizowane i wyplacane przy wykupie."
        : "Odsetki sa wyplacane co roku.",
    isFamilyOnly: config.isFamilyOnly,
    sourceLinks: {
      offerPageUrl: getTreasuryBondOfferUrl(code),
    },
    resolvedAt: new Date().toISOString(),
  };
};

export const getTreasuryBondDisplayName = (series: Pick<TreasuryBondSeries, "code" | "type">) =>
  `${series.type} ${series.code}`;

export const formatTreasuryBondIssueMonth = (series: Pick<TreasuryBondSeries, "issueMonth" | "issueYear">) =>
  `${String(series.issueMonth).padStart(2, "0")}/${series.issueYear}`;

export const formatTreasuryBondRedemptionMonth = (
  series: Pick<TreasuryBondSeries, "redemptionMonth" | "redemptionYear">
) => `${String(series.redemptionMonth).padStart(2, "0")}/${series.redemptionYear}`;

export const isTreasuryBondPurchaseDateInIssueWindow = (
  code: string,
  purchaseDate: string
) => {
  const parsed = parseTreasuryBondCode(code);
  const normalizedPurchaseDate = toDateInputValue(purchaseDate, "");

  if (!normalizedPurchaseDate) {
    return false;
  }

  const [year, month] = normalizedPurchaseDate.split("-").map(Number);
  return year === parsed.issueYear && month === parsed.issueMonth;
};

export const getTreasuryBondMaturityDate = (purchaseDate: string, yearsToMaturity: number) =>
  addUtcYears(toDateInputValue(purchaseDate), yearsToMaturity);

export const createEmptyTreasuryBondDraft = (): TreasuryBondDraft => ({
  code: "",
  quantity: 0,
  quantityInput: "",
  purchaseDate: getTodayDateInputValue(),
  purchasePrice: 100,
  purchasePriceInput: "100",
  swapTargetCode: "",
  swapTargetQuantity: 0,
  swapTargetQuantityInput: "",
});

export const getTreasuryBondCouponPaymentDates = (
  purchaseDate: string,
  series: TreasuryBondSeries
) => {
  const normalizedPurchaseDate = toDateInputValue(purchaseDate);
  const paymentDates: string[] = [];

  if (series.couponMode !== "paid-out") {
    return paymentDates;
  }

  for (let yearIndex = 1; yearIndex < series.yearsToMaturity; yearIndex += 1) {
    paymentDates.push(addUtcYears(normalizedPurchaseDate, yearIndex));
  }

  return paymentDates;
};

export const getBondQuoteAccrual = ({
  baseAmount,
  annualRate,
  elapsedDays,
  periodDays,
}: {
  baseAmount: number;
  annualRate: number;
  elapsedDays: number;
  periodDays: number;
}) => round(baseAmount * (annualRate / 100) * (elapsedDays / Math.max(1, periodDays)), 8);

export const clampBondFee = (interestAmount: number, feeCap: number) =>
  round(Math.max(0, Math.min(Math.max(0, interestAmount), Math.max(0, feeCap))), 8);

export const applyBondTax = (amount: number) => round(Math.max(0, amount) * 0.19, 8);

export const getBondPeriodEndDate = (purchaseDate: string, yearIndex: number) =>
  addUtcYears(purchaseDate, yearIndex);

export const getBondPeriodStartDate = (purchaseDate: string, yearIndex: number) =>
  addUtcYears(purchaseDate, yearIndex - 1);

export const shiftBondDateByDays = (value: string, days: number) => addUtcDays(value, days);

export const getBondReferenceMonthKey = (periodStartDate: string) => {
  const date = toUtcDate(periodStartDate);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

export const getBondRedemptionCodeSuffix = (series: Pick<TreasuryBondSeries, "code">) =>
  getShortYear(parseTreasuryBondCode(series.code).redemptionYear);
