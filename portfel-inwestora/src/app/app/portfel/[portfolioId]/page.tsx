import { redirect } from "next/navigation";
import PortfolioApp from "@/components/PortfolioApp";
import { isAdminEmail } from "@/lib/server/access";
import { requireCurrentAccountData } from "@/lib/server/auth";

type PortfolioPageProps = {
  params: Promise<{
    portfolioId: string;
  }>;
};

export default async function PortfolioPage({ params }: PortfolioPageProps) {
  const accountData = await requireCurrentAccountData();
  const { portfolioId } = await params;
  const activePortfolioId = accountData.portfolios.some(
    (portfolio) => portfolio.id === portfolioId
  )
    ? portfolioId
    : accountData.activePortfolioId;

  if (activePortfolioId !== portfolioId) {
    redirect(`/app/portfel/${activePortfolioId}`);
  }

  return (
    <PortfolioApp
      initialAssets={accountData.assets}
      initialSales={accountData.sales}
      initialRealizedAdjustments={accountData.realizedAdjustments}
      initialPortfolios={accountData.portfolios}
      initialActivePortfolioId={activePortfolioId}
      initialProfile={accountData.profile}
      account={accountData.user}
      isAdmin={isAdminEmail(accountData.user.email)}
    />
  );
}
