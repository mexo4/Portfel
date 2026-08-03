"use client";

import { useState } from "react";
import type { RefObject } from "react";

type PasswordFieldProps = {
  label: string;
  value: string;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
};

export default function PasswordField({
  label,
  value,
  placeholder,
  autoComplete,
  disabled = false,
  inputRef,
  onChange,
}: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <label className="field">
      <span>{label}</span>
      <div className="password-input-wrap">
        <input
          ref={inputRef}
          type={isVisible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="password-toggle"
          disabled={disabled}
          onClick={() => setIsVisible((current) => !current)}
          aria-label={isVisible ? "Ukryj haslo" : "Pokaz haslo"}
          title={isVisible ? "Ukryj haslo" : "Pokaz haslo"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
            <circle cx="12" cy="12" r="3" />
            {isVisible ? null : <path d="M4 4l16 16" />}
          </svg>
        </button>
      </div>
    </label>
  );
}
