"use client";

import { useState } from "react";
import CorporateEventsPanel from "@/components/CorporateEventsPanel";
import DividendCalendarPanel from "@/components/DividendCalendarPanel";
import PublicCalendarSubscription from "@/components/PublicCalendarSubscription";

type Props = {
  portfolioId: string;
  portfolioIds?: string[];
};

export default function GpwEventsWorkspace({ portfolioId, portfolioIds }: Props) {
  const [category, setCategory] = useState<"reports" | "meetings" | "dividends" | "subscriptions">("reports");
  return (
    <div className="gpw-events-workspace">
      <nav className="gpw-events-categories" aria-label="Kategorie wydarzeń GPW">
        <button type="button" className={category === "reports" ? "is-active" : undefined} aria-pressed={category === "reports"} onClick={() => setCategory("reports")}>Raporty</button>
        <button type="button" className={category === "meetings" ? "is-active" : undefined} aria-pressed={category === "meetings"} onClick={() => setCategory("meetings")}>Walne zgromadzenia</button>
        <button type="button" className={category === "dividends" ? "is-active" : undefined} aria-pressed={category === "dividends"} onClick={() => setCategory("dividends")}>Kalendarz dywidend</button>
        <button type="button" className={category === "subscriptions" ? "is-active" : undefined} aria-pressed={category === "subscriptions"} onClick={() => setCategory("subscriptions")}>Subskrypcje kalendarza</button>
      </nav>
      {category === "reports"
        ? <CorporateEventsPanel portfolioId={portfolioId} portfolioIds={portfolioIds} variant="reports" />
        : category === "meetings"
          ? <CorporateEventsPanel portfolioId={portfolioId} portfolioIds={portfolioIds} variant="general-meetings" />
        : category === "dividends"
          ? <DividendCalendarPanel />
          : <PublicCalendarSubscription embedded />}
    </div>
  );
}
