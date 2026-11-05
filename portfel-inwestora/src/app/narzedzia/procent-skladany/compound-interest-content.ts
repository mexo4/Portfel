export const EDUCATIONAL_PRINCIPAL = 1_000;
export const EDUCATIONAL_ANNUAL_RATES = [5, 7, 10] as const;
export const EDUCATIONAL_YEARS = [0, 10, 20, 30] as const;

/**
 * Illustration for a single deposit with a constant effective annual return.
 * This is separate from the calculator's monthly-contribution projection.
 */
export function compoundSingleDepositValue(
  annualRatePercent: number,
  years: number,
): number {
  const rate = annualRatePercent / 100;
  return Math.round(EDUCATIONAL_PRINCIPAL * (1 + rate) ** years);
}
