/*
 * When the archive walk over the GPW and NewConnect lists is due, and how far back it goes.
 *
 * A walk over a year of lists takes about half an hour, so it is not done every day: daily the walk
 * goes back a week, or further if the last walk is older, and once a week it goes back a year.
 */

export const ESPI_FULL_WALK_DAYS = 370;
export const ESPI_RECENT_WALK_DAYS = 7;
/** Days walked again before the last successful walk, in case something was published late. */
const OVERLAP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1_000;
const FULL_WALK_EVERY_MS = 7 * DAY_MS;
/** A walk that failed is not repeated at once: the sync runs every few minutes. */
export const ESPI_FAILED_WALK_RETRY_MS = 2 * 60 * 60 * 1_000;

export type EspiWalkPlan = { kind: "full" | "recent"; from: string };

const shiftDay = (isoDate: string, days: number) =>
  new Date(Date.parse(`${isoDate}T12:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

export const planEspiWalk = ({ now, today, force, lastWalkAt, lastFullWalkAt, lastFailedWalkAt }: {
  now: number;
  /** The date in Warsaw, YYYY-MM-DD. */
  today: string;
  /** Asked for by an administrator: a walk happens now, whatever the clocks say. */
  force: boolean;
  lastWalkAt?: string | null;
  lastFullWalkAt?: string | null;
  lastFailedWalkAt?: string | null;
}): EspiWalkPlan | null => {
  const age = (value: string | null | undefined) => (value ? now - Date.parse(value) : Number.POSITIVE_INFINITY);
  const fullDue = age(lastFullWalkAt) >= FULL_WALK_EVERY_MS;
  if (!force && !fullDue && age(lastWalkAt) < DAY_MS) return null;
  if (!force && age(lastFailedWalkAt) < ESPI_FAILED_WALK_RETRY_MS) return null;

  const yearAgo = shiftDay(today, -ESPI_FULL_WALK_DAYS);
  if (fullDue) return { kind: "full", from: yearAgo };
  const weekAgo = shiftDay(today, -ESPI_RECENT_WALK_DAYS);
  // After a longer break the walk reaches back to where the last one ended.
  const sinceLast = lastWalkAt ? shiftDay(lastWalkAt.slice(0, 10), -OVERLAP_DAYS) : yearAgo;
  const from = sinceLast < weekAgo ? sinceLast : weekAgo;
  return { kind: "recent", from: from < yearAgo ? yearAgo : from };
};
