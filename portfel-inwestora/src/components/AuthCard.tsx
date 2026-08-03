"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, loginUser, registerUser } from "@/lib/api";
import PasswordField from "@/components/PasswordField";

type AuthCardProps = {
  mode: "login" | "register";
  initialNotice?: string | null;
};

type VerificationErrorPayload = {
  requiresVerification?: boolean;
  verificationSent?: boolean;
  previewUrl?: string | null;
};

const getVerificationPayload = (error: unknown) => {
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== "object") {
    return null;
  }

  const payload = error.payload as VerificationErrorPayload;
  return payload.requiresVerification ? payload : null;
};

export default function AuthCard({ mode, initialNotice = null }: AuthCardProps) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice);
  const [verificationPreviewUrl, setVerificationPreviewUrl] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const displayNameRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  const isRegister = mode === "register";

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    if (isSubmitting) {
      return;
    }

    const submittedDisplayName = displayNameRef.current?.value ?? displayName;
    const normalizedEmail = (emailRef.current?.value ?? email).trim();
    const submittedPassword = passwordRef.current?.value ?? password;

    if (isRegister && submittedDisplayName.trim().length < 2) {
      setError("Podaj nazwe uzytkownika zlozona z co najmniej 2 znakow.");
      displayNameRef.current?.focus();
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError("Podaj poprawny adres email.");
      emailRef.current?.focus();
      return;
    }

    if (submittedPassword.length < 8) {
      setError("Haslo musi miec co najmniej 8 znakow.");
      passwordRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    setVerificationPreviewUrl(null);

    let shouldKeepSubmitting = false;

    try {
      if (isRegister) {
        const response = await registerUser({
          displayName: submittedDisplayName,
          email: normalizedEmail,
          password: submittedPassword,
        });

        setNotice(
          response.verificationSent
            ? "Konto utworzone. Wyslalismy email z linkiem potwierdzajacym."
            : "Konto utworzone. Skonfiguruj RESEND_API_KEY, aby wysylac maile w produkcji."
        );
        setVerificationPreviewUrl(response.previewUrl);
        return;
      } else {
        await loginUser({
          email: normalizedEmail,
          password: submittedPassword,
        });
      }

      shouldKeepSubmitting = true;
      window.location.replace("/app");
    } catch (submitError) {
      const verificationPayload = getVerificationPayload(submitError);

      if (verificationPayload) {
        setNotice(
          verificationPayload.verificationSent
            ? "Wyslalismy nowy link potwierdzajacy email."
            : "Potwierdz email przed logowaniem. Skonfiguruj RESEND_API_KEY, aby wysylac maile."
        );
        setVerificationPreviewUrl(verificationPayload.previewUrl ?? null);
      }

      setError(
        submitError instanceof Error ? submitError.message : "Nie udalo sie zapisac formularza."
      );
    } finally {
      if (!shouldKeepSubmitting) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <main className="page-shell">
      <div className="auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">{isRegister ? "Rejestracja" : "Logowanie"}</p>
          <h1 className="auth-title">
            {isRegister ? "Zaloz prawdziwe konto inwestora" : "Zaloguj sie do swojego portfela"}
          </h1>
          <p className="section-copy">
            {isRegister
              ? "Twoje konto, profil i portfel beda zapisane po stronie serwera, a nie tylko w przegladarce."
              : "Po zalogowaniu zobaczysz swoj profil i dane portfela przypiete do konta."}
          </p>

          <form className="auth-form mt-6" onSubmit={handleSubmit}>
            {isRegister ? (
              <label className="field">
                <span>Nazwa uzytkownika</span>
                <input
                  ref={displayNameRef}
                  value={displayName}
                  disabled={!isHydrated || isSubmitting}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Np. Jan Kowalski"
                />
              </label>
            ) : null}

            <label className="field">
              <span>Email</span>
              <input
                ref={emailRef}
                type="email"
                value={email}
                disabled={!isHydrated || isSubmitting}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="twoj@email.com"
              />
            </label>

            <PasswordField
              label="Haslo"
              value={password}
              inputRef={passwordRef}
              autoComplete={isRegister ? "new-password" : "current-password"}
              disabled={!isHydrated || isSubmitting}
              onChange={setPassword}
              placeholder="Minimum 8 znakow"
            />

            {!isRegister ? (
              <p className="field-note">
                <Link href="/forgot-password" className="auth-link">
                  Nie pamietasz hasla?
                </Link>
              </p>
            ) : null}

            {error ? <p className="field-note field-note-error">{error}</p> : null}
            {notice ? <p className="field-note">{notice}</p> : null}
            {verificationPreviewUrl ? (
              <p className="field-note">
                Tryb developerski:{" "}
                <a className="auth-link" href={verificationPreviewUrl}>
                  otworz link weryfikacyjny
                </a>
              </p>
            ) : null}

            <button
              className="primary-button"
              type="submit"
              disabled={!isHydrated || isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting
                ? isRegister
                  ? "Tworzenie konta..."
                  : "Logowanie..."
                : isRegister
                  ? "Utworz konto"
                  : "Zaloguj sie"}
            </button>
          </form>

          <div className="auth-divider" aria-hidden="true">
            <span />
            <strong>lub</strong>
            <span />
          </div>

          <div className="auth-oauth-actions">
            <a className="ghost-button auth-oauth-button" href="/api/auth/oauth/google/start">
              Google
            </a>
            <a className="ghost-button auth-oauth-button" href="/api/auth/oauth/apple/start">
              Apple
            </a>
          </div>

          <div className="hero-meta mt-6">
            <span className="tag">sesja w bezpiecznym cookie</span>
            <span className="tag">konto zapisane w PostgreSQL</span>
            <span className="tag">haslo szyfrowane przez bcrypt</span>
            <span className="tag">weryfikacja email i reset hasla</span>
          </div>

          <p className="section-copy mt-6">
            {isRegister ? "Masz juz konto?" : "Nie masz jeszcze konta?"}{" "}
            <Link href={isRegister ? "/login" : "/register"} className="auth-link">
              {isRegister ? "Zaloguj sie" : "Zarejestruj sie"}
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
