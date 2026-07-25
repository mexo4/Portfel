"use client";

import {
  AUTO_REFRESH_INTERVAL_MS,
  FREE_PLAN_ASSET_LIMIT,
  FREE_PLAN_PORTFOLIO_LIMIT,
} from "@/lib/constants";
import { getBaseCurrency } from "@/lib/pricing";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { PortfolioSummary as SummaryModel, SubscriptionPlan } from "@/types/portfolio";

type PortfolioSummaryProps = {
  summary: SummaryModel;
  lastSyncAt?: string;
  fxUpdatedAt?: string;
  isRefreshing: boolean;
  isLoggingOut?: boolean;
  isSendingVerification?: boolean;
  canVerifyEmail?: boolean;
  syncError?: string | null;
  verificationMessage?: string | null;
  verificationError?: string | null;
  verificationPreviewUrl?: string | null;
  subscriptionPlan: SubscriptionPlan;
  onRefresh: () => void;
  onLogout?: () => void;
  onRequestVerification?: () => void;
};

export default function PortfolioSummary({
  summary,
  lastSyncAt,
  fxUpdatedAt,
  isRefreshing,
  isLoggingOut,
  isSendingVerification,
  canVerifyEmail,
  syncError,
  verificationMessage,
  verificationError,
  verificationPreviewUrl,
  subscriptionPlan,
  onRefresh,
  onLogout,
  onRequestVerification,
}: PortfolioSummaryProps) {
  const foreignRealizedEntries = Object.entries(summary.realizedProfitLossByCurrency)
    .filter(([currency]) => currency !== "PLN")
    .sort(([leftCurrency], [rightCurrency]) => leftCurrency.localeCompare(rightCurrency, "pl"));

  return (
    <section className="panel panel-compact">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="eyebrow">Portfel inwestycyjny</p>
          <h2 className="section-title">Szybki podglad portfela</h2>
          <p className="section-copy">
            Glowny wynik liczony jest w {getBaseCurrency()}, a zysk zrealizowany pokazujemy
            dodatkowo w walutach transakcji.
          </p>
        </div>

        <div className="summary-actions">
          <a className="ghost-button" href="/pricing">
            Plan {subscriptionPlan === "pro" ? "Pro" : "Free"}
          </a>

          {canVerifyEmail && onRequestVerification ? (
            <button
              className="ghost-button"
              type="button"
              onClick={onRequestVerification}
              disabled={isSendingVerification}
            >
              {isSendingVerification ? "Przygotowuje link..." : "Weryfikuj email"}
            </button>
          ) : null}

          {onLogout ? (
            <button
              className="ghost-button"
              type="button"
              onClick={onLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? "Wylogowuje..." : "Wyloguj"}
            </button>
          ) : null}

          <button
            className="primary-button"
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Odswiezam..." : "Odswiez ceny"}
          </button>
        </div>
      </div>

      <div className="metric-grid mt-6">
        <article className="metric-card">
          <span>Wartosc portfela</span>
          <strong>{formatCurrency(summary.totalValuePln)}</strong>
        </article>
        <article className="metric-card">
          <span>Zainwestowano otwarte</span>
          <strong>{formatCurrency(summary.totalInvestedPln)}</strong>
        </article>
        <article className="metric-card">
          <span>Wynik otwarty</span>
          <strong
            className={
              summary.openProfitLossPln >= 0 ? "tone-positive" : "tone-negative"
            }
          >
            {formatCurrency(summary.openProfitLossPln)}
          </strong>
        </article>
        <article className="metric-card">
          <span>Wynik zrealizowany</span>
          <strong
            className={
              summary.realizedProfitLossPln >= 0 ? "tone-positive" : "tone-negative"
            }
          >
            {formatCurrency(summary.realizedProfitLossPln)}
          </strong>
        </article>
        {foreignRealizedEntries.map(([currency, value]) => (
          <article key={currency} className="metric-card">
            <span>Wynik zrealizowany {currency}</span>
            <strong className={value >= 0 ? "tone-positive" : "tone-negative"}>
              {formatCurrency(value, currency)}
            </strong>
          </article>
        ))}
        <article className="metric-card">
          <span>Wynik laczny</span>
          <strong
            className={
              summary.combinedProfitLossPln >= 0 ? "tone-positive" : "tone-negative"
            }
          >
            {formatCurrency(summary.combinedProfitLossPln)}
          </strong>
        </article>
        <article className="metric-card metric-card-muted">
          <span>Stan danych</span>
          <strong>{formatDateTime(lastSyncAt)}</strong>
          <p className="metric-copy">FX: {formatDateTime(fxUpdatedAt)}</p>
        </article>
      </div>

      <div className="hero-meta mt-5">
        <span className="tag">pozycje: {summary.positionsCount}</span>
        <span className="tag">unikalne aktywa: {summary.assetsCount}</span>
        <span className="tag">sprzedaze: {summary.salesCount}</span>
        <span className="tag">
          plan: {subscriptionPlan === "pro" ? "Pro bez limitu" : `Free: ${FREE_PLAN_PORTFOLIO_LIMIT} portfel, do ${FREE_PLAN_ASSET_LIMIT} pozycji`}
        </span>
        <span className="tag">auto refresh: co {AUTO_REFRESH_INTERVAL_MS / 1000}s</span>
        <span className="tag">baza: {getBaseCurrency()}</span>
      </div>

      {syncError ? <p className="field-note field-note-error mt-4">{syncError}</p> : null}
      {verificationMessage ? <p className="field-note mt-4">{verificationMessage}</p> : null}
      {verificationPreviewUrl ? (
        <p className="field-note">
          Tryb developerski:{" "}
          <a className="auth-link" href={verificationPreviewUrl}>
            otworz link weryfikacyjny
          </a>
        </p>
      ) : null}
      {verificationError ? (
        <p className="field-note field-note-error">{verificationError}</p>
      ) : null}
    </section>
  );
}
