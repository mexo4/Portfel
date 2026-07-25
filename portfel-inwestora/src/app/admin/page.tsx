import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminDashboardData } from "@/lib/server/admin";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const formatVerified = (value: string | null) => (value ? "Tak" : "Nie");

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

        <section className="panel">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="eyebrow">Konta</p>
              <h2 className="section-title">Uzytkownicy i portfele</h2>
            </div>
            <p className="section-copy">
              Dane wrazliwe jak hashe hasel nie sa wyswietlane w panelu.
            </p>
          </div>

          <div className="mt-6 overflow-x-auto">
            <table className="portfolio-table admin-table min-w-full">
              <thead>
                <tr>
                  <th>Konto</th>
                  <th>Plan</th>
                  <th>Email OK</th>
                  <th>Sesje</th>
                  <th>Pozycje</th>
                  <th>Sprzedaze</th>
                  <th>Broker</th>
                  <th>Utworzono</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="admin-user-cell">
                        <strong>{user.displayName}</strong>
                        <span>{user.email}</span>
                        <span>ID: {user.id}</span>
                      </div>
                    </td>
                    <td>
                      <span className="tag">
                        {user.subscriptionPlan} / {user.subscriptionStatus}
                      </span>
                    </td>
                    <td>{formatVerified(user.emailVerifiedAt)}</td>
                    <td>{user.activeSessions}</td>
                    <td>
                      {user.assetsCount} lotow / {user.uniqueAssetsCount} aktywow
                    </td>
                    <td>{user.salesCount}</td>
                    <td>{user.preferredBroker}</td>
                    <td>{formatDate(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {dashboard.users.map((user) => (
          <section key={`${user.id}-portfolio`} className="panel admin-detail-panel">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="eyebrow">{user.email}</p>
                <h2 className="section-title">{user.displayName}</h2>
                <p className="section-copy">
                  Kraj: {user.country}. Doswiadczenie: {user.experienceLevel}. Ostatnia
                  aktualizacja: {formatDateTime(user.updatedAt)}.
                </p>
              </div>
              <span className="tag">
                {user.subscriptionPlan === "pro" ? "Pro" : "Free"}
              </span>
            </div>

            <div className="admin-detail-grid mt-5">
              <div>
                <h3 className="admin-subtitle">Otwarte pozycje</h3>
                {user.portfolio.assets.length > 0 ? (
                  <div className="admin-mini-list">
                    {user.portfolio.assets.map((asset) => (
                      <div key={asset.id} className="admin-mini-row">
                        <strong>{asset.symbol}</strong>
                        <span>{asset.name}</span>
                        <span>
                          {formatNumber(asset.quantity)} szt. po {formatNumber(asset.purchasePrice, 4)}{" "}
                          {asset.purchaseCurrency}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="field-note">Brak otwartych pozycji.</p>
                )}
              </div>

              <div>
                <h3 className="admin-subtitle">Sprzedaze i korekty</h3>
                {user.portfolio.sales.length > 0 || user.portfolio.realizedAdjustments.length > 0 ? (
                  <div className="admin-mini-list">
                    {user.portfolio.sales.slice(0, 8).map((sale) => (
                      <div key={sale.id} className="admin-mini-row">
                        <strong>{sale.symbol}</strong>
                        <span>
                          {formatDate(sale.saleDate)} · {formatNumber(sale.quantity)} szt.
                        </span>
                        <span>Wynik: {formatNumber(sale.realizedProfitLossPln, 2)} PLN</span>
                      </div>
                    ))}
                    {user.portfolio.realizedAdjustments.slice(0, 8).map((adjustment) => (
                      <div key={adjustment.id} className="admin-mini-row">
                        <strong>{adjustment.note ?? adjustment.source}</strong>
                        <span>{formatDate(adjustment.date)}</span>
                        <span>
                          {formatNumber(adjustment.amount, 2)} {adjustment.currency}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="field-note">Brak sprzedazy i korekt.</p>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
