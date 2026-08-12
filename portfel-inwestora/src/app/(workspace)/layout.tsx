import PortfolioApp from "@/components/PortfolioApp";
import { isAdminEmail } from "@/lib/server/access";
import { requireCurrentAccountData } from "@/lib/server/auth";
import type { ReactNode } from "react";

type WorkspaceLayoutProps = Readonly<{ children: ReactNode }>;

/**
 * This layout intentionally owns the single client-side portfolio workspace.
 * App Router keeps layouts mounted while users move between workspace routes,
 * so quote/FX refresh state and the selected portfolio are never duplicated.
 */
export default async function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const accountData = await requireCurrentAccountData();

  return <PortfolioApp initialAssets={accountData.assets} initialSales={accountData.sales} initialRealizedAdjustments={accountData.realizedAdjustments} initialPortfolios={accountData.portfolios} initialActivePortfolioId={accountData.activePortfolioId} initialPortfolioRevision={accountData.portfolioRevision} initialProfile={accountData.profile} account={accountData.user} isAdmin={isAdminEmail(accountData.user.email)}>{children}</PortfolioApp>;
}
