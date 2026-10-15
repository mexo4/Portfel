"use client";

import { useState } from "react";
import CorporateEventsPanel from "@/components/CorporateEventsPanel";
import DividendCalendarPanel from "@/components/DividendCalendarPanel";

type Props = {
  portfolioId: string;
  portfolioIds?: string[];
};

export default function GpwEventsWorkspace({ portfolioId, portfolioIds }: Props) {
  const [category, setCategory] = useState<"events" | "dividends">("events");
  return (
    <div className="gpw-events-workspace">
      <nav className="gpw-events-categories" aria-label="Kategorie wydarzeń GPW">
        <button type="button" className={category === "events" ? "is-active" : undefined} aria-pressed={category === "events"} onClick={() => setCategory("events")}>Raporty i terminy</button>
        <button type="button" className={category === "dividends" ? "is-active" : undefined} aria-pressed={category === "dividends"} onClick={() => setCategory("dividends")}>Kalendarz dywidend</button>
      </nav>
      {category === "events"
        ? <CorporateEventsPanel portfolioId={portfolioId} portfolioIds={portfolioIds} />
        : <DividendCalendarPanel />}
    </div>
  );
}
