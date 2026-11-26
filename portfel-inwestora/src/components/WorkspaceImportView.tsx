"use client";

import Link from "next/link";
import PortfolioChooser from "@/components/PortfolioChooser";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";

/** Import only needs the shared workspace state and its lazily loaded panel. */
export default function WorkspaceImportView() {
  const workspace = usePortfolioWorkspace();

  if (workspace.isAllPortfoliosSelected) {
    return (
      <div className="workspace-page workspace-import-page">
        <section className="panel">
          <h2 className="section-title">Do którego portfela zaimportować plik?</h2>
          <p className="section-copy">Import trafia do jednego portfela. Po wyborze zostaniesz na tej stronie.</p>
          <PortfolioChooser label="Portfel docelowy:" />
        </section>
      </div>
    );
  }

  return (
    <div className="workspace-page workspace-import-page">
      <section className="workspace-page-actions">
        <p>Import tworzy rzeczywiste operacje w aktywnym portfelu. Kurs bieżący nie blokuje zapisu transakcji.</p>
        <Link href={workspace.getReadHref("/portfolio/positions")} className="ghost-button">
          Wróć do pozycji
        </Link>
      </section>
      {workspace.importWorkspace}
    </div>
  );
}
