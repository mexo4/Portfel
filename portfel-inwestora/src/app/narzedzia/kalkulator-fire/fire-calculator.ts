export type FireInputs = {
  age: number;
  portfolio: number;
  monthlyExpenses: number;
  monthlyContribution: number;
  annualReturnPercent: number;
  inflationPercent: number;
  safeWithdrawalRatePercent: number;
  useRealValues: boolean;
};

export type FireProjectionPoint = {
  year: number;
  age: number;
  value: number;
  target: number;
  contributed: number;
  growth: number;
};

export type FireCalculation = {
  target: number;
  fiRatioPercent: number;
  realAnnualReturnPercent: number;
  yearsToFire: number | null;
  fireAge: number | null;
  monthlyFireIncome: number;
  projection: FireProjectionPoint[];
  isAlreadyFire: boolean;
  isReachable: boolean;
};

export const FIRE_MAX_PROJECTION_YEARS = 80;

const finiteOr = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(finiteOr(value, min), min), max);

const normalizeInputs = (inputs: FireInputs): FireInputs => ({
  age: clamp(inputs.age, 18, 80),
  portfolio: clamp(inputs.portfolio, 0, 100_000_000),
  monthlyExpenses: clamp(inputs.monthlyExpenses, 1, 1_000_000),
  monthlyContribution: clamp(inputs.monthlyContribution, 0, 1_000_000),
  annualReturnPercent: clamp(inputs.annualReturnPercent, 0, 15),
  inflationPercent: clamp(inputs.inflationPercent, 0, 10),
  safeWithdrawalRatePercent: clamp(inputs.safeWithdrawalRatePercent, 1, 10),
  useRealValues: Boolean(inputs.useRealValues),
});

export const calculateRealAnnualReturnPercent = (
  annualReturnPercent: number,
  inflationPercent: number,
) => {
  const nominalFactor = 1 + finiteOr(annualReturnPercent, 0) / 100;
  const inflationFactor = 1 + Math.max(0, finiteOr(inflationPercent, 0)) / 100;
  return ((nominalFactor / inflationFactor) - 1) * 100;
};

export const calculateFire = (rawInputs: FireInputs): FireCalculation => {
  const inputs = normalizeInputs(rawInputs);
  const safeWithdrawalRate = inputs.safeWithdrawalRatePercent / 100;
  const target = inputs.monthlyExpenses * 12 / safeWithdrawalRate;
  const realAnnualReturnPercent = calculateRealAnnualReturnPercent(
    inputs.annualReturnPercent,
    inputs.inflationPercent,
  );
  const annualReturnPercent = inputs.useRealValues
    ? realAnnualReturnPercent
    : inputs.annualReturnPercent;
  const monthlyRate = Math.pow(1 + annualReturnPercent / 100, 1 / 12) - 1;
  const safeMonthlyRate = Number.isFinite(monthlyRate) ? monthlyRate : 0;
  const projection: FireProjectionPoint[] = [];
  let value = inputs.portfolio;
  let contributed = inputs.portfolio;
  let yearsToFire: number | null = value >= target ? 0 : null;

  projection.push({
    year: 0,
    age: inputs.age,
    value,
    target,
    contributed,
    growth: 0,
  });

  for (let month = 1; month <= FIRE_MAX_PROJECTION_YEARS * 12; month += 1) {
    value = Math.max(0, value * (1 + safeMonthlyRate) + inputs.monthlyContribution);
    contributed += inputs.monthlyContribution;

    if (yearsToFire === null && value >= target) {
      yearsToFire = Math.ceil(month / 12);
    }

    if (month % 12 === 0 || month === FIRE_MAX_PROJECTION_YEARS * 12) {
      const year = month / 12;
      projection.push({
        year,
        age: inputs.age + year,
        value,
        target,
        contributed,
        growth: Math.max(0, value - contributed),
      });
    }
  }

  const isAlreadyFire = yearsToFire === 0;
  return {
    target,
    fiRatioPercent: target > 0 ? (inputs.portfolio / target) * 100 : 0,
    realAnnualReturnPercent,
    yearsToFire,
    fireAge: yearsToFire === null ? null : inputs.age + yearsToFire,
    monthlyFireIncome: target * safeWithdrawalRate / 12,
    projection,
    isAlreadyFire,
    isReachable: yearsToFire !== null,
  };
};
