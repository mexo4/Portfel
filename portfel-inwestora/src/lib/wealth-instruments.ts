import { round } from "@/lib/utils";
import type { WealthDeposit, WealthItem, WealthLoan } from "@/types/portfolio";

/**
 * Deposits and loans kept on the wealth page. Their value is derived from their terms instead of
 * typed in: a deposit grows by the interest accrued so far, a loan shrinks by the principal paid
 * according to its repayment schedule.
 */

export const BELKA_TAX_RATE = 0.19;
const DAY_MS = 86_400_000;

export const addMonths = (date: string, months: number) => {
  const [year, month, day] = date.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
};

const daysBetween = (from: string, to: string) => Math.max(0, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS));

const CAPITALIZATION_MONTHS: Record<WealthDeposit["capitalization"], number | null> = { maturity: null, monthly: 1, quarterly: 3 };

export type DepositState = {
  maturityDate: string;
  isMatured: boolean;
  /** Interest credited or accrued until the date, after the 19% tax when the deposit is taxed. */
  interestNet: number;
  value: number;
  /** Interest at maturity, after tax when taxed. */
  interestAtMaturityNet: number;
};

/**
 * Simple interest within each capitalization period; at the end of a period the interest (less
 * the tax, which banks withhold at every capitalization) is added to the balance. Interest of the
 * running period is accrued by days. After maturity the value stays at the final amount.
 */
export const getDepositState = (deposit: WealthDeposit, today: string): DepositState => {
  const maturityDate = addMonths(deposit.startDate, deposit.termMonths);
  const periodMonths = CAPITALIZATION_MONTHS[deposit.capitalization] ?? deposit.termMonths;
  const taxFactor = deposit.taxed ? 1 - BELKA_TAX_RATE : 1;
  const rate = deposit.annualRatePercent / 100;
  const until = today < deposit.startDate ? deposit.startDate : today > maturityDate ? maturityDate : today;

  const valueAt = (date: string) => {
    let balance = deposit.principal;
    let periodStart = deposit.startDate;
    while (periodStart < date) {
      const periodEnd = addMonths(periodStart, periodMonths) > maturityDate ? maturityDate : addMonths(periodStart, periodMonths);
      const periodInterest = balance * rate * (daysBetween(periodStart, periodEnd) / 365);
      if (periodEnd <= date) {
        balance += periodInterest * taxFactor;
        periodStart = periodEnd;
      } else {
        balance += periodInterest * taxFactor * (daysBetween(periodStart, date) / Math.max(1, daysBetween(periodStart, periodEnd)));
        break;
      }
    }
    return balance;
  };

  const value = round(valueAt(until), 2);
  return {
    maturityDate,
    isMatured: today >= maturityDate,
    interestNet: round(value - deposit.principal, 2),
    value,
    interestAtMaturityNet: round(valueAt(maturityDate) - deposit.principal, 2),
  };
};

export type LoanInstallment = { date: string; payment: number; principal: number; interest: number; balanceAfter: number };

/** The whole repayment schedule: monthly installments, the first one a month after the start. */
export const buildLoanSchedule = (loan: WealthLoan): LoanInstallment[] => {
  const months = Math.max(1, Math.round(loan.termMonths));
  const monthlyRate = loan.annualRatePercent / 100 / 12;
  const annuity = monthlyRate === 0 ? loan.principal / months : (loan.principal * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
  const schedule: LoanInstallment[] = [];
  let balance = loan.principal;
  for (let index = 1; index <= months; index += 1) {
    const interest = balance * monthlyRate;
    const principal = index === months ? balance : loan.installment === "equal" ? annuity - interest : loan.principal / months;
    balance = Math.max(0, balance - principal);
    schedule.push({ date: addMonths(loan.startDate, index), payment: round(principal + interest, 2), principal: round(principal, 2), interest: round(interest, 2), balanceAfter: round(balance, 2) });
  }
  return schedule;
};

export type LoanState = {
  balance: number;
  paidInstallments: number;
  remainingInstallments: number;
  paidInterest: number;
  remainingInterest: number;
  nextInstallment: LoanInstallment | null;
  endDate: string;
};

export const getLoanState = (loan: WealthLoan, today: string): LoanState => {
  const schedule = buildLoanSchedule(loan);
  const paid = schedule.filter((item) => item.date <= today);
  const remaining = schedule.filter((item) => item.date > today);
  return {
    balance: paid.length ? paid[paid.length - 1].balanceAfter : round(loan.principal, 2),
    paidInstallments: paid.length,
    remainingInstallments: remaining.length,
    paidInterest: round(paid.reduce((total, item) => total + item.interest, 0), 2),
    remainingInterest: round(remaining.reduce((total, item) => total + item.interest, 0), 2),
    nextInstallment: remaining[0] ?? null,
    endDate: schedule[schedule.length - 1]?.date ?? loan.startDate,
  };
};

/** The value the wealth page uses: computed for deposits and scheduled loans, typed in otherwise. */
export const getWealthItemValue = (item: WealthItem, today: string) => {
  if (item.kind === "asset" && item.deposit) return getDepositState(item.deposit, today).value;
  if (item.kind === "liability" && item.loan) return getLoanState(item.loan, today).balance;
  return item.value;
};
