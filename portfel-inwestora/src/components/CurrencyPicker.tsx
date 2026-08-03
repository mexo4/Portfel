"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CurrencyCode } from "@/types/portfolio";

type CurrencyPickerProps = {
  label: string;
  value: CurrencyCode;
  currencies: CurrencyCode[];
  onChange: (currency: CurrencyCode) => void;
};

const normalizeQuery = (value: string) => value.trim().toLowerCase();

export default function CurrencyPicker({
  label,
  value,
  currencies,
  onChange,
}: CurrencyPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputId = useId();
  const normalizedValue = value.toUpperCase();
  const normalizedQuery = normalizeQuery(query);
  const options = useMemo(
    () =>
      Array.from(new Set(currencies.map((currency) => currency.toUpperCase())))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [currencies]
  );
  const filteredOptions = useMemo(
    () =>
      options.filter((currency) =>
        normalizedQuery ? currency.toLowerCase().includes(normalizedQuery) : true
      ),
    [normalizedQuery, options]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    const timeoutId = window.setTimeout(() => searchInputRef.current?.focus(), 0);

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timeoutId);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (currency: CurrencyCode) => {
    onChange(currency);
    setIsOpen(false);
    setQuery("");
  };

  return (
    <div className="field currency-picker">
      <span>{label}</span>
      <button
        type="button"
        className="import-platform-trigger currency-picker-trigger"
        onClick={() => setIsOpen(true)}
      >
        <span className="import-platform-logo" aria-hidden="true">
          {normalizedValue}
        </span>
        <span className="import-platform-trigger-copy">
          <span>Waluta</span>
          <strong>{normalizedValue}</strong>
        </span>
        <span className="import-platform-trigger-action">Zmien</span>
      </button>

      {isOpen ? (
        <div
          className="import-platform-modal-backdrop"
          role="presentation"
          onClick={() => setIsOpen(false)}
        >
          <section
            aria-label={label}
            aria-modal="true"
            className="import-platform-modal currency-picker-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="import-platform-modal-head">
              <div>
                <p className="eyebrow">Waluta</p>
                <h3 className="section-title">{label}</h3>
              </div>
              <button
                type="button"
                className="ghost-button import-platform-close"
                onClick={() => setIsOpen(false)}
              >
                Zamknij
              </button>
            </div>

            <label className="import-platform-search" htmlFor={searchInputId}>
              <span aria-hidden="true">SZ</span>
              <input
                id={searchInputId}
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Wyszukaj walute..."
              />
            </label>

            <div className="import-platform-card-grid currency-picker-grid">
              {filteredOptions.map((currency) => (
                <button
                  key={currency}
                  type="button"
                  className={
                    currency === normalizedValue
                      ? "import-platform-card is-selected"
                      : "import-platform-card"
                  }
                  onClick={() => handleSelect(currency)}
                >
                  <span className="import-platform-logo" aria-hidden="true">
                    {currency}
                  </span>
                  <span className="import-platform-card-body">
                    <strong>{currency}</strong>
                    <small>{currency === normalizedValue ? "Wybrana" : "Wybierz"}</small>
                  </span>
                </button>
              ))}

              {filteredOptions.length === 0 ? (
                <div className="line-chart-empty">
                  <p className="table-title">Brak waluty</p>
                  <p className="table-note mt-2">Sprobuj wpisac kod ISO, np. USD.</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
