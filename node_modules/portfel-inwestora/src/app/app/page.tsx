import PortfolioApp from "@/components/PortfolioApp";
import { requireCurrentAccountData } from "@/lib/server/auth";
import { isAdminEmail } from "@/lib/server/access";

export default async function AppPage() {
  const accountData = await requireCurrentAccountData();

  return (
    <PortfolioApp
      initialAssets={accountData.assets}
      initialSales={accountData.sales}
      initialRealizedAdjustments={accountData.realizedAdjustments}
      initialPortfolios={accountData.portfolios}
      initialActivePortfolioId={accountData.activePortfolioId}
      account={accountData.user}
      isAdmin={isAdminEmail(accountData.user.email)}
    />
  );
}
