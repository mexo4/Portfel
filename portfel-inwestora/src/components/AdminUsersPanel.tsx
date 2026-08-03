"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import TruncatedText from "@/components/TruncatedText";
import { deleteAdminUser } from "@/lib/api";
import { getAssetPurchasePriceCurrency } from "@/lib/pricing";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import type { AdminDashboardData, AdminUserOverview } from "@/lib/server/admin";

type AdminUsersPanelProps = {
  users: AdminDashboardData["users"];
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
  user.subscriptionPlan === "pro" &&
  (user.subscriptionStatus === "active" || user.subscriptionStatus === "trialing");

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

export default function AdminUsersPanel({ users }: AdminUsersPanelProps) {
  const router = useRouter();
  const [expandedUsers, setExpandedUsers] = useState<Record<string, boolean>>({});
  const [pendingDeleteUserId, setPendingDeleteUserId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
                  </div>

                  <div className="admin-profile-actions">
                    <button
                      className="ghost-button admin-danger-button"
                      type="button"
                      onClick={() => void handleDeleteUser(user)}
                      disabled={pendingDeleteUserId === user.id}
                    >
                      {pendingDeleteUserId === user.id ? "Usuwam..." : "Usun profil"}
                    </button>
                  </div>

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
