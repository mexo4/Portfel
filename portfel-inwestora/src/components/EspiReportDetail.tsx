"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { fetchEspiReport } from "@/lib/api";
import { ESPI_CATEGORY_LABELS, ESPI_REPORT_TYPE_LABELS, type EspiReport } from "@/lib/espi";

const formatDateTime = (value: string) => new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
}).format(new Date(value));

export default function EspiReportDetail({ reportId }: { reportId: string }) {
  const workspace = usePortfolioWorkspace();
  const [report, setReport] = useState<EspiReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchEspiReport(reportId, controller.signal)
      .then(setReport)
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "Nie udało się odczytać raportu ESPI.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [reportId]);

  if (isLoading) return <div className="workspace-page"><section className="panel espi-detail-state">Wczytywanie raportu ESPI…</section></div>;
  if (error || !report) return <div className="workspace-page"><section className="panel espi-detail-state"><p className="eyebrow">Błąd aplikacji</p><h2 className="section-title">Nie udało się otworzyć raportu.</h2><p className="section-copy">{error}</p><Link className="ghost-button" href={workspace.getReadHref("/market/espi")}>Wróć do raportów</Link></section></div>;

  return (
    <div className="workspace-page espi-detail-page">
      <Link className="espi-detail-back" href={workspace.getReadHref("/market/espi")}>← Wszystkie raporty</Link>
      <article className="panel espi-detail-card">
        <header>
          <div className="espi-detail-issuer"><p className="eyebrow">{report.ticker ?? "GPW"}</p><h2>{report.issuerName}</h2></div>
          <div className="espi-detail-meta"><strong>{ESPI_REPORT_TYPE_LABELS[report.reportType]}{report.reportNumber ? ` nr ${report.reportNumber}` : ""}</strong><time dateTime={report.publishedAt}>{formatDateTime(report.publishedAt)}</time></div>
          <div className="espi-report-badges"><span className={`espi-category-badge espi-category-badge--${report.category.toLowerCase()}`}>{ESPI_CATEGORY_LABELS[report.category]}</span>{report.isCorrection ? <span className="espi-correction-badge">KOREKTA</span> : null}</div>
          {report.isCorrection && report.correctionTargetReportNumber ? (
            <p className="espi-correction-reference">
              Korekta raportu nr {report.correctionOfReportId
                ? <Link href={workspace.getReadHref(`/market/espi/${report.correctionOfReportId}`)}>{report.correctionTargetReportNumber}</Link>
                : report.correctionTargetReportNumber}
            </p>
          ) : null}
          <h1>{report.title}</h1>
          {report.legalBasis ? <p className="espi-legal-basis">{report.legalBasis}</p> : null}
        </header>
        <div className="espi-report-body">{report.body.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={`${index}:${paragraph.slice(0, 24)}`}>{paragraph}</p>)}</div>
        {report.attachments.length ? <section className="espi-attachments"><p className="eyebrow">Załączniki</p><div>{report.attachments.map((attachment) => <a key={attachment.id} href={attachment.sourceUrl} target="_blank" rel="noreferrer"><span aria-hidden="true">↧</span><strong>{attachment.name}</strong><small>{[attachment.mediaType, attachment.sizeLabel].filter(Boolean).join(" · ")}</small></a>)}</div></section> : null}
        <footer><span>Źródło: PAP MediaRoom / ESPI</span><a href={report.sourceUrl} target="_blank" rel="noreferrer">Otwórz źródło →</a></footer>
      </article>
    </div>
  );
}
