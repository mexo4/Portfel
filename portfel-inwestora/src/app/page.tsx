import PortfolioApp from "@/components/PortfolioApp";
import { requireCurrentAccountData } from "@/lib/server/auth";

export default async function HomePage() {
  const accountData = await requireCurrentAccountData();

  return (
    <PortfolioApp
      initialAssets={accountData.assets}
      initialSales={accountData.sales}
      account={accountData.user}
    />
  );
}
