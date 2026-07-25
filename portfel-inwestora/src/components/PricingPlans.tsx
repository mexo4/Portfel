"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FREE_PLAN_PORTFOLIO_LIMIT } from "@/lib/constants";
import { updateSubscriptionPlan } from "@/lib/api";
import type { AuthenticatedUser, SubscriptionPlan } from "@/types/portfolio";

type PricingPlansProps = {
  account: AuthenticatedUser | null;
  freeLimit: number;
};

const plans: Array<{
  id: SubscriptionPlan;
  name: string;
  price: string;
  note: string;
  getFeatures: (freeLimit: number) => string[];
}> = [
  {
    id: "free",
    name: "Free",
    price: "0 zl",
    note: "Na start i mniejsze portfele.",
    getFeatures: (freeLimit) => [
      `Do ${freeLimit} pozycji`,
      `${FREE_PLAN_PORTFOLIO_LIMIT} portfel`,
      "Logowanie i zapis konta",
      "Wyceny i historia transakcji",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "29 zl / mies.",
    note: "Dla aktywnego inwestora.",
    getFeatures: () => ["Bez limitu pozycji", "Wiecej portfeli", "Benchmarki i wykresy", "Priorytet dla nowych modulow"],
  },
];

export default function PricingPlans({ account, freeLimit }: PricingPlansProps) {
  const router = useRouter();
  const [pendingPlan, setPendingPlan] = useState<SubscriptionPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePlanChange = async (plan: SubscriptionPlan) => {
    if (!account) {
      router.push("/register");
      return;
    }

    setPendingPlan(plan);
    setError(null);

    try {
      await updateSubscriptionPlan(plan);
      router.refresh();
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Nie udalo sie zapisac planu.");
    } finally {
      setPendingPlan(null);
    }
  };

  return (
    <section className="pricing-grid" aria-label="Plany">
      {plans.map((plan) => {
        const isCurrent = account?.subscriptionPlan === plan.id;
        const isPending = pendingPlan === plan.id;

        return (
          <article key={plan.id} className={plan.id === "pro" ? "pricing-card is-featured" : "pricing-card"}>
            <div>
              <p className="eyebrow">{isCurrent ? "Aktywny plan" : "Plan"}</p>
              <h2 className="pricing-title">{plan.name}</h2>
              <p className="pricing-price">{plan.id === "free" ? `0 zl / ${freeLimit} pozycji` : plan.price}</p>
              <p className="section-copy">{plan.note}</p>
            </div>

            <ul className="pricing-feature-list">
              {plan.getFeatures(freeLimit).map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>

            <button
              className={plan.id === "pro" ? "primary-button" : "ghost-button"}
              type="button"
              onClick={() => {
                void handlePlanChange(plan.id);
              }}
              disabled={isPending || isCurrent}
            >
              {isCurrent ? "Wybrany" : isPending ? "Zapisuje..." : account ? "Wybierz plan" : "Zacznij"}
            </button>
          </article>
        );
      })}

      {error ? <p className="field-note field-note-error pricing-error">{error}</p> : null}
      <p className="field-note pricing-disclaimer">
        Platnosci online sa przygotowane jako warstwa planow. Integracja operatora platnosci
        moze podmienic ten przycisk na checkout.
      </p>
      {account ? (
        <Link href="/app" className="auth-link pricing-back-link">
          Wroc do aplikacji
        </Link>
      ) : null}
    </section>
  );
}
