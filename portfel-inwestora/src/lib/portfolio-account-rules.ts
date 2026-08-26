import { round } from "@/lib/utils";
import type {
  AccountFlowKind,
  IkzeLimitVariant,
  IkzeTaxEstimateRate,
  InvestmentPortfolio,
  PortfolioInstrument,
  PortfolioAccountConfiguration,
  PortfolioAccountType,
  PortfolioOperation,
} from "@/types/portfolio";

export const PORTFOLIO_ACCOUNT_TYPE_LABELS: Record<PortfolioAccountType, string> = {
  STANDARD: "Zwykły",
  IKE: "IKE",
  IKZE: "IKZE",
  OKI: "OKI",
};

export const PORTFOLIO_ACCOUNT_TYPE_LONG_LABELS: Record<PortfolioAccountType, string> = {
  STANDARD: "Zwykły rachunek inwestycyjny",
  IKE: "IKE",
  IKZE: "IKZE",
  OKI: "OKI — Osobiste Konto Inwestycyjne",
};

export const OFFICIAL_ACCOUNT_RULE_SOURCES = {
  ike2026:
    "https://www.knf.gov.pl/?articleId=81021&p_id=18",
  ikze2026:
    "https://www.gov.pl/web/rodzina/ikze-limit-wplat",
  ikzeDeduction:
    "https://www.podatki.gov.pl/ulgi-i-odliczenia/ulga-na-ikze-pit",
  ikeRules:
    "https://www.gov.pl/web/rodzina/co-trzeba-wiedziec-o-ike",
  ikzeRules:
    "https://www.gov.pl/web/rodzina/roczny-limit-wplat-na-ikze",
  okiAct:
    "https://eli.gov.pl/eli/DU/2026/1098/ogl",
} as const;

type AnnualContributionRule = {
  ike: number;
  ikze: number;
  ikzeBusiness: number;
};

/**
 * Values confirmed in the official annual announcements. Unknown years stay
 * unknown instead of silently reusing a neighbouring year's limit.
 */
export const ANNUAL_CONTRIBUTION_RULES: Readonly<Record<number, AnnualContributionRule>> = {
  2024: { ike: 23_472, ikze: 9_388.8, ikzeBusiness: 14_083.2 },
  2025: { ike: 26_019, ikze: 10_407.6, ikzeBusiness: 15_611.4 },
  2026: { ike: 28_260, ikze: 11_304, ikzeBusiness: 16_956 },
};

export const OKI_EFFECTIVE_DATE = "2027-01-01";

export type OkiAnnualRule = {
  year: number;
  taxRate: number;
  savingsExemptionPln: number;
  totalExemptionPln: number;
};

/** 2027 is fixed directly by the OKI act. Later rates require an announcement. */
export const OKI_ANNUAL_RULES: Readonly<Record<number, OkiAnnualRule>> = {
  2027: {
    year: 2027,
    taxRate: 0.0085,
    savingsExemptionPln: 25_000,
    totalExemptionPln: 100_000,
  },
};

/**
 * Art. 25: 19% of the NBP reference rate from 31 October of the preceding
 * year, no less than 0.1%, rounded down to two decimal places as a percentage.
 * Production rules still use the minister's announced rate for a given year.
 */
export const calculateOkiRateFromNbpReferenceRate = (
  nbpReferenceRatePercent: number
) => {
  if (!Number.isFinite(nbpReferenceRatePercent) || nbpReferenceRatePercent < 0) {
    return null;
  }
  const ratePercent = Math.max(
    0.1,
    Math.floor(nbpReferenceRatePercent * 0.19 * 100) / 100
  );
  return ratePercent / 100;
};

export const normalizePortfolioAccountType = (
  value: unknown
): PortfolioAccountType =>
  value === "IKE" || value === "IKZE" || value === "OKI" || value === "STANDARD"
    ? value
    : "STANDARD";

const normalizeIkzeLimitVariant = (value: unknown): IkzeLimitVariant =>
  value === "BUSINESS" ? "BUSINESS" : "STANDARD";

const normalizeIkzeTaxEstimateRate = (
  value: unknown
): IkzeTaxEstimateRate | undefined =>
  value === 0.12 || value === 0.19 || value === 0.32 ? value : undefined;

export const normalizePortfolioAccountConfiguration = (
  value: unknown,
  accountType: PortfolioAccountType
): PortfolioAccountConfiguration => {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  if (accountType !== "IKZE") {
    return {};
  }

  return {
    ikzeLimitVariant: normalizeIkzeLimitVariant(source.ikzeLimitVariant),
    ikzeTaxEstimateRate: normalizeIkzeTaxEstimateRate(source.ikzeTaxEstimateRate),
  };
};

export const getPortfolioAccountType = (
  portfolio: Pick<InvestmentPortfolio, "accountType">
) => normalizePortfolioAccountType(portfolio.accountType);

export const getAccountContributionLimit = ({
  accountType,
  year,
  ikzeLimitVariant = "STANDARD",
}: {
  accountType: PortfolioAccountType;
  year: number;
  ikzeLimitVariant?: IkzeLimitVariant;
}) => {
  const rule = ANNUAL_CONTRIBUTION_RULES[year];
  if (!rule) return null;
  if (accountType === "IKE") return rule.ike;
  if (accountType === "IKZE") {
    return ikzeLimitVariant === "BUSINESS" ? rule.ikzeBusiness : rule.ikze;
  }
  return null;
};

export const normalizeAccountFlowKind = (
  value: unknown,
  operationType: PortfolioOperation["operationType"]
): AccountFlowKind | undefined => {
  if (
    value === "CONTRIBUTION" ||
    value === "ORDINARY_WITHDRAWAL" ||
    value === "QUALIFIED_WITHDRAWAL" ||
    value === "EARLY_RETURN" ||
    value === "PARTIAL_RETURN" ||
    value === "TRANSFER_IN" ||
    value === "TRANSFER_OUT"
  ) {
    return value;
  }

  if (operationType === "DEPOSIT") return "CONTRIBUTION";
  if (operationType === "WITHDRAW") return "ORDINARY_WITHDRAWAL";
  return undefined;
};

const getOperationAmountPln = (operation: PortfolioOperation) => {
  const savedSnapshot = operation.metadata.amountPlnSnapshot;
  if (typeof savedSnapshot === "number" && Number.isFinite(savedSnapshot)) {
    return Math.abs(savedSnapshot);
  }
  if (operation.currency === "PLN") return Math.abs(operation.amount);
  if (
    typeof operation.exchangeRate === "number" &&
    Number.isFinite(operation.exchangeRate) &&
    operation.exchangeRate > 0
  ) {
    return Math.abs(operation.amount * operation.exchangeRate);
  }
  return null;
};

export type AnnualContributionSummary = {
  accountType: PortfolioAccountType;
  year: number;
  limitPln: number | null;
  contributedPln: number;
  remainingPln: number | null;
  utilizationPercent: number | null;
  exceededByPln: number;
  missingFxOperations: number;
  isComplete: boolean;
};

export const getAnnualContributionSummary = ({
  portfolio,
  year,
}: {
  portfolio: InvestmentPortfolio;
  year: number;
}): AnnualContributionSummary => {
  const accountType = getPortfolioAccountType(portfolio);
  const configuration = normalizePortfolioAccountConfiguration(
    portfolio.accountConfiguration,
    accountType
  );
  const limitPln = getAccountContributionLimit({
    accountType,
    year,
    ikzeLimitVariant: configuration.ikzeLimitVariant,
  });
  let contributedPln = 0;
  let missingFxOperations = 0;

  for (const operation of portfolio.operations ?? []) {
    if (operation.operationType !== "DEPOSIT" || operation.date.slice(0, 4) !== String(year)) {
      continue;
    }
    if (
      operation.metadata.cashEntryKind === "INITIAL_BALANCE" ||
      operation.metadata.cashEntryKind === "BALANCE_ADJUSTMENT"
    ) {
      continue;
    }
    const flowKind = normalizeAccountFlowKind(
      operation.metadata.accountFlowKind,
      operation.operationType
    );
    if (flowKind === "TRANSFER_IN") continue;

    const amountPln = getOperationAmountPln(operation);
    if (amountPln === null) {
      missingFxOperations += 1;
      continue;
    }
    contributedPln += amountPln;
  }

  contributedPln = round(contributedPln, 2);
  const remainingPln = limitPln === null ? null : round(Math.max(0, limitPln - contributedPln), 2);
  const exceededByPln = limitPln === null ? 0 : round(Math.max(0, contributedPln - limitPln), 2);

  return {
    accountType,
    year,
    limitPln,
    contributedPln,
    remainingPln,
    utilizationPercent:
      limitPln && limitPln > 0 ? round((contributedPln / limitPln) * 100, 1) : null,
    exceededByPln,
    missingFxOperations,
    isComplete: missingFxOperations === 0,
  };
};

export const estimateIkzeTaxBenefit = ({
  contributionSummary,
  taxRate,
}: {
  contributionSummary: AnnualContributionSummary;
  taxRate?: IkzeTaxEstimateRate;
}) => {
  if (contributionSummary.accountType !== "IKZE" || !taxRate) return null;
  const eligibleContribution = contributionSummary.limitPln === null
    ? contributionSummary.contributedPln
    : Math.min(contributionSummary.contributedPln, contributionSummary.limitPln);
  return round(eligibleContribution * taxRate, 2);
};

export type DomesticInvestmentIncomeTaxTreatment = {
  rate: number;
  treatment: "RULE_BASED_STANDARD" | "RULE_BASED_EXEMPT" | "OKI_NOT_EFFECTIVE";
  note: string;
};

export const getDomesticInvestmentIncomeTaxTreatment = ({
  accountType,
  paymentDate,
}: {
  accountType: PortfolioAccountType;
  paymentDate: string;
}): DomesticInvestmentIncomeTaxTreatment => {
  if (accountType === "IKE" || accountType === "IKZE") {
    return {
      rate: 0,
      treatment: "RULE_BASED_EXEMPT",
      note: `Polski podatek od dochodów kapitałowych nie jest potrącany wewnątrz ${accountType}.`,
    };
  }
  if (accountType === "OKI") {
    if (paymentDate >= OKI_EFFECTIVE_DATE) {
      return {
        rate: 0,
        treatment: "RULE_BASED_EXEMPT",
        note: "Dochód z aktywów OKI podlega odrębnemu podatkowi od wartości aktywów.",
      };
    }
    return {
      rate: 0.19,
      treatment: "OKI_NOT_EFFECTIVE",
      note: "Przepisy OKI nie obowiązują przed 1 stycznia 2027 r.",
    };
  }
  return {
    rate: 0.19,
    treatment: "RULE_BASED_STANDARD",
    note: "Standardowa krajowa stawka podatku od dywidendy.",
  };
};

export const getDomesticDividendTaxTreatment = getDomesticInvestmentIncomeTaxTreatment;

export const calculatePolishDividendTax = ({
  grossAmount,
  accountType,
  paymentDate,
}: {
  grossAmount: number;
  accountType: PortfolioAccountType;
  paymentDate: string;
}) => {
  const treatment = getDomesticInvestmentIncomeTaxTreatment({ accountType, paymentDate });
  return {
    ...treatment,
    amount: round(Math.max(0, grossAmount) * treatment.rate, 2),
  };
};

export type WithdrawalTaxEstimate = {
  status: "EXACT_RULE" | "ESTIMATE_UNAVAILABLE" | "NOT_APPLICABLE";
  taxRate: number | null;
  estimatedTaxPln: number | null;
  note: string;
};

export const getWithdrawalTaxEstimate = ({
  accountType,
  flowKind,
  amountPln,
  date,
}: {
  accountType: PortfolioAccountType;
  flowKind: AccountFlowKind;
  amountPln: number;
  date: string;
}): WithdrawalTaxEstimate => {
  if (flowKind === "TRANSFER_IN" || flowKind === "TRANSFER_OUT") {
    return {
      status: "NOT_APPLICABLE",
      taxRate: 0,
      estimatedTaxPln: 0,
      note: "Wypłata transferowa nie jest zwykłą wpłatą ani wypłatą podatkową.",
    };
  }
  if (accountType === "IKE" && flowKind === "QUALIFIED_WITHDRAWAL") {
    return {
      status: "EXACT_RULE",
      taxRate: 0,
      estimatedTaxPln: 0,
      note: "Kwalifikowana wypłata IKE korzysta ze zwolnienia po spełnieniu warunków ustawowych.",
    };
  }
  if (accountType === "IKZE" && flowKind === "QUALIFIED_WITHDRAWAL") {
    return {
      status: "EXACT_RULE",
      taxRate: 0.1,
      estimatedTaxPln: round(Math.max(0, amountPln) * 0.1, 2),
      note: "Kwalifikowana wypłata IKZE podlega 10% zryczałtowanemu podatkowi.",
    };
  }
  if (accountType === "IKE" && (flowKind === "EARLY_RETURN" || flowKind === "PARTIAL_RETURN")) {
    return {
      status: "ESTIMATE_UNAVAILABLE",
      taxRate: 0.19,
      estimatedTaxPln: null,
      note: "Podatek dotyczy dochodu, a Mexo nie ma pewnej podstawy do automatycznego wyliczenia go z samej kwoty zwrotu.",
    };
  }
  if (accountType === "IKZE" && flowKind === "EARLY_RETURN") {
    return {
      status: "ESTIMATE_UNAVAILABLE",
      taxRate: null,
      estimatedTaxPln: null,
      note: "Wcześniejszy zwrot IKZE rozlicza się według właściwych zasad PIT, których nie da się ustalić z samej operacji.",
    };
  }
  if (accountType === "OKI" && date >= OKI_EFFECTIVE_DATE) {
    return {
      status: "NOT_APPLICABLE",
      taxRate: null,
      estimatedTaxPln: null,
      note: "OKI stosuje podatek od wartości aktywów, a nie ryczałt od samej wypłaty.",
    };
  }
  return {
    status: "NOT_APPLICABLE",
    taxRate: null,
    estimatedTaxPln: null,
    note: "Brak odrębnej reguły podatkowej dla tej operacji.",
  };
};

export type OkiAssetGroup = "SAVINGS" | "INVESTMENT" | "NON_EXEMPT";

export type OkiAssetClassification = {
  group: OkiAssetGroup | null;
  reason: string;
};

/**
 * Mexo can prove the statutory group only for supported Polish retail treasury
 * savings bonds. A PLN quote or a GPW ticker is not enough to prove the
 * issuer's share-capital currency or a fund's required qualifying allocation,
 * so all other assets intentionally stay unclassified.
 */
export const classifyOkiAsset = (
  instrument: Pick<PortfolioInstrument, "assetKind" | "marketCurrency" | "metadata">
): OkiAssetClassification => {
  const treasuryBondType = instrument.metadata?.treasuryBondType;
  if (
    instrument.assetKind === "bond" &&
    instrument.marketCurrency === "PLN" &&
    (treasuryBondType === "EDO" || treasuryBondType === "COI" || treasuryBondType === "ROS")
  ) {
    return {
      group: "SAVINGS",
      reason: "Polska detaliczna obligacja oszczędnościowa Skarbu Państwa.",
    };
  }

  return {
    group: null,
    reason: "Brak wystarczających danych źródłowych do ustawowej klasyfikacji OKI.",
  };
};

export type OkiDailyValuation = {
  date: string;
  savingsPln: number;
  investmentPln: number;
  nonExemptPln: number;
};

export type OkiDailyCashFlow = {
  date: string;
  contributionsPln: number;
  withdrawalsPln: number;
};

export type OkiAccountYearHistory = {
  portfolioId: string;
  daysHeld: number;
  dailyValuations: OkiDailyValuation[];
  dailyCashFlows?: OkiDailyCashFlow[];
};

export type OkiTaxCalculation = {
  status: "NOT_EFFECTIVE" | "UNKNOWN_ANNUAL_RULE" | "INSUFFICIENT_HISTORY" | "EXACT";
  year: number;
  averageSavingsPln: number | null;
  averageInvestmentPln: number | null;
  averageNonExemptPln: number | null;
  exemptPln: number | null;
  taxableBasePln: number | null;
  taxRate: number | null;
  taxPln: number | null;
  note: string;
};

const isValidValuation = (valuation: OkiDailyValuation, year: number) =>
  valuation.date.slice(0, 4) === String(year) &&
  [valuation.savingsPln, valuation.investmentPln, valuation.nonExemptPln].every(
    (amount) => Number.isFinite(amount) && amount >= 0
  );

/**
 * Implements arts. 23, 25 and 26 of the OKI act. The calculation deliberately
 * refuses a result unless every held day has a categorized end-of-day value.
 */
export const calculateOkiTax = ({
  year,
  accounts,
}: {
  year: number;
  accounts: OkiAccountYearHistory[];
}): OkiTaxCalculation => {
  if (year < 2027) {
    return {
      status: "NOT_EFFECTIVE",
      year,
      averageSavingsPln: null,
      averageInvestmentPln: null,
      averageNonExemptPln: null,
      exemptPln: null,
      taxableBasePln: null,
      taxRate: null,
      taxPln: null,
      note: "OKI obowiązuje od 1 stycznia 2027 r.",
    };
  }
  const rule = OKI_ANNUAL_RULES[year];
  if (!rule) {
    return {
      status: "UNKNOWN_ANNUAL_RULE",
      year,
      averageSavingsPln: null,
      averageInvestmentPln: null,
      averageNonExemptPln: null,
      exemptPln: null,
      taxableBasePln: null,
      taxRate: null,
      taxPln: null,
      note: "Brak oficjalnej stawki lub kwot zwolnienia dla wybranego roku.",
    };
  }
  const hasIncompleteAccount = accounts.some((account) => {
    const distinctValuationDays = new Set(
      account.dailyValuations.map((valuation) => valuation.date)
    ).size;
    const invalidCashFlow = (account.dailyCashFlows ?? []).some(
      (flow) =>
        flow.date.slice(0, 4) !== String(year) ||
        !Number.isFinite(flow.contributionsPln) ||
        !Number.isFinite(flow.withdrawalsPln) ||
        flow.contributionsPln < 0 ||
        flow.withdrawalsPln < 0
    );
    const valuationSum = account.dailyValuations.reduce(
      (sum, valuation) =>
        sum + valuation.savingsPln + valuation.investmentPln + valuation.nonExemptPln,
      0
    );
    const hasSameDayContributionAndWithdrawal = (account.dailyCashFlows ?? []).some(
      (flow) => flow.contributionsPln > 0 && flow.withdrawalsPln > 0
    );

    return (
      !Number.isInteger(account.daysHeld) ||
      account.daysHeld <= 0 ||
      account.dailyValuations.length !== account.daysHeld ||
      distinctValuationDays !== account.daysHeld ||
      account.dailyValuations.some((valuation) => !isValidValuation(valuation, year)) ||
      invalidCashFlow ||
      (valuationSum === 0 && hasSameDayContributionAndWithdrawal)
    );
  });

  if (accounts.length === 0 || hasIncompleteAccount) {
    return {
      status: "INSUFFICIENT_HISTORY",
      year,
      averageSavingsPln: null,
      averageInvestmentPln: null,
      averageNonExemptPln: null,
      exemptPln: null,
      taxableBasePln: null,
      taxRate: rule.taxRate,
      taxPln: null,
      note: "Brak wystarczających danych do dokładnego oszacowania.",
    };
  }

  const totals = accounts.reduce(
    (aggregate, account) => {
      const valuationSums = account.dailyValuations.reduce(
        (sums, valuation) => ({
          savings: sums.savings + valuation.savingsPln,
          investment: sums.investment + valuation.investmentPln,
          nonExempt: sums.nonExempt + valuation.nonExemptPln,
        }),
        { savings: 0, investment: 0, nonExempt: 0 }
      );
      const flowAdjustment = (account.dailyCashFlows ?? []).reduce((sum, flow) => {
        const contributions = Math.max(0, flow.contributionsPln);
        const withdrawals = Math.max(0, flow.withdrawalsPln);
        return sum + Math.min(contributions, withdrawals);
      }, 0);
      const allValuations = valuationSums.savings + valuationSums.investment + valuationSums.nonExempt;
      const allocate = (groupValue: number) =>
        allValuations > 0 ? flowAdjustment * (groupValue / allValuations) : 0;

      aggregate.savings += (valuationSums.savings + allocate(valuationSums.savings)) / account.daysHeld;
      aggregate.investment += (valuationSums.investment + allocate(valuationSums.investment)) / account.daysHeld;
      aggregate.nonExempt += (valuationSums.nonExempt + allocate(valuationSums.nonExempt)) / account.daysHeld;
      return aggregate;
    },
    { savings: 0, investment: 0, nonExempt: 0 }
  );

  const averageSavingsPln = round(totals.savings, 2);
  const averageInvestmentPln = round(totals.investment, 2);
  const averageNonExemptPln = round(totals.nonExempt, 2);
  const exemptSavings = Math.min(averageSavingsPln, rule.savingsExemptionPln);
  const exemptInvestment = Math.min(
    averageInvestmentPln,
    Math.max(0, rule.totalExemptionPln - exemptSavings)
  );
  const exemptPln = round(exemptSavings + exemptInvestment, 2);
  const taxableBasePln = round(
    Math.max(0, averageSavingsPln + averageInvestmentPln + averageNonExemptPln - exemptPln),
    2
  );

  return {
    status: "EXACT",
    year,
    averageSavingsPln,
    averageInvestmentPln,
    averageNonExemptPln,
    exemptPln,
    taxableBasePln,
    taxRate: rule.taxRate,
    taxPln: round(taxableBasePln * rule.taxRate, 2),
    note: "Obliczenie z kompletnej dziennej historii wszystkich wskazanych kont OKI.",
  };
};
