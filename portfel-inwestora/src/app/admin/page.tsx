import Link from "next/link";
import { notFound } from "next/navigation";
import AdminEspiCompleteness from "@/components/AdminEspiCompleteness";
import AdminGpwCalendarHealth from "@/components/AdminGpwCalendarHealth";
import AdminGpwCalendarIntegrity from "@/components/AdminGpwCalendarIntegrity";
import AdminUsersPanel from "@/components/AdminUsersPanel";
import { getAdminDashboardData } from "@/lib/server/admin";
import { getEspiCompletenessChecks } from "@/lib/server/espi";
import { getGpwCalendarHealth } from "@/lib/server/gpw-calendar-health";
import { getGpwCalendarIntegrity } from "@/lib/server/gpw-calendar-integrity";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const dashboard = await getAdminDashboardData();

  if (!dashboard) {
    notFound();
  }

  // Read-only and optional: the admin panel must keep working when the calendar tables cannot be read.
  const calendarHealth = await getGpwCalendarHealth().catch(() => null);
  const espiChecks = await getEspiCompletenessChecks().catch(() => null);
  const calendarIntegrity = await getGpwCalendarIntegrity().catch(() => null);

  return (
    <main className="page-shell">
      <div className="page-grid admin-shell">
        <section className="panel panel-compact">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="eyebrow">Admin</p>
              <h1 className="section-title">Panel administracyjny</h1>
              <p className="section-copy">
                Prywatny widok kont, planów, sesji i danych portfeli zapisanych w aplikacji.
              </p>
            </div>

            <div className="summary-actions">
              <Link className="ghost-button" href="/app">
                Wróć do aplikacji
              </Link>
            </div>
          </div>
        </section>

        <section className="metric-grid">
          <article className="metric-card">
            <span>Użytkownicy</span>
            <strong>{dashboard.totals.users}</strong>
          </article>
          <article className="metric-card">
            <span>Free / Basic / Standard / Pro / Expert</span>
            <strong>
              {dashboard.totals.freeUsers} / {dashboard.totals.basicUsers} / {dashboard.totals.standardUsers} / {dashboard.totals.proUsers} / {dashboard.totals.expertUsers}
            </strong>
          </article>
          <article className="metric-card">
            <span>Aktywne plany płatne</span>
            <strong>{dashboard.totals.paidPlans}</strong>
          </article>
          <article className="metric-card">
            <span>Zweryfikowani</span>
            <strong>{dashboard.totals.verifiedUsers}</strong>
          </article>
          <article className="metric-card">
            <span>Aktywne sesje</span>
            <strong>{dashboard.totals.activeSessions}</strong>
          </article>
          <article className="metric-card">
            <span>Otwarte pozycje</span>
            <strong>{dashboard.totals.openPositions}</strong>
          </article>
          <article className="metric-card">
            <span>Sprzedaże</span>
            <strong>{dashboard.totals.sales}</strong>
          </article>
        </section>

        {espiChecks ? <AdminEspiCompleteness checks={espiChecks} /> : null}

        {calendarHealth ? <AdminGpwCalendarHealth health={calendarHealth} /> : null}

        {calendarIntegrity ? <AdminGpwCalendarIntegrity integrity={calendarIntegrity} /> : null}

        <AdminUsersPanel users={dashboard.users} currentUserId={dashboard.currentUserId} />
      </div>
    </main>
  );
}
