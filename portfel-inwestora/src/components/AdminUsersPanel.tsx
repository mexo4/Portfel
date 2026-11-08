"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import TruncatedText from "@/components/TruncatedText";
import { deleteAdminUser } from "@/lib/api";
import { getAssetPurchasePriceCurrency } from "@/lib/pricing";
import { isPublicEspiReadEnabled } from "@/lib/entitlements";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import type { AdminDashboardData, AdminUserOverview } from "@/lib/server/admin";
import type { SubscriptionPlan } from "@/types/portfolio";

type AdminUsersPanelProps = {
  users: AdminDashboardData["users"];
  currentUserId: string;
};

type AdminTransaction = {
  id: string;
  date: string;
  type: "Zakup" | "Sprzedaz" | "Korekta";
  title: string;
  details: string;
  value: string;
};

const isPlanPaid = (user: AdminUserOverview) =>
  user.subscriptionPlan !== "free" &&
  (user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing") &&
  (!user.subscriptionExpiresAt || Date.parse(user.subscriptionExpiresAt) > Date.now());

const getPaymentLabel = (user: AdminUserOverview) => {
  if (isPlanPaid(user)) {
    return "Oplacony";
  }

  if (user.subscriptionPlan === "free") {
    return "Free";
  }

  return "Nieoplacony";
};

const getTransactionDate = (date: string) => date || "0000-00-00";

const buildTransactions = (user: AdminUserOverview) => {
  const openPurchases: AdminTransaction[] = user.portfolio.assets.map((asset) => ({
    id: `asset-${asset.id}`,
    date: asset.purchaseDate,
    type: "Zakup",
    title: `${asset.symbol} - ${asset.name}`,
    details: `${formatNumber(asset.quantity)} szt. po ${formatNumber(asset.purchasePrice, 4)} ${getAssetPurchasePriceCurrency(asset)}`,
    value: `Prowizja: ${formatNumber(asset.feePln, 2)} PLN`,
  }));

  const soldPurchases: AdminTransaction[] = user.portfolio.sales.flatMap((sale) =>
    sale.allocations.map((allocation, index) => ({
      id: `allocation-${sale.id}-${allocation.lotId}-${index}`,
      date: allocation.purchaseDate,
      type: "Zakup",
      title: `${allocation.symbol ?? sale.symbol} - ${allocation.name ?? sale.name}`,
      details: `${formatNumber(allocation.quantity)} szt. po ${formatNumber(
        allocation.purchasePrice,
        4
      )} ${getAssetPurchasePriceCurrency(allocation)}`,
      value: `Sprzedany lot: ${formatNumber(allocation.investedPln, 2)} PLN kosztu`,
    }))
  );

  const sales: AdminTransaction[] = user.portfolio.sales.map((sale) => ({
    id: `sale-${sale.id}`,
    date: sale.saleDate,
    type: "Sprzedaz",
    title: `${sale.symbol} - ${sale.name}`,
    details: `${formatNumber(sale.quantity)} szt. po ${formatNumber(sale.salePrice, 4)} ${sale.marketCurrency}`,
    value: `Wynik: ${formatNumber(sale.realizedProfitLossPln, 2)} PLN`,
  }));

  const adjustments: AdminTransaction[] = user.portfolio.realizedAdjustments.map((adjustment) => ({
    id: `adjustment-${adjustment.id}`,
    date: adjustment.date,
    type: "Korekta",
    title: adjustment.note?.trim() || adjustment.bondCode || adjustment.source,
    details: adjustment.source === "bond-coupon" ? "Kupon obligacji" : "Korekta reczna",
    value: `${formatNumber(adjustment.amount, 2)} ${adjustment.currency}`,
  }));

  return [...openPurchases, ...soldPurchases, ...sales, ...adjustments].sort((left, right) =>
    getTransactionDate(right.date).localeCompare(getTransactionDate(left.date))
  );
};

export default function AdminUsersPanel({ users, currentUserId }: AdminUsersPanelProps) {
  const publicEspiReadEnabled = isPublicEspiReadEnabled();
  const router = useRouter();
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});
  const [pendingDeleteUserId, setPendingDeleteUserId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingAccessUserId, setPendingAccessUserId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const transactionsByUserId = useMemo(
    () => new Map(users.map((user) => [user.id, buildTransactions(user)] as const)),
    [users]
  );

  const handleDeleteUser = async (user: AdminUserOverview) => {
    const confirmed = window.confirm(
      `Usunac profil ${user.displayName} (${user.email})? Tej operacji nie da sie cofnac.`
    );

    if (!confirmed) return;

    setPendingDeleteUserId(user.id);
    setDeleteError(null);

    try {
      await deleteAdminUser(user.id);
      router.refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Nie udalo sie usunac profilu.");
    } finally {
      setPendingDeleteUserId(null);
    }
  };

  const updateAccess = async (user: AdminUserOverview, patch: Record<string, unknown>) => {
    setPendingAccessUserId(user.id);
    setAccessError(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Nie udało się zmienić dostępu.");
      router.refresh();
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Nie udało się zmienić dostępu.");
    } finally {
      setPendingAccessUserId(null);
    }
  };

  return (
    <section className="panel admin-users-panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Konta</p>
          <h2 className="section-title">Uzytkownicy i transakcje</h2>
        </div>
        <p className="section-copy">
          Profile sa kompaktowe. Rozwin konto, aby zobaczyc wszystkie transakcje.
        </p>
      </div>

      <div className="admin-profile-list mt-6">
        {deleteError ? <p className="field-note field-note-error">{deleteError}</p> : null}

        {users.map((user) => {
          const isExpanded = Boolean(expandedUsers[user.id]);
          const transactions = transactionsByUserId.get(user.id) ?? [];

          return (
            <article key={user.id} className="admin-profile-card">
              <button
                className="admin-profile-toggle"
                type="button"
                aria-expanded={isExpanded}
                onClick={() => {
                  setExpandedUsers((current) => ({
                    ...current,
                    [user.id]: !current[user.id],
                  }));
                }}
              >
                <div className="admin-profile-main">
                  <strong>{user.displayName}</strong>
                  <span>{user.email}</span>
                </div>
                <div className="admin-profile-stats">
                  <span className="tag">{user.subscriptionPlan} / {user.subscriptionStatus}</span>
                  <span className={isPlanPaid(user) ? "tag tag-success" : "tag"}>
                    Plan: {getPaymentLabel(user)}
                  </span>
                  <span className="tag">Email: {user.emailVerifiedAt ? "OK" : "Nie"}</span>
                  <span className="tag">Sesje: {user.activeSessions}</span>
                  <span className="tag">
                    {user.assetsCount} lotow / {user.salesCount} sprzedazy
                  </span>
                </div>
                <span className="admin-expand-indicator">{isExpanded ? "Zwin" : "Rozwin"}</span>
              </button>

              {isExpanded ? (
                <div className="admin-profile-details">
                  <div className="admin-profile-meta">
                    <span>ID: {user.id}</span>
                    <span>Broker: {user.preferredBroker}</span>
                    <span>Kraj: {user.country}</span>
                    <span>Doswiadczenie: {user.experienceLevel}</span>
                    <span>Utworzono: {formatDate(user.createdAt)}</span>
                    <span>Aktualizacja: {formatDateTime(user.updatedAt)}</span>
                    <span>Plan zmieniony: {formatDateTime(user.subscriptionUpdatedAt ?? undefined)}</span>
                    <span>Dostęp do: {formatDateTime(user.subscriptionExpiresAt ?? undefined)}</span>
                    <span>Źródło nadania: {user.subscriptionGrantSource ?? "brak"}</span>
                    <span>Rola: {user.role} · Tester: {user.testerAccess ? "tak" : "nie"}</span>
                  </div>

                  <div className="admin-profile-actions">
                    <label>
                      Plan
                      <select value={user.subscriptionPlan} disabled={pendingAccessUserId === user.id} onChange={(event) => void updateAccess(user, { subscriptionPlan: event.target.value as SubscriptionPlan })}>
                        <option value="free">Free</option><option value="basic">Basic</option><option value="standard">Standard</option><option value="pro">Pro</option><option value="expert">Expert</option>
                      </select>
                    </label>
                    <label>
                      Rola
                      <select value={user.role} disabled={pendingAccessUserId === user.id || user.id === currentUserId} onChange={(event) => void updateAccess(user, { role: event.target.value })}>
                        <option value="user">Użytkownik</option><option value="admin">Administrator</option>
                      </select>
                    </label>
                    <label><input type="checkbox" checked={user.testerAccess} disabled={pendingAccessUserId === user.id || user.id === currentUserId} onChange={(event) => void updateAccess(user, { testerAccess: event.target.checked })} /> Dostęp Tester</label>
                    <button
                      className="ghost-button admin-danger-button"
                      type="button"
                      onClick={() => void handleDeleteUser(user)}
                      disabled={pendingDeleteUserId === user.id || user.id === currentUserId}
                    >
                      {pendingDeleteUserId === user.id ? "Usuwam..." : "Usun profil"}
                    </button>
                  </div>
                  {pendingAccessUserId === user.id ? <p className="field-note">Zapisuję zmianę dostępu…</p> : null}
                  {accessError ? <p className="field-note field-note-error">{accessError}</p> : null}
                  <p className="field-note">{publicEspiReadEnabled
                    ? "Raporty ESPI są dostępne dla każdego zalogowanego użytkownika."
                    : "Publiczny dostęp ESPI jest wyłączony do czasu potwierdzenia praw do wszystkich źródeł; administratorzy i konta z zachowanym indywidualnym dostępem nadal mogą czytać feed."}</p>
                  <p className="field-note">Płatny plan nadany przez administratora działa 30 dni. Nie skonfigurowano płatności automatycznych. Nie możesz zmienić własnego dostępu.</p>

                  <div className="admin-transaction-head">
                    <h3 className="admin-subtitle">Wszystkie transakcje</h3>
                    <span className="tag">{transactions.length}</span>
                  </div>

                  {transactions.length > 0 ? (
                    <div className="admin-transaction-list">
                      {transactions.map((transaction) => (
                        <div key={transaction.id} className="admin-transaction-row">
                          <span>{formatDate(transaction.date)}</span>
                          <strong>{transaction.type}</strong>
                          <div>
                            <TruncatedText
                              as="div"
                              className="admin-transaction-title"
                              text={transaction.title}
                            />
                            <span>{transaction.details}</span>
                          </div>
                          <span>{transaction.value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="field-note">Brak transakcji dla tego konta.</p>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
