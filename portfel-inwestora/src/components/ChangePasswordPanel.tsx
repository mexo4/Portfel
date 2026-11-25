"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import PasswordField from "@/components/PasswordField";
import { changePassword } from "@/lib/api";

type ChangePasswordPanelProps = {
  hasPassword?: boolean;
};

export default function ChangePasswordPanel({ hasPassword = true }: ChangePasswordPanelProps) {
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
      setError("Podaj aktualne hasło.");
      currentPasswordRef.current?.focus();
      return;
    }

    if (newPassword.length < 8) {
      setError("Nowe hasło musi mieć co najmniej 8 znaków.");
      newPasswordRef.current?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Nowe hasła muszą być identyczne.");
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
      setMessage("Hasło zostało zmienione.");
      resetForm();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Nie udało się zmienić hasła."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="panel panel-compact">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Bezpieczeństwo</p>
          <h2 className="section-title">Zmiana hasła</h2>
        </div>
        <p className="section-copy">
          Aktualna sesja zostaje aktywna, a stare linki resetu hasła są unieważniane.
        </p>
      </div>

      {!hasPassword ? (
        <div className="mt-6">
          <p className="section-copy">
            To konto korzysta z logowania przez Google. Aby dodać hasło do Mexo, użyj
            bezpiecznego linku resetu hasła.
          </p>
          <p className="section-copy mt-4">
            <Link href="/forgot-password" className="auth-link">
              Ustaw hasło przez email
            </Link>
          </p>
        </div>
      ) : (
        <>
      <div className="profile-grid mt-6">
        <PasswordField
          label="Aktualne hasło"
          value={currentPassword}
          inputRef={currentPasswordRef}
          autoComplete="current-password"
          onChange={setCurrentPassword}
          placeholder="Wpisz obecne hasło"
        />
        <PasswordField
          label="Nowe hasło"
          value={newPassword}
          inputRef={newPasswordRef}
          autoComplete="new-password"
          onChange={setNewPassword}
          placeholder="Minimum 8 znaków"
        />
        <PasswordField
          label="Powtórz nowe hasło"
          value={confirmPassword}
          inputRef={confirmPasswordRef}
          autoComplete="new-password"
          onChange={setConfirmPassword}
          placeholder="Wpisz nowe hasło ponownie"
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
          {isSubmitting ? "Zmieniam hasło..." : "Zmień hasło"}
        </button>
      </div>
        </>
      )}
    </section>
  );
}
