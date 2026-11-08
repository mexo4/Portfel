"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PLAN_DEFINITIONS } from "@/lib/entitlements";
import { FREE_PLAN_PORTFOLIO_LIMIT } from "@/lib/constants";
import { updateSubscriptionPlan } from "@/lib/api";
import type { AuthenticatedUser, SubscriptionPlan } from "@/types/portfolio";

type PricingPlansProps = {
  account: AuthenticatedUser | null;
  freeLimit: number;
};

const plans = Object.values(PLAN_DEFINITIONS);

const formatPrice = (price: number) => new Intl.NumberFormat("pl-PL", {
  style: "currency", currency: "PLN", minimumFractionDigits: 2,
}).format(price);

const getConfirmedFeatures = (planId: SubscriptionPlan, freeLimit: number) => {
  if (planId === "free") return [
    `Do ${freeLimit} pozycji na portfel`,
    `${FREE_PLAN_PORTFOLIO_LIMIT} portfel`,
    "Zapisywanie wycen i historii transakcji",
  ];
  if (planId === "pro") return [
    "Dotychczasowe konto Pro zachowuje zapisane dane",
    "Brak limitu pozycji znanego z dawnej obsługi Pro",
    "Zakres funkcji nowego planu wymaga decyzji produktowej",
  ];
  return ["Szczegółowy zakres funkcji i limity oczekują na zatwierdzenie produktu"];
};

export default function PricingPlans({ account, freeLimit }: PricingPlansProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectFreePlan = async () => {
    if (!account) {
      router.push("/register");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await updateSubscriptionPlan("free");
      router.refresh();
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Nie udało się zmienić planu.");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="pricing-grid" aria-label="Plany abonamentowe">
      {plans.map((plan) => {
        const isCurrent = account?.subscriptionPlan === plan.id;
        const paid = plan.pricePln > 0;
        return (
          <article key={plan.id} className={plan.id === "pro" ? "pricing-card is-featured" : "pricing-card"}>
            <div>
              <p className="eyebrow">{isCurrent ? "Plan przypisany do konta" : "Plan"}</p>
              <h2 className="pricing-title">{plan.name}</h2>
              <p className="pricing-price">{formatPrice(plan.pricePln)}{paid ? " / 30 dni" : ""}</p>
              <p className="section-copy">{paid ? "Cena docelowa. Samodzielny zakup nie jest jeszcze dostępny." : "Aktualnie dostępny plan bezpłatny."}</p>
            </div>
            <ul className="pricing-feature-list">
              {getConfirmedFeatures(plan.id, freeLimit).map((feature) => <li key={feature}>{feature}</li>)}
              {paid ? <li>Funkcje i limity: decyzja produktowa w toku</li> : null}
            </ul>
            {paid ? (
              <button className="ghost-button" type="button" disabled aria-disabled="true">
                Niedostępny do zakupu
              </button>
            ) : (
              <button
                className="primary-button"
                type="button"
                onClick={() => void selectFreePlan()}
                disabled={pending || isCurrent}
              >
                {isCurrent ? "Aktywny plan" : pending ? "Zapisuję…" : account ? "Wybierz Free" : "Załóż darmowe konto"}
              </button>
            )}
          </article>
        );
      })}
      {error ? <p className="field-note field-note-error pricing-error">{error}</p> : null}
      <p className="field-note pricing-disclaimer">
        Ceny planów płatnych są konfiguracją docelową. Zakres Basic, Standard i Expert wymaga zatwierdzenia,
        a płatności nie są wdrożone. Administrator może nadać dostęp czasowo; użytkownik nie może sam aktywować planu.
      </p>
      {account ? <Link href="/app" className="auth-link pricing-back-link">Wróć do aplikacji</Link> : null}
    </section>
  );
}
