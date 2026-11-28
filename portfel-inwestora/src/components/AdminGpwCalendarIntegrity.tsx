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
        <>
          <h3 className="admin-subtitle mt-6">Daty dywidend z komunikatów, których nie ma w kalendarzu</h3>
          <div className="admin-transaction-list">
            {dividends.missing.map((row) => (
              <div key={row.sourceUrl} className="admin-transaction-row">
                <a href={row.sourceUrl} target="_blank" rel="noreferrer noopener">{row.issuer}</a>
                <p className="field-note">komunikat z {row.publishedAt.slice(0, 10)} · brak dni: {row.days.join(", ")}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {dividends.unsupported.length > 0 ? (
        <>
          <h3 className="admin-subtitle mt-6">Dywidendy wskazujące komunikat bez ich dat</h3>
          <div className="admin-transaction-list">
            {dividends.unsupported.map((row) => (
              <div key={`${row.sourceUrl}-${row.recordDate}-${row.paymentDate}`} className="admin-transaction-row">
                <a href={row.sourceUrl} target="_blank" rel="noreferrer noopener">{row.issuer}</a>
                <p className="field-note">dzień dywidendy {row.recordDate ?? "—"} · wypłata {row.paymentDate ?? "—"}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {reportRows.length > 0 ? (
        <>
          <h3 className="admin-subtitle mt-6">Raporty opublikowane poza dniem z kalendarza</h3>
          <div className="admin-transaction-list">
            {reportRows.map((row) => (
              <div key={row.sourceUrl} className="admin-transaction-row">
                <a href={row.sourceUrl} target="_blank" rel="noreferrer noopener">{row.issuer}</a>
                <p className="field-note">
                  raport {REPORT_TYPE_LABELS[row.reportType] ?? row.reportType} opublikowany {row.publishedOn} · {row.label}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
