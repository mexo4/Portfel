"use client";

import { useEffect, useMemo, useState } from "react";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { createPortfolioHistoryRequestDescriptor, getPortfolioHistoryCached, hasPortfolioHistoryInputs, type PortfolioHistoryRequest } from "@/lib/portfolio-history-client-cache";
import type { PortfolioHistoryResponse } from "@/types/portfolio";

type HistoryState = { signature: string; scope: string; history: PortfolioHistoryResponse | null; error: string | null };

/**
 * The portfolio history of the selected scope, from the same request (and so the same cache entry)
 * as the history Mexo prefetches when the app opens: no extra build when it is already loaded.
 */
export function useWorkspaceHistory() {
  const workspace = usePortfolioWorkspace();
  const { account, isAllPortfoliosSelected, selectedPortfolios, activePortfolio, assets, sales, effectiveRealizedAdjustments, activeBaseCurrency, refreshRevision } = workspace;

  const descriptor = useMemo(() => {
    const payload: PortfolioHistoryRequest = isAllPortfoliosSelected
      ? {
          assets,
          sales,
          realizedAdjustments: effectiveRealizedAdjustments,
          operations: [],
          accounts: [],
          benchmarks: [],
          portfolioScopes: selectedPortfolios.map((portfolio) => ({
            portfolioId: portfolio.id,
            accountType: portfolio.accountType,
            assets: portfolio.assets,
            sales: portfolio.sales,
            realizedAdjustments: portfolio.realizedAdjustments,
            operations: portfolio.operations ?? [],
            accounts: portfolio.accounts ?? [],
          })),
          presentationCurrency: activeBaseCurrency,
        }
      : {
          assets,
          sales,
          realizedAdjustments: effectiveRealizedAdjustments,
          operations: activePortfolio?.operations ?? [],
          accounts: activePortfolio?.accounts ?? [],
          accountType: activePortfolio?.accountType,
          benchmarks: activePortfolio?.benchmarks ?? [],
          presentationCurrency: activeBaseCurrency,
        };
    return createPortfolioHistoryRequestDescriptor({ userId: account.id, refreshRevision, payload });
  }, [account.id, activeBaseCurrency, activePortfolio?.accountType, activePortfolio?.accounts, activePortfolio?.benchmarks, activePortfolio?.operations, assets, effectiveRealizedAdjustments, isAllPortfoliosSelected, refreshRevision, sales, selectedPortfolios]);

  const hasInputs = hasPortfolioHistoryInputs(descriptor.payload);
  const scope = `${selectedPortfolios.map((portfolio) => portfolio.id).join(",")}|${activeBaseCurrency}`;
  const [state, setState] = useState<HistoryState | null>(null);

  useEffect(() => {
    if (!hasInputs) return;
    let cancelled = false;
    getPortfolioHistoryCached(descriptor)
      .then((history) => { if (!cancelled) setState({ signature: descriptor.key, scope, history, error: null }); })
      .catch(() => { if (!cancelled) setState({ signature: descriptor.key, scope, history: null, error: "Nie udało się pobrać historii portfela." }); });
    return () => { cancelled = true; };
  }, [descriptor, hasInputs, scope]);

  const current = state?.signature === descriptor.key ? state : null;
  // While a changed request loads (a refresh, a new operation), the previous history stays on screen.
  const history = current ? current.history : state?.scope === scope ? state.history : null;
  return {
    history,
    error: current?.error ?? null,
    isLoading: hasInputs && !history && !current,
    hasInputs,
  };
}
