/**
 * One day's return on the money actually at work that day.
 *
 * Two things belong to that money besides yesterday's value:
 * - money paid in during the day, which may be invested the same day, so it counts from the
 *   day's start;
 * - money the history spends but never received: with deposits missing, purchases push cash
 *   below zero, and that shortfall was invested too.
 * Without them the base can be a few złoty, or below zero, and an ordinary price move turns
 * into a drawdown of tens of percent that the chain of daily returns never recovers from.
 */

/** Below this much money a percentage says nothing: a few groszy would swing it by tens of percent. */
export const MIN_DAILY_RETURN_BASE = 1;

/** A cash shortfall worth telling the user about; smaller ones come from fees and FX rounding. */
export const CASH_SHORTFALL_NOTICE_PLN = 10;

export const getDailyReturnBase = ({
  previousValue,
  previousShortfall = 0,
  externalFlow,
  shortfall = 0,
}: {
  previousValue: number;
  previousShortfall?: number;
  /** Deposits less withdrawals of the day. */
  externalFlow: number;
  shortfall?: number;
}) => previousValue + previousShortfall + Math.max(externalFlow + shortfall - previousShortfall, 0);

export const calculateDailyReturn = (result: number, base: number) => {
  if (!(base >= MIN_DAILY_RETURN_BASE)) return null;
  const value = result / base;
  return Number.isFinite(value) ? value : null;
};
