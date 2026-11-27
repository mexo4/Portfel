/**
 * Which prices a history uses.
 * - "traded": what the instrument cost on the exchange, only restated for splits. Holdings are
 *   valued at it, because their dividends are recorded as cash; a dividend-adjusted price would
 *   count each dividend a second time.
 * - "total-return": also restated for dividends, as if they had been reinvested. Benchmarks use
 *   it, so a portfolio that collects dividends is compared on equal terms.
 */
export type PriceBasis = "traded" | "total-return";

/**
 * A day-to-day change of the adjusted/raw ratio this large is a split. An ordinary dividend moves
 * it by a few percent; the smallest usual split, 3:2, moves it by half.
 */
const SPLIT_RATIO_JUMP = 1.35;

/** Usual split ratios; a dividend on the split day moves the measured ratio a little off them. */
const COMMON_SPLITS = [1.5, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 25, 50, 100];

const snapToSplit = (jump: number) => {
  const size = jump >= 1 ? jump : 1 / jump;
  const common = COMMON_SPLITS.find((ratio) => Math.abs(size / ratio - 1) < 0.03);
  const snapped = common ?? size;
  return jump >= 1 ? snapped : 1 / snapped;
};

/**
 * EODHD's raw close is not restated for splits, and its adjusted close also removes dividends.
 * This keeps the raw close and restates it only for splits, which show as a jump between the two.
 * `rows` must be oldest first.
 */
export const toSplitAdjustedCloses = (rows: Array<{ date: string; close: number; adjustedClose?: number }>) => {
  const ratio = (row: { close: number; adjustedClose?: number }) =>
    row.adjustedClose && row.adjustedClose > 0 && row.close > 0 ? row.adjustedClose / row.close : null;
  const result: Array<{ date: string; close: number }> = new Array(rows.length);
  let divisor = 1;

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    result[index] = { date: row.date, close: row.close / divisor };
    const previous = index > 0 ? rows[index - 1]! : null;
    const here = ratio(row);
    const before = previous ? ratio(previous) : null;
    if (here === null || before === null) continue;
    const jump = here / before;
    if (jump >= SPLIT_RATIO_JUMP || jump <= 1 / SPLIT_RATIO_JUMP) divisor *= snapToSplit(jump);
  }

  return result;
};
