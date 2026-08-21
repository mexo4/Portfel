export type DashboardMutationToken = {
  scopeKey: string;
  generation: number;
};

/**
 * Keeps mutation identity independent per dashboard scope. Switching scope
 * invalidates completions from the previous view without preventing the new
 * scope from saving immediately.
 */
export const createDashboardMutationCoordinator = () => {
  let currentScopeKey = "";
  let generation = 0;
  const inFlightSaves = new Map<string, Promise<boolean>>();

  return {
    enterScope(scopeKey: string) {
      currentScopeKey = scopeKey;
      generation += 1;
      return { scopeKey, generation } satisfies DashboardMutationToken;
    },
    capture(scopeKey = currentScopeKey) {
      return { scopeKey, generation } satisfies DashboardMutationToken;
    },
    isCurrent(token: DashboardMutationToken) {
      return token.scopeKey === currentScopeKey && token.generation === generation;
    },
    getSave(scopeKey: string) {
      return inFlightSaves.get(scopeKey);
    },
    trackSave(scopeKey: string, request: Promise<boolean>) {
      inFlightSaves.set(scopeKey, request);
      const clear = () => {
        if (inFlightSaves.get(scopeKey) === request) inFlightSaves.delete(scopeKey);
      };
      void request.then(clear, clear);
      return request;
    },
    get currentScopeKey() {
      return currentScopeKey;
    },
  };
};

export type DashboardMutationCoordinator = ReturnType<typeof createDashboardMutationCoordinator>;
