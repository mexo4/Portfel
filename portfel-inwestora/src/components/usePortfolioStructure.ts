"use client";

import { useEffect, useMemo, useState } from "react";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { fetchPortfolioStructure } from "@/lib/api";
import type { PortfolioStructureResponse } from "@/lib/portfolio-structure";
import type { CurrencyCode } from "@/types/portfolio";

type State = { key: string; scope: string; data: PortfolioStructureResponse | null; failed: boolean };

/**
 * The weekly structure of the given portfolios. It is loaded again after holdings, sales or
 * operations change, not on every quote refresh, and the previous answer stays on screen meanwhile.
 */
export function usePortfolioStructure(portfolioIds: string[], currency: CurrencyCode) {
  const { portfolios, refreshRevision } = usePortfolioWorkspace();
  const revision = useMemo(
    () => portfolios.map((portfolio) => [
      portfolio.id,
      portfolio.assets.map((asset) => `${asset.id}:${asset.quantity}`).join(","),
      portfolio.sales.length,
      portfolio.realizedAdjustments.length,
      (portfolio.operations ?? []).length,
    ].join("/")).join("|"),
    [portfolios]
  );
  const ids = portfolioIds.join(",");
  const scope = `${ids}|${currency}`;
  const key = `${scope}|${revision}|${refreshRevision}`;
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    if (!ids) return;
    const controller = new AbortController();
    fetchPortfolioStructure({ portfolioScopeIds: ids.split(","), presentationCurrency: currency, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ key, scope: `${ids}|${currency}`, data, failed: false }); })
      .catch(() => { if (!controller.signal.aborted) setState({ key, scope: `${ids}|${currency}`, data: null, failed: true }); });
    return () => controller.abort();
  }, [currency, ids, key]);

  const current = state?.key === key ? state : null;
  const data = current ? current.data : state?.scope === scope ? state.data : null;
  return {
    data,
    failed: Boolean(current?.failed),
    isLoading: Boolean(ids) && !data && !current,
  };
}
