import {
  assessGpwCalendarHealth,
  describeGpwReviewCode,
  type GpwCalendarHealth,
} from "@/lib/gpw-calendar-health";

const LANE_LABELS = { reports: "Raporty okresowe", meetings: "Walne zgromadzenia", dividends: "Dywidendy" } as const;
const LEVEL_LABELS = { OK: "Bez uwag", ATTENTION: "Wymaga uwagi", DEGRADED: "Dane niespójne" } as const;
const REPORT_TYPE_LABELS: Record<string, string> = {
  QUARTERLY_REPORT: "kwartalny", HALF_YEAR_REPORT: "półroczny", ANNUAL_REPORT: "roczny",
};

const formatDate = (value: string | null | undefined) => value ? value.slice(0, 10) : "—";

/** Operator view of the GPW events calendar: backlog, review queue and row invariants. Read-only. */
export default function AdminGpwCalendarHealth({ health }: { health: GpwCalendarHealth }) {
  const assessment = assessGpwCalendarHealth(health);

  return (
    <section className="panel admin-users-panel" aria-labelledby="gpw-calendar-health-title">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Kalendarz GPW</p>
          <h2 className="section-title" id="gpw-calendar-health-title">Stan danych kalendarza wydarzeń</h2>
        </div>
        <p className="section-copy">
          Odczyt bez zapisu. Wersja projekcji raportów {health.lanes.find((lane) => lane.lane === "reports")?.version},
          stan na {health.generatedAt.slice(0, 16).replace("T", " ")} UTC. Liczby nie dowodzą kompletności rynku.
        </p>
      </div>

      <p className={assessment.level === "OK" ? "tag tag-success mt-4" : "tag mt-4"}>
        {LEVEL_LABELS[assessment.level]}
      </p>
      {assessment.findings.length > 0 ? (
        <ul className="field-note mt-2">
          {assessment.findings.map((finding) => <li key={finding}>{finding}</li>)}
        </ul>
      ) : null}

      <div className="metric-grid mt-6">
        {health.lanes.map((lane) => (
          <article className="metric-card" key={lane.lane}>
            <span>{LANE_LABELS[lane.lane]} (wersja {lane.version})</span>
            <strong>{lane.projected} odczytanych</strong>
            <span>
              do ponownej oceny: {lane.staleVersion}
              {lane.oldestStalePublishedAt ? ` (najstarszy z ${formatDate(lane.oldestStalePublishedAt)})` : ""}
            </span>
            <span>przegląd: {lane.reviewRequired} · błędy: {lane.parseError} · bez dopasowania: {lane.unmatched}</span>
          </article>
        ))}
        <article className="metric-card">
          <span>Aktywne wiersze raportów</span>
          <strong>{health.rows.activeReportRows}</strong>
          <span>
            bez okresu lub roku: {health.rows.incompleteIdentity} (w tym oznaczone „do weryfikacji”: {health.rows.incompleteIdentityMarkedUnverified})
          </span>
          <span>
            ten sam termin, dwie etykiety: {health.rows.sameTypeAndDateWithDifferentIdentities} · ten sam raport, kilka dat: {health.rows.oneIdentityOnSeveralDates}
          </span>
        </article>
        <article className="metric-card">
          <span>Wycofane wiersze od {formatDate(health.retirements.since)}</span>
          <strong>{health.retirements.total}</strong>
          {health.retirements.byReason.slice(0, 4).map((entry) => (
            <span key={entry.reason}>{entry.reason.replace("REPORT_SCHEDULE_REPROJECTION:", "")}: {entry.count}</span>
          ))}
        </article>
        <article className="metric-card">
          <span>Źródło</span>
          <strong>{health.source.status}</strong>
          <span>
            ostatni sukces: {formatDate(health.source.lastSuccessAt)} · archiwum {health.source.backfillComplete ? "kompletne" : `uzupełniane (strona ${health.source.nextBackfillPage})`}
          </span>
        </article>
      </div>

      <h3 className="admin-subtitle mt-6">Kolejka przeglądu ({health.reviewQueue.documents})</h3>
      {health.reviewQueue.items.length === 0 ? (
        <p className="field-note">Brak dokumentów wymagających przeglądu.</p>
      ) : (
        <div className="admin-transaction-list">
          {health.reviewQueue.items.map((document) => (
            <div key={document.sourceId} className="admin-transaction-row">
              <div>
                <a href={document.sourceUrl} target="_blank" rel="noreferrer noopener">{document.title}</a>
                <p className="field-note">{document.issuerName ?? "emitent nieustalony"} · {formatDate(document.publishedAt)}</p>
              </div>
              <ul className="field-note">
                {document.entries.map((entry, index) => (
                  <li key={`${entry.code}-${entry.eventDate ?? ""}-${index}`}>
                    {describeGpwReviewCode(entry.code)}
                    {entry.eventType ? ` — raport ${REPORT_TYPE_LABELS[entry.eventType] ?? entry.eventType} ${[entry.fiscalPeriod, entry.fiscalYearLabel].filter(Boolean).join(" ")} ${entry.eventDate ?? ""}` : ""}
                    {entry.published === true ? " (widoczny w kalendarzu bez roku)" : entry.published === false ? " (wstrzymany)" : ""}
                    {entry.rowIds?.length ? ` — ${entry.rowIds.length} wierszy` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
