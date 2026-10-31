import { CAGR_DAYS_PER_YEAR } from "@/lib/portfolio-risk-analytics";

export type MoneyWeightedCashFlow = {
  date: string;
  /** Portfolio perspective: deposit positive, withdrawal negative. */
  amount: number;
  kind?: "DEPOSIT" | "WITHDRAW" | "BALANCE_ADJUSTMENT" | "ARCHIVE_ADJUSTMENT";
};

export type XirrUnavailableCode =
  | "NO_EXTERNAL_CASH_FLOWS"
  | "NO_TERMINAL_VALUE"
  | "INVALID_DATE"
  | "NO_SIGN_CHANGE"
  | "AMBIGUOUS_CASH_FLOWS"
  | "NO_BRACKET"
  | "NO_CONVERGENCE";

export type XirrResult = {
  value: number | null;
  unavailableCode?: XirrUnavailableCode;
  iterations: number;
};

export type NetExternalCapital = {
  deposits: number;
  withdrawals: number;
  net: number;
};

const DAY_MS = 86_400_000;
const MINIMUM_RATE = -0.999999;
const RATE_TOLERANCE = 1e-10;
const VALUE_TOLERANCE = 1e-7;

const toTimestamp = (date: string) => {
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
};

const sign = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);

const combineByDate = (flows: MoneyWeightedCashFlow[]) =>
  Array.from(
    flows.reduce((byDate, flow) => {
      byDate.set(flow.date, (byDate.get(flow.date) ?? 0) + flow.amount);
      return byDate;
    }, new Map<string, number>())
  )
    .filter(([, amount]) => Number.isFinite(amount) && Math.abs(amount) > VALUE_TOLERANCE)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, amount]) => ({ date, amount }));

export const calculateNetExternalCapital = (
  flows: MoneyWeightedCashFlow[]
): NetExternalCapital => {
  // Preserve gross deposits and withdrawals. We only combine same-day flows
  // for XIRR roots; netting them here would erase real capital movements.
  const normalized = flows.filter(
    (flow) =>
      typeof flow.date === "string" &&
      flow.kind !== "ARCHIVE_ADJUSTMENT" &&
      toTimestamp(flow.date) !== null &&
      Number.isFinite(flow.amount) &&
      Math.abs(flow.amount) > VALUE_TOLERANCE
  );
  const deposits = normalized.reduce((total, flow) => total + Math.max(flow.amount, 0), 0);
  const withdrawals = normalized.reduce((total, flow) => total + Math.max(-flow.amount, 0), 0);
  return { deposits, withdrawals, net: deposits - withdrawals };
};

const countSignChanges = (values: number[]) => {
  let previous = 0;
  let changes = 0;
  for (const value of values) {
    const current = sign(value);
    if (current === 0) continue;
    if (previous !== 0 && previous !== current) changes += 1;
    previous = current;
  }
  return changes;
};

/**
 * Stable annual money-weighted return for dated external cash movements.
 * Inputs use portfolio signs; the solver converts deposits to investor
 * outflows and current portfolio value to the terminal investor inflow.
 */
export const calculateXirr = ({
  externalCashFlows,
  terminalValue,
  terminalDate,
}: {
  externalCashFlows: MoneyWeightedCashFlow[];
  terminalValue: number | null | undefined;
  terminalDate: string | null | undefined;
}): XirrResult => {
  if (!externalCashFlows.length) {
    return { value: null, unavailableCode: "NO_EXTERNAL_CASH_FLOWS", iterations: 0 };
  }
  if (!(typeof terminalValue === "number" && Number.isFinite(terminalValue) && terminalValue > 0)) {
    return { value: null, unavailableCode: "NO_TERMINAL_VALUE", iterations: 0 };
  }
  if (!terminalDate || toTimestamp(terminalDate) === null) {
    return { value: null, unavailableCode: "INVALID_DATE", iterations: 0 };
  }

  const combined = combineByDate(externalCashFlows);
  if (!combined.length || combined.some((flow) => toTimestamp(flow.date) === null || flow.date > terminalDate)) {
    return { value: null, unavailableCode: "INVALID_DATE", iterations: 0 };
  }

  // Investor viewpoint: a portfolio deposit is a negative cash flow; a
  // withdrawal and the terminal portfolio value are positive flows.
  const investorFlows = combineByDate([
    ...combined.map((flow) => ({ date: flow.date, amount: -flow.amount })),
    { date: terminalDate, amount: terminalValue },
  ]);
  if (countSignChanges(investorFlows.map((flow) => flow.amount)) === 0) {
    return { value: null, unavailableCode: "NO_SIGN_CHANGE", iterations: 0 };
  }
  if (countSignChanges(investorFlows.map((flow) => flow.amount)) > 1) {
    return { value: null, unavailableCode: "AMBIGUOUS_CASH_FLOWS", iterations: 0 };
  }

  const startTimestamp = toTimestamp(investorFlows[0]!.date)!;
  const npv = (rate: number) => investorFlows.reduce((total, flow) => {
    const timestamp = toTimestamp(flow.date)!;
    const years = (timestamp - startTimestamp) / DAY_MS / CAGR_DAYS_PER_YEAR;
    return total + flow.amount / (1 + rate) ** years;
  }, 0);

  // A log-like spread gives a predictable bracket over very negative and very
  // high annual returns without relying on a brittle Newton initial guess.
  const candidateRates = [
    MINIMUM_RATE, -0.999, -0.99, -0.9, -0.75, -0.5, -0.25, -0.1,
    -0.01, 0, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100,
    250, 500, 1_000, 2_500, 5_000, 10_000,
  ];
  let lower: number | null = null;
  let upper: number | null = null;
  let previousRate: number | null = null;
  let previousValue: number | null = null;
  for (const rate of candidateRates) {
    const value = npv(rate);
    if (!Number.isFinite(value)) {
      previousRate = null;
      previousValue = null;
      continue;
    }
    if (Math.abs(value) <= VALUE_TOLERANCE) return { value: rate, iterations: 0 };
    if (previousValue !== null && previousRate !== null && Math.sign(previousValue) !== Math.sign(value)) {
      lower = previousRate;
      upper = rate;
      break;
    }
    previousRate = rate;
    previousValue = value;
  }
  if (lower === null || upper === null) {
    return { value: null, unavailableCode: "NO_BRACKET", iterations: 0 };
  }

  let lowerBound: number = lower;
  let upperBound: number = upper;
  let lowerValue = npv(lowerBound);
  for (let iteration = 1; iteration <= 200; iteration += 1) {
    const middle = (lowerBound + upperBound) / 2;
    const middleValue = npv(middle);
    if (!Number.isFinite(middleValue)) {
      return { value: null, unavailableCode: "NO_CONVERGENCE", iterations: iteration };
    }
    if (Math.abs(middleValue) <= VALUE_TOLERANCE || Math.abs(upperBound - lowerBound) <= RATE_TOLERANCE) {
      return { value: middle, iterations: iteration };
    }
    if (Math.sign(lowerValue) !== Math.sign(middleValue)) {
      upperBound = middle;
    } else {
      lowerBound = middle;
      lowerValue = middleValue;
    }
  }

  return { value: null, unavailableCode: "NO_CONVERGENCE", iterations: 200 };
};

