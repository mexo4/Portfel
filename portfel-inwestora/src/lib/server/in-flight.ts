/**
 * Lets concurrent callers that ask for the same key share one running
 * computation instead of each starting their own.
 *
 * The entry exists only while the computation runs: once it settles, success or
 * failure, the next caller starts a fresh one, so a failure is never replayed
 * and nothing stays in memory.
 */
export const createInFlightDeduper = <T>() => {
  const pending = new Map<string, Promise<T>>();

  return (key: string, run: () => Promise<T>): Promise<T> => {
    const running = pending.get(key);
    if (running) return running;

    const started = run().finally(() => {
      pending.delete(key);
    });
    pending.set(key, started);

    return started;
  };
};
