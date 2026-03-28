"use client";

import { useState } from "react";
import { requestEmailVerification } from "@/lib/api";
import { INVESTOR_EXPERIENCE_OPTIONS } from "@/lib/constants";
import { getUserInitials } from "@/lib/profile";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { AuthenticatedUser, UserProfile } from "@/types/portfolio";

type UserProfilePanelProps = {
  account: AuthenticatedUser;
  profile: UserProfile;
  positionsCount: number;
  assetsCount: number;
  isLoggingOut: boolean;
  onChange: (patch: Partial<UserProfile>) => void;
  onReset: () => void;
  onLogout: () => void;
};

export default function UserProfilePanel({
  account,
  profile,
  positionsCount,
  assetsCount,
  isLoggingOut,
  onChange,
  onReset,
  onLogout,
}: UserProfilePanelProps) {
  const initials = getUserInitials(profile);
  const title = profile.displayName.trim() || "Twoj profil inwestora";
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationPreviewUrl, setVerificationPreviewUrl] = useState<string | null>(null);
  const [isSendingVerification, setIsSendingVerification] = useState(false);

  const handleVerificationRequest = async () => {
    setIsSendingVerification(true);
    setVerificationMessage(null);
    setVerificationError(null);
    setVerificationPreviewUrl(null);

    try {
      const response = await requestEmailVerification();

      if (response.alreadyVerified) {
        setVerificationMessage("Ten adres email jest juz zweryfikowany.");
        return;
      }

      setVerificationMessage("Link weryfikacyjny jest gotowy.");
      setVerificationPreviewUrl(response.previewUrl);
    } catch (error) {
      setVerificationError(
        error instanceof Error ? error.message : "Nie udalo sie przygotowac linku."
      );
    } finally {
      setIsSendingVerification(false);
    }
  };

  return (
    <section className="panel">
      <div className="profile-shell">
        <div className="profile-hero">
          <div className="profile-avatar">{initials}</div>

          <div className="min-w-0">
            <p className="eyebrow">Konto inwestora</p>
            <h2 className="profile-name">{title}</h2>

            <div className="hero-meta mt-3">
              <span className="tag">{account.email}</span>
              <span className="tag">
                {account.emailVerifiedAt ? "email zweryfikowany" : "email czeka na weryfikacje"}
              </span>
            </div>
          </div>
        </div>

        <div className="profile-grid">
          <label className="field">
            <span>Imie i nazwisko</span>
            <input
              value={profile.displayName}
              onChange={(event) => onChange({ displayName: event.target.value })}
              placeholder="Np. Jan Kowalski"
            />
          </label>

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={profile.email}
              onChange={(event) => onChange({ email: event.target.value })}
              placeholder="twoj@email.com"
            />
          </label>

          <label className="field">
            <span>Kraj</span>
            <input
              value={profile.country}
              onChange={(event) => onChange({ country: event.target.value })}
              placeholder="Polska"
            />
          </label>

          <label className="field">
            <span>Broker</span>
            <input
              value={profile.preferredBroker}
              onChange={(event) => onChange({ preferredBroker: event.target.value })}
              placeholder="Np. XTB, IBKR, mBank"
            />
          </label>

          <label className="field">
            <span>Poziom inwestowania</span>
            <select
              value={profile.experienceLevel}
              onChange={(event) =>
                onChange({
                  experienceLevel: event.target.value as UserProfile["experienceLevel"],
                })
              }
            >
              {INVESTOR_EXPERIENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Miesieczna wplata PLN</span>
            <input
              type="number"
              min="0"
              step="100"
              value={profile.monthlyContributionPln}
              onChange={(event) =>
                onChange({
                  monthlyContributionPln: Number(event.target.value),
                })
              }
            />
          </label>

          <label className="field field-full">
            <span>Cel inwestycyjny</span>
            <input
              value={profile.investmentGoal}
              onChange={(event) => onChange({ investmentGoal: event.target.value })}
              placeholder="Np. niezaleznosc finansowa, emerytura, portfel dywidendowy"
            />
          </label>
        </div>

        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="hero-meta">
            <span className="tag">pozycje: {positionsCount}</span>
            <span className="tag">aktywa: {assetsCount}</span>
            <span className="tag">broker: {profile.preferredBroker.trim() || "brak"}</span>
            <span className="tag">kraj: {profile.country.trim() || "brak"}</span>
            <span className="tag">
              miesiecznie:{" "}
              {profile.monthlyContributionPln > 0
                ? formatCurrency(profile.monthlyContributionPln)
                : "nie ustawiono"}
            </span>
            {profile.createdAt ? (
              <span className="tag">utworzono: {formatDateTime(profile.createdAt)}</span>
            ) : null}
            {profile.updatedAt ? (
              <span className="tag">aktualizacja: {formatDateTime(profile.updatedAt)}</span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            {!account.emailVerifiedAt ? (
              <button
                className="ghost-button"
                type="button"
                onClick={() => {
                  void handleVerificationRequest();
                }}
                disabled={isSendingVerification}
              >
                {isSendingVerification ? "Przygotowuje link..." : "Weryfikuj email"}
              </button>
            ) : null}
            <button className="ghost-button" type="button" onClick={onReset}>
              Wyczysc profil
            </button>
            <button className="ghost-button" type="button" onClick={onLogout} disabled={isLoggingOut}>
              {isLoggingOut ? "Wylogowuje..." : "Wyloguj sie"}
            </button>
          </div>
        </div>

        {verificationMessage ? <p className="field-note">{verificationMessage}</p> : null}
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
      </div>
    </section>
  );
}
