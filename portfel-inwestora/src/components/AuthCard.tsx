"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import PasswordField from "@/components/PasswordField";
import { ApiError, loginUser, registerUser } from "@/lib/api";

type AuthCardProps = {
  mode: "login" | "register";
  initialError?: string | null;
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

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.52h3.24c1.9-1.75 2.97-4.33 2.97-7.37Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.89 6.63-2.4l-3.24-2.52c-.9.6-2.05.95-3.39.95-2.61 0-4.82-1.76-5.61-4.13H3.05v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.9A6.01 6.01 0 0 1 6.08 12c0-.66.12-1.3.31-1.9V7.5H3.05A10 10 0 0 0 2 12c0 1.61.39 3.14 1.05 4.5l3.34-2.6Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.97c1.47 0 2.79.5 3.83 1.48l2.87-2.87C16.96 2.96 14.7 2 12 2a10 10 0 0 0-8.95 5.5l3.34 2.6C7.18 7.73 9.39 5.97 12 5.97Z"
      />
    </svg>
  );
}

export default function AuthCard({
  mode,
  initialError = null,
  initialNotice = null,
}: AuthCardProps) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

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
            : "Konto utworzone. Potwierdz adres email, aby sie zalogowac."
        );
        setVerificationPreviewUrl(response.previewUrl);
        return;
      }

      await loginUser({ email: normalizedEmail, password: submittedPassword });
      shouldKeepSubmitting = true;
      window.location.replace("/app");
    } catch (submitError) {
      const verificationPayload = getVerificationPayload(submitError);

      if (verificationPayload) {
        setNotice(
          verificationPayload.verificationSent
            ? "Wyslalismy nowy link potwierdzajacy email."
            : "Potwierdz email przed logowaniem."
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
    <main className="auth-page">
      <div className="auth-layout">
        <section className="auth-brand" aria-labelledby="auth-brand-heading">
          <Link className="auth-logo" href="/" aria-label="Mexo - strona glowna">
            Mexo
          </Link>
          <div className="auth-brand-copy">
            <p className="auth-brand-kicker">Portfel inwestora</p>
            <h1 id="auth-brand-heading">Twoje inwestycje. W jednym miejscu.</h1>
          </div>
        </section>

        <section className="auth-surface" aria-labelledby="auth-heading">
          <div className="auth-heading-group">
            <p className="auth-section-label">{isRegister ? "Nowe konto" : "Witaj ponownie"}</p>
            <h2 id="auth-heading">{isRegister ? "Utworz konto" : "Zaloguj sie"}</h2>
            <p>
              {isRegister
                ? "Zacznij korzystac z portfela Mexo."
                : "Kontynuuj do swojego portfela."}
            </p>
          </div>

          <a className="google-button" href="/api/auth/oauth/google">
            <GoogleMark />
            <span>Kontynuuj z Google</span>
          </a>

          <div className="auth-divider" aria-hidden="true">
            <span />
            <strong>lub przez email</strong>
            <span />
          </div>

          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            {isRegister ? (
              <label className="field">
                <span>Nazwa uzytkownika</span>
                <input
                  ref={displayNameRef}
                  value={displayName}
                  disabled={!isHydrated || isSubmitting}
                  autoComplete="name"
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
                autoComplete="email"
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
              <p className="auth-inline-link">
                <Link href="/forgot-password">Nie pamietasz hasla?</Link>
              </p>
            ) : null}

            {error ? (
              <p className="field-note field-note-error" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="field-note" role="status">
                {notice}
              </p>
            ) : null}
            {verificationPreviewUrl ? (
              <p className="field-note">
                Tryb developerski: {" "}
                <a className="auth-link" href={verificationPreviewUrl}>
                  otworz link weryfikacyjny
                </a>
              </p>
            ) : null}

            <button
              className="primary-button auth-submit-button"
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

          <p className="auth-switch-copy">
            {isRegister ? "Masz juz konto?" : "Nie masz jeszcze konta?"}{" "}
            <Link href={isRegister ? "/login" : "/register"}>
              {isRegister ? "Zaloguj sie" : "Utworz konto"}
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
