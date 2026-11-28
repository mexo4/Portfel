/*
 * Fetches ESPI reports on its own, so they arrive without anyone opening the ESPI page. It runs in
 * the production Next.js server (started from instrumentation.ts). The synchronization decides
 * itself whether anything is due, and its database lock keeps one run at a time, also next to a run
 * that a visit or an administrator started.
 */

const FIRST_RUN_DELAY_MS = 60_000;
/** Counted from the end of a run: a long archive walk is not interrupted by the next tick. */
const RUN_EVERY_MS = 10 * 60_000;

type SchedulerEnvironment = Partial<Record<"NODE_ENV" | "NEXT_PHASE" | "DATABASE_URL" | "MEXO_ESPI_SCHEDULER", string>>;

/** On only in a running production server with a database; MEXO_ESPI_SCHEDULER=off turns it off. */
export const isEspiSchedulerEnabled = (environment: SchedulerEnvironment) =>
  environment.NODE_ENV === "production" &&
  environment.NEXT_PHASE !== "phase-production-build" &&
  Boolean(environment.DATABASE_URL) &&
  environment.MEXO_ESPI_SCHEDULER !== "off";

declare global {
  var mexoEspiSchedulerStarted: boolean | undefined;
}

export const startEspiScheduler = ({
  environment = process.env as SchedulerEnvironment,
  synchronize,
  schedule = (task: () => void, delayMs: number) => { setTimeout(task, delayMs).unref(); },
}: {
  environment?: SchedulerEnvironment;
  synchronize: () => Promise<unknown>;
  schedule?: (task: () => void, delayMs: number) => void;
}) => {
  if (!isEspiSchedulerEnabled(environment) || globalThis.mexoEspiSchedulerStarted) return false;
  globalThis.mexoEspiSchedulerStarted = true;
  const run = async () => {
    try {
      await synchronize();
    } catch (error) {
      console.warn(`[ESPI SCHEDULER] run failed: ${error instanceof Error ? error.name : "unknown"}`);
    } finally {
      schedule(() => void run(), RUN_EVERY_MS);
    }
  };
  schedule(() => void run(), FIRST_RUN_DELAY_MS);
  console.info("[ESPI SCHEDULER] started");
  return true;
};
