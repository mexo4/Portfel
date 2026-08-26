"use client";

import Link from "next/link";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";

/** Import only needs the shared workspace state and its lazily loaded panel. */
export default function WorkspaceImportView() {
  const workspace = usePortfolioWorkspace();

  return (
    <div className="workspace-page workspace-import-page">
      <section className="workspace-page-actions">
        <p>
          {workspace.isAllPortfoliosSelected
            ? "Import wymaga wskazania jednego portfela docelowego."
            : "Import tworzy rzeczywiste operacje w aktywnym portfelu. Kurs bieżący nie blokuje zapisu transakcji."}
        </p>
        <Link
          href={workspace.isAllPortfoliosSelected ? "/portfolios" : "/portfolio/positions"}
          className="ghost-button"
        >
          {workspace.isAllPortfoliosSelected ? "Wybierz portfel" : "Wróć do pozycji"}
        </Link>
      </section>
      {workspace.isAllPortfoliosSelected ? null : workspace.importWorkspace}
    </div>
  );
}
