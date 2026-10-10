"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { PortfolioAssetGroup } from "@/lib/pricing";
import { formatDateTime } from "@/lib/utils";
import type { CurrencyCode } from "@/types/portfolio";

const SUPPORTED_CURRENCIES = ["PLN", "USD", "EUR", "GBP", "DKK"] as const;

type ManualAssetPriceDialogProps = {
  group: PortfolioAssetGroup;
  pending: boolean;
  error: string | null;
  onUpdate: (group: PortfolioAssetGroup, price: number, currency: CurrencyCode) => Promise<void>;
  onClear: (group: PortfolioAssetGroup) => Promise<void>;
  onClose: () => void;
};

export const isManualAssetPriceGroup = (group: PortfolioAssetGroup) =>
  group.instrumentType === "OTHER" || group.instrumentType === "CRYPTO" || group.kind === "crypto";

export const hasManualAssetPrice = (group: PortfolioAssetGroup) =>
  group.lots.some((lot) => lot.priceSource === "MANUAL");

export const getManualAssetPriceUpdatedAt = (group: PortfolioAssetGroup) =>
  group.lots
    .filter((lot) => lot.priceSource === "MANUAL" && lot.latestPriceFetchedAt)
    .map((lot) => lot.latestPriceFetchedAt as string)
    .sort((left, right) => right.localeCompare(left))[0];

export default function ManualAssetPriceDialog({
  group,
  pending,
  error,
  onUpdate,
  onClear,
  onClose,
}: ManualAssetPriceDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const priceInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const isBusyRef = useRef(false);
  const priceId = useId();
  const currencyId = useId();
  const formErrorId = useId();
  const isManual = hasManualAssetPrice(group);
  const [priceInput, setPriceInput] = useState(
    isManual && group.currentUnitPrice !== undefined ? String(group.currentUnitPrice) : ""
  );
  const [currency, setCurrency] = useState<CurrencyCode>(
    (group.marketCurrency || group.lots[0]?.marketCurrency || "PLN").toUpperCase()
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isBusy = pending || isSubmitting;
  onCloseRef.current = onClose;
  isBusyRef.current = isBusy;
  const updatedAt = getManualAssetPriceUpdatedAt(group);
  const currencies = Array.from(new Set([...SUPPORTED_CURRENCIES, currency.toUpperCase()]));

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => priceInputRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, []);

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError(null);
    setActionError(null);
    const normalized = priceInput.trim().replace(",", ".");
    if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) {
      setValidationError("Wpisz cenę jako dodatnią liczbę, np. 123,45.");
      return;
    }
    const price = Number(normalized);
    if (!Number.isFinite(price) || price <= 0) {
      setValidationError("Cena musi być większa od zera.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onUpdate(group, price, currency);
      onClose();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Nie udało się zapisać ceny. Spróbuj ponownie.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClear = async () => {
    setActionError(null);
    setIsSubmitting(true);
    try {
      await onClear(group);
      onClose();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Nie udało się usunąć ceny ręcznej. Spróbuj ponownie.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="import-platform-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="import-platform-modal"
        style={{
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr) auto",
          width: "min(480px, 100%)",
          maxHeight: "min(620px, calc(100dvh - 32px))",
          overflowY: "auto",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-price-title"
        aria-describedby="manual-price-description"
      >
        <header className="import-platform-modal-head">
          <div>
            <p className="eyebrow">Wycena pozycji</p>
            <h2 id="manual-price-title" className="section-title">
              {isManual ? "Zmień cenę ręczną" : "Ustaw cenę ręcznie"}
            </h2>
            <p className="section-copy">
              {group.name} <span aria-hidden="true">·</span> {group.symbol}
            </p>
          </div>
          <button
            type="button"
            className="ghost-button import-platform-close"
            onClick={onClose}
            disabled={isBusy}
            aria-label="Zamknij okno ceny ręcznej"
          >
            Zamknij
          </button>
        </header>

        <form id="manual-price-form" className="manual-price-form grid gap-4" onSubmit={(event) => void handleSave(event)}>
          <p id="manual-price-description" className="field-note">
            Podaj bieżącą cenę za jedną jednostkę. Wybrana waluta jest walutą notowania — Mexo nie zakłada ani nie zgaduje przewalutowania.
          </p>

          {isManual && updatedAt ? (
            <p className="field-note">
              Ostatnia aktualizacja ręczna: <strong>{formatDateTime(updatedAt)}</strong>
            </p>
          ) : null}
          {isManual ? (
            <p className="field-note">
              Po usunięciu ceny Mexo wznowi automatyczne notowania; jeśli provider nie ma kursu, pozycja znów pokaże brak kursu.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="field" htmlFor={priceId}>
              <span>Cena za jednostkę</span>
              <input
                ref={priceInputRef}
                id={priceId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={priceInput}
                onChange={(event) => {
                  setPriceInput(event.target.value);
                  setValidationError(null);
                  setActionError(null);
                }}
                aria-invalid={Boolean(validationError)}
                aria-describedby={validationError ? formErrorId : undefined}
                placeholder="0,00"
                disabled={isBusy}
                required
              />
            </label>

            <label className="field" htmlFor={currencyId}>
              <span>Waluta notowania</span>
              <select
                id={currencyId}
                value={currency.toUpperCase()}
                onChange={(event) => setCurrency(event.target.value)}
                disabled={isBusy}
              >
                {currencies.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          </div>

          {validationError ? <p id={formErrorId} className="field-note field-note-error" role="alert">{validationError}</p> : null}
          {actionError || error ? <p className="field-note field-note-error" role="alert">{actionError || error}</p> : null}
        </form>

        <footer className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {isManual ? (
              <button type="button" className="ghost-button" onClick={() => void handleClear()} disabled={isBusy}>
                {isBusy ? "Zapisywanie…" : "Usuń cenę ręczną"}
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="ghost-button" onClick={onClose} disabled={isBusy}>Anuluj</button>
            <button type="submit" form="manual-price-form" className="primary-button" disabled={isBusy}>
              {isBusy ? "Zapisywanie…" : "Zapisz cenę"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
