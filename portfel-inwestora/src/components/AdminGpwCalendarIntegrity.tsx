import { assessGpwCalendarIntegrity, type GpwCalendarIntegrity } from "@/lib/gpw-calendar-integrity";

const REPORT_TYPE_LABELS: Record<string, string> = {
  QUARTERLY_REPORT: "kwartalny", HALF_YEAR_REPORT: "półroczny", ANNUAL_REPORT: "roczny",
};

/** The GPW calendar checked against the notices and the reports that came out. Read-only. */
export default function AdminGpwCalendarIntegrity({ integrity }: { integrity: GpwCalendarIntegrity }) {
  const assessment = assessGpwCalendarIntegrity(integrity);
  const { dividends, reports } = integrity;
  const reportRows = [
    ...reports.differentDay.map((row) => ({ ...row, label: `w kalendarzu ${row.calendarDate}` })),
    ...reports.notInCalendar.map((row) => ({ ...row, label: "bez terminu w kalendarzu" })),
  ];

  return (
    <section className="panel admin-users-panel" aria-labelledby="gpw-calendar-integrity-title">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Kalendarz GPW</p>
          <h2 className="section-title" id="gpw-calendar-integrity-title">Kontrola z komunikatami</h2>
        </div>
        <p className="section-copy">
          Porównanie bez reguł parsera: daty z treści komunikatów o dywidendach i dni faktycznej publikacji raportów.
        </p>
      </div>

      <p className={assessment.level === "OK" ? "tag tag-success mt-4" : "tag mt-4"}>
        {assessment.level === "OK" ? "Bez uwag" : "Wymaga uwagi"}
      </p>
      {assessment.findings.length > 0 ? (
        <ul className="field-note mt-2">
          {assessment.findings.map((finding) => <li key={finding}>{finding}</li>)}
        </ul>
      ) : null}

      <div className="metric-grid mt-6">
        <article className="metric-card">
          <span>Komunikaty o dywidendach (120 dni)</span>
          <strong>{dividends.noticesChecked}</strong>
          <span>z przyszłą datą, której brak w kalendarzu: {dividends.missing.length}</span>
        </article>
        <article className="metric-card">
          <span>Nadchodzące dywidendy z komunikatem</span>
          <strong>{dividends.eventsChecked}</strong>
          <span>komunikat bez ich dat: {dividends.unsupported.length}</span>
        </article>
        <article className="metric-card">
          <span>Raporty okresowe od {reports.since}</span>
          <strong>{reports.onCalendarDay} / {reports.published}</strong>
          <span>w dniu z kalendarza · inny dzień: {reports.differentDay.length} · bez terminu: {reports.notInCalendar.length}</span>
        </article>
      </div>

      {dividends.missing.length > 0 ? (
        <div className="mt-6">
          <h3 className="admin-subtitle">Daty dywidend z komunikatów, których nie ma w kalendarzu</h3>
          <ul className="espi-missing-list">
            {dividends.missing.map((row) => (
              <li key={row.sourceUrl}>
                <div>
                  <a href={row.sourceUrl} target="_blank" rel="noreferrer noopener">{row.issuer}</a>
                  <span className="field-note">komunikat z {row.publishedAt.slice(0, 10)}</span>
                </div>
                <span className="field-note">brak w kalendarzu: {row.days.join(", ")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {dividends.unsupported.length > 0 ? (
        <div className="mt-6">
          <h3 className="admin-subtitle">Dywidendy wskazujące komunikat bez ich dat</h3>
          <ul className="espi-missing-list">
            {dividends.unsupported.map((row) => (
              <li key={`${row.sourceUrl}-${row.recordDate}-${row.paymentDate}`}>
                <div>
                  <a href={row.sourceUrl} target="_blank" rel="noreferrer noopener">{row.issuer}</a>
                </div>
                <span className="field-note">dzień dywidendy {row.recordDate ?? "—"} · wypłata {row.paymentDate ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reportRows.length > 0 ? (
        <div className="mt-6">
          <h3 className="admin-subtitle">Raporty opublikowane poza dniem z kalendarza</h3>
          <ul className="espi-missing-list">
            {reportRows.map((row) => (
              <li key={row.sourceUrl}>
                <div>
                  <a href={row.sourceUrl} target="_blank" rel="noreferrer noopener">{row.issuer}</a>
                  <span className="field-note">raport {REPORT_TYPE_LABELS[row.reportType] ?? row.reportType} opublikowany {row.publishedOn}</span>
                </div>
                <span className="field-note">{row.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
