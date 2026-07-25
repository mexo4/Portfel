import Link from "next/link";
import { notFound } from "next/navigation";
import AdminUsersPanel from "@/components/AdminUsersPanel";
import { getAdminDashboardData } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const dashboard = await getAdminDashboardData();

  if (!dashboard) {
    notFound();
  }

  return (
    <main className="page-shell">
      <div className="page-grid admin-shell">
        <section className="panel panel-compact">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="eyebrow">Admin</p>
              <h1 className="section-title">Panel administracyjny</h1>
              <p className="section-copy">
                Prywatny widok kont, planow, sesji i danych portfeli zapisanych w aplikacji.
              </p>
            </div>

            <div className="summary-actions">
              <Link className="ghost-button" href="/app">
                Wroc do aplikacji
              </Link>
            </div>
          </div>
        </section>

        <section className="metric-grid">
          <article className="metric-card">
            <span>Uzytkownicy</span>
            <strong>{dashboard.totals.users}</strong>
          </article>
          <article className="metric-card">
            <span>Free / Pro</span>
            <strong>
              {dashboard.totals.freeUsers} / {dashboard.totals.proUsers}
            </strong>
          </article>
          <article className="metric-card">
            <span>Oplacone Pro</span>
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
            <span>Sprzedaze</span>
            <strong>{dashboard.totals.sales}</strong>
          </article>
        </section>

        <AdminUsersPanel users={dashboard.users} />
      </div>
    </main>
  );
}
