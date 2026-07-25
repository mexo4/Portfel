import Link from "next/link";
import PricingPlans from "@/components/PricingPlans";
import { FREE_PLAN_ASSET_LIMIT } from "@/lib/constants";
import { getCurrentAccountData } from "@/lib/server/auth";

export default async function PricingPage() {
  const accountData = await getCurrentAccountData();

  return (
    <main className="marketing-shell">
      <nav className="marketing-nav" aria-label="Nawigacja">
        <Link href="/" className="brand-link">
          Portfel Inwestora
        </Link>
        <div className="marketing-nav-actions">
          <Link href={accountData ? "/app" : "/login"} className="ghost-button">
            {accountData ? "Aplikacja" : "Logowanie"}
          </Link>
        </div>
      </nav>

      <section className="pricing-hero">
        <p className="eyebrow">Monetyzacja</p>
        <h1>Prosty cennik dla rosnacego portfela</h1>
        <p>
          Free daje bezpieczny start, Pro zdejmie limit pozycji i porzadkuje miejsce
          pod przyszla platnosc online.
        </p>
      </section>

      <PricingPlans account={accountData?.user ?? null} freeLimit={FREE_PLAN_ASSET_LIMIT} />
    </main>
  );
}
