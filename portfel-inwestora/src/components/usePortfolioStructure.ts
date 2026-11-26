"use client";

import { useEffect, useState } from "react";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { fetchPortfolioStructure } from "@/lib/api";
import type { PortfolioStructureResponse } from "@/lib/portfolio-structure";
import type { CurrencyCode } from "@/types/portfolio";

type State = { key: string; data: PortfolioStructureResponse | null; failed: boolean };

/** The weekly structure of the given portfolios, loaded again after a change in the account. */
export function usePortfolioStructure(portfolioIds: string[], currency: CurrencyCode) {
  const { portfolios, refreshRevision } = usePortfolioWorkspace();
  // Operations, holdings or sales added in this session change the answer.
  const revision = portfolios.map((portfolio) => `${portfolio.id}:${portfolio.updatedAt}`).join(",");
  const ids = portfolioIds.join(",");
  const key = `${ids}|${currency}|${revision}|${refreshRevision}`;
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    fetchPortfolioStructure({ portfolioScopeIds: ids.split(","), presentationCurrency: currency, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ key, data, failed: false }); })
      .catch(() => { if (!controller.signal.aborted) setState({ key, data: null, failed: true }); });
    return () => controller.abort();
  }, [currency, ids, key]);

  const current = state?.key === key ? state : null;
  return {
    data: current ? current.data : null,
    failed: Boolean(current?.failed),
    isLoading: Boolean(ids) && !current,
  };
}
