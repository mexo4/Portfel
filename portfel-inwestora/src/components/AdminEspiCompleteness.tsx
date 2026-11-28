import {
  assessEspiCompleteness,
  ESPI_MISSING_REASONS,
  type EspiCompletenessCheck,
} from "@/lib/espi-completeness";

const formatTime = (value: string | undefined) => value ? `${value.slice(0, 16).replace("T", " ")} UTC` : "—";

/** Operator view: are all reports of the exchange lists in Mexo? Read-only. */
export default function AdminEspiCompleteness({ checks }: { checks: EspiCompletenessCheck[] }) {
  const assessment = assessEspiCompleteness(checks);
  const ordered = [...checks].sort((left, right) => right.checkedAt.localeCompare(left.checkedAt));

  return (
    <section className="panel admin-users-panel" aria-labelledby="espi-completeness-title">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Raporty ESPI</p>
          <h2 className="section-title" id="espi-completeness-title">Kompletność raportów</h2>
        </div>
        <p className="section-copy">
          Po każdym przejściu archiwum listy GPW i NewConnect są porównywane z zapisanymi raportami.
          Ostatnie dni raz na dobę, 12 miesięcy raz w tygodniu.
        </p>
      </div>

      <p className={assessment.level === "OK" ? "tag tag-success mt-4" : "tag mt-4"}>
        {assessment.level === "OK" ? "Bez braków" : "Wymaga uwagi"}
      </p>
      {assessment.findings.length > 0 ? (
        <ul className="field-note mt-2">
          {assessment.findings.map((finding) => <li key={finding}>{finding}</li>)}
        </ul>
      ) : null}

      {ordered.length > 0 ? (
        <div className="metric-grid mt-6">
          {ordered.map((check) => (
            <article className="metric-card" key={check.kind}>
              <span>{check.kind === "full" ? "Pełne sprawdzenie" : "Ostatnie dni"} (od {check.from})</span>
              <strong>brakuje {check.missingCount} z {check.listed}</strong>
              <span>sprawdzono {formatTime(check.checkedAt)}</span>
              <span>
                {check.markets.map((market) => `${market.market === "GPW" ? "GPW" : "NewConnect"}: ${market.listed}`).join(" · ")}
              </span>
            </article>
          ))}
        </div>
      ) : null}

      {ordered.filter((check) => check.missing.length > 0).map((check) => (
        <div key={check.kind}>
          <h3 className="admin-subtitle mt-6">
            Brakujące raporty: {check.kind === "full" ? "12 miesięcy" : "ostatnie dni"}
            {check.missingCount > check.missing.length ? ` (pierwsze ${check.missing.length} z ${check.missingCount})` : ""}
          </h3>
          <div className="admin-transaction-list">
            {check.missing.map((report) => (
              <div key={report.sourceId} className="admin-transaction-row">
                <div>
                  <a href={report.sourceUrl} target="_blank" rel="noreferrer noopener">
                    {report.issuerName}{report.reportNumber ? ` · ${report.reportNumber}` : ""}
                  </a>
                  <p className="field-note">{formatTime(report.publishedAt)}</p>
                </div>
                <p className="field-note">{ESPI_MISSING_REASONS[report.reason]}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
