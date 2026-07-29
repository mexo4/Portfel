"use client";

import { useRef, useState } from "react";
import PasswordField from "@/components/PasswordField";
import { changePassword } from "@/lib/api";

export default function ChangePasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const currentPasswordRef = useRef<HTMLInputElement | null>(null);
  const newPasswordRef = useRef<HTMLInputElement | null>(null);
  const confirmPasswordRef = useRef<HTMLInputElement | null>(null);

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async () => {
    setMessage(null);

    if (currentPassword.length < 8) {
      setError("Podaj aktualne haslo.");
      currentPasswordRef.current?.focus();
      return;
    }

    if (newPassword.length < 8) {
      setError("Nowe haslo musi miec co najmniej 8 znakow.");
      newPasswordRef.current?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Nowe hasla musza byc identyczne.");
      confirmPasswordRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await changePassword({
        currentPassword,
        newPassword,
      });
      setMessage("Haslo zostalo zmienione.");
      resetForm();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Nie udalo sie zmienic hasla."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="panel panel-compact">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Bezpieczenstwo</p>
          <h2 className="section-title">Zmiana hasla</h2>
        </div>
        <p className="section-copy">
          Aktualna sesja zostaje aktywna, a stare linki resetu hasla sa uniewazniane.
        </p>
      </div>

      <div className="profile-grid mt-6">
        <PasswordField
          label="Aktualne haslo"
          value={currentPassword}
          inputRef={currentPasswordRef}
          autoComplete="current-password"
          onChange={setCurrentPassword}
          placeholder="Wpisz obecne haslo"
        />
        <PasswordField
          label="Nowe haslo"
          value={newPassword}
          inputRef={newPasswordRef}
          autoComplete="new-password"
          onChange={setNewPassword}
          placeholder="Minimum 8 znakow"
        />
        <PasswordField
          label="Powtorz nowe haslo"
          value={confirmPassword}
          inputRef={confirmPasswordRef}
          autoComplete="new-password"
          onChange={setConfirmPassword}
          placeholder="Wpisz nowe haslo ponownie"
        />
      </div>

      {message ? <p className="field-note mt-4">{message}</p> : null}
      {error ? <p className="field-note field-note-error mt-4">{error}</p> : null}

      <div className="mt-5">
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={isSubmitting}
        >
          {isSubmitting ? "Zmieniam haslo..." : "Zmien haslo"}
        </button>
      </div>
    </section>
  );
}
