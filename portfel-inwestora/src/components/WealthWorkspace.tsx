"use client";

import { useMemo, useRef, useState } from "react";
import FormattedNumberInput from "@/components/FormattedNumberInput";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  getTodayDateInputValue,
  round,
  toCurrencyCode,
  toDateInputValue,
} from "@/lib/utils";
import type {
  CurrencyCode,
  FxRates,
  UserProfile,
  WealthCategory,
  WealthItem,
  WealthItemKind,
} from "@/types/portfolio";

type WealthWorkspaceProps = {
  profile: UserProfile;
  fxRates: FxRates;
  onChange: (profile: UserProfile) => void;
};

type WealthDraft = {
  editingId: string | null;
  kind: WealthItemKind;
  name: string;
  category: WealthCategory;
  value: number;
  currency: CurrencyCode;
  addedAt: string;
  description: string;
  annualChangePercent: number;
};

const ASSET_CATEGORIES: Array<{ value: WealthCategory; label: string }> = [
  { value: "house", label: "Dom" },
  { value: "apartment", label: "Mieszkanie" },
  { value: "land", label: "Dzialka" },
  { value: "car", label: "Samochod" },
  { value: "motorcycle", label: "Motocykl" },
  { value: "gold", label: "Zloto" },
  { value: "art", label: "Dziela sztuki" },
  { value: "collection", label: "Kolekcje" },
  { value: "other", label: "Inne" },
];

const LIABILITY_CATEGORIES: Array<{ value: WealthCategory; label: string }> = [
  { value: "mortgage", label: "Kredyt hipoteczny" },
  { value: "car-loan", label: "Kredyt samochodowy" },
  { value: "loan", label: "Pozyczka" },
  { value: "other-liability", label: "Inne zobowiazanie" },
];

const CURRENCY_OPTIONS = ["PLN", "USD", "EUR", "GBP", "CHF", "CZK"];

const createEmptyWealthDraft = (): WealthDraft => ({
  editingId: null,
  kind: "asset",
  name: "",
  category: "house",
  value: 0,
  currency: "PLN",
  addedAt: getTodayDateInputValue(),
  description: "",
  annualChangePercent: 0,
});

const createWealthItemId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `wealth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getCategoriesForKind = (kind: WealthItemKind) =>
  kind === "asset" ? ASSET_CATEGORIES : LIABILITY_CATEGORIES;

const getCategoryLabel = (category: WealthCategory, kind: WealthItemKind) =>
  getCategoriesForKind(kind).find((option) => option.value === category)?.label ??
  (kind === "asset" ? "Inne" : "Inne zobowiazanie");

const getCurrencyRate = (currency: CurrencyCode, fxRates: FxRates) => {
  if (currency === "PLN") {
    return 1;
  }

  const rate = fxRates[currency];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1;
};

const getProjectedValue = (value: number, annualChangePercent: number, years = 1) =>
  round(value * (1 + annualChangePercent / 100) ** years, 2);

export default function WealthWorkspace({
  profile,
  fxRates,
  onChange,
}: WealthWorkspaceProps) {
  const nameRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef<HTMLInputElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<WealthDraft>(() => createEmptyWealthDraft());
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      profile.wealthItems.map((item) => {
        const rate = getCurrencyRate(item.currency, fxRates);
        const valuePln = round(item.value * rate, 2);
        const projectedValue = getProjectedValue(item.value, item.annualChangePercent);
        const projectedValuePln = round(projectedValue * rate, 2);

        return {
          item,
          valuePln,
          projectedValue,
          projectedValuePln,
        };
      }),
    [fxRates, profile.wealthItems]
  );

  const summary = useMemo(() => {
    const assetsValuePln = rows
      .filter((row) => row.item.kind === "asset")
      .reduce((total, row) => total + row.valuePln, 0);
    const liabilitiesValuePln = rows
      .filter((row) => row.item.kind === "liability")
      .reduce((total, row) => total + row.valuePln, 0);
    const projectedAssetsValuePln = rows
      .filter((row) => row.item.kind === "asset")
      .reduce((total, row) => total + row.projectedValuePln, 0);
    const projectedLiabilitiesValuePln = rows
      .filter((row) => row.item.kind === "liability")
      .reduce((total, row) => total + row.projectedValuePln, 0);

    return {
      assetsValuePln,
      liabilitiesValuePln,
      netWorthPln: assetsValuePln - liabilitiesValuePln,
      projectedNetWorthNextYearPln:
        projectedAssetsValuePln - projectedLiabilitiesValuePln,
    };
  }, [rows]);

  const missingFxCurrencies = useMemo(
    () =>
      Array.from(
        new Set(
          profile.wealthItems
            .map((item) => item.currency)
            .filter(
              (currency) =>
                currency !== "PLN" &&
                (typeof fxRates[currency] !== "number" || fxRates[currency] <= 0)
            )
        )
      ).sort(),
    [fxRates, profile.wealthItems]
  );

  const updateWealthItems = (items: WealthItem[]) => {
    onChange({
      ...profile,
      wealthItems: items,
      updatedAt: new Date().toISOString(),
    });
  };

  const resetDraft = () => {
    setDraft(createEmptyWealthDraft());
    setError(null);
  };

  const handleKindChange = (kind: WealthItemKind) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      kind,
      category: kind === "asset" ? "house" : "mortgage",
    }));
    setError(null);
  };

  const handleSave = () => {
    const now = new Date().toISOString();
    const name = draft.name.trim();
    const value = round(draft.value, 2);
    const addedAt = toDateInputValue(draft.addedAt, "");
    const categories = getCategoriesForKind(draft.kind);
    const category = categories.some((option) => option.value === draft.category)
      ? draft.category
      : categories[0].value;

    if (!name) {
      setError("Podaj nazwe pozycji majatku.");
      nameRef.current?.focus();
      return;
    }

    if (!Number.isFinite(value) || value <= 0) {
      setError("Podaj dodatnia wartosc pozycji.");
      valueRef.current?.focus();
      return;
    }

    if (!addedAt) {
      setError("Podaj poprawna date dodania.");
      dateRef.current?.focus();
      return;
    }

    const nextItem: WealthItem = {
      id: draft.editingId ?? createWealthItemId(),
      kind: draft.kind,
      name: name.slice(0, 96),
      category,
      value,
      currency: toCurrencyCode(draft.currency, "PLN"),
      addedAt,
      description: draft.description.trim().slice(0, 360),
      annualChangePercent: round(
        Math.max(-100, Math.min(1000, draft.annualChangePercent)),
        2
      ),
      createdAt:
        profile.wealthItems.find((item) => item.id === draft.editingId)?.createdAt ?? now,
      updatedAt: now,
    };

    updateWealthItems(
      draft.editingId
        ? profile.wealthItems.map((item) =>
            item.id === draft.editingId ? nextItem : item
          )
        : [nextItem, ...profile.wealthItems]
    );
    resetDraft();
  };

  const handleEdit = (item: WealthItem) => {
    setDraft({
      editingId: item.id,
      kind: item.kind,
      name: item.name,
      category: item.category,
      value: item.value,
      currency: item.currency,
      addedAt: item.addedAt,
      description: item.description,
      annualChangePercent: item.annualChangePercent,
    });
    setError(null);
    nameRef.current?.focus();
  };

  const handleDelete = (itemId: string) => {
    updateWealthItems(profile.wealthItems.filter((item) => item.id !== itemId));

    if (draft.editingId === itemId) {
      resetDraft();
    }
  };

  return (
    <section className="wealth-workspace">
      <section className="panel wealth-summary-panel">
        <div className="sprint-panel-head">
          <div>
            <p className="eyebrow">Majatek</p>
            <h2 className="section-title">Dashboard majatku</h2>
          </div>
          <span className="tag">{profile.wealthItems.length} pozycji</span>
        </div>

        <div className="wealth-summary-grid mt-6">
          <article className="metric-card">
            <span>Wartosc aktywow</span>
            <strong>{formatCurrency(summary.assetsValuePln)}</strong>
          </article>
          <article className="metric-card">
            <span>Wartosc pasywow</span>
            <strong>{formatCurrency(summary.liabilitiesValuePln)}</strong>
          </article>
          <article className="metric-card">
            <span>Majatek netto</span>
            <strong
              className={summary.netWorthPln >= 0 ? "tone-positive" : "tone-negative"}
            >
              {formatCurrency(summary.netWorthPln)}
            </strong>
          </article>
          <article className="metric-card metric-card-muted">
            <span>Prognoza za rok</span>
            <strong>{formatCurrency(summary.projectedNetWorthNextYearPln)}</strong>
          </article>
        </div>

        {missingFxCurrencies.length > 0 ? (
          <p className="field-note mt-4">
            Brak kursu FX dla {missingFxCurrencies.join(", ")}. Do czasu
            odswiezenia kursow przeliczenie uzywa 1:1.
          </p>
        ) : null}
      </section>

      <section className="panel wealth-entry-panel">
        <div className="sprint-panel-head">
          <div>
            <p className="eyebrow">Pozycje poza portfelem</p>
            <h2 className="section-title">
              {draft.editingId ? "Edytuj pozycje" : "Dodaj aktywo lub pasywo"}
            </h2>
          </div>
          <span className="tag">{draft.kind === "asset" ? "aktywo" : "pasywo"}</span>
        </div>

        <div className="wealth-form-grid mt-6">
          <label className="field">
            <span>Typ</span>
            <select
              value={draft.kind}
              onChange={(event) => handleKindChange(event.target.value as WealthItemKind)}
            >
              <option value="asset">Aktywo</option>
              <option value="liability">Pasywo</option>
            </select>
          </label>

          <label className="field">
            <span>Kategoria</span>
            <select
              value={draft.category}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  category: event.target.value as WealthCategory,
                }))
              }
            >
              {getCategoriesForKind(draft.kind).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Nazwa</span>
            <input
              ref={nameRef}
              value={draft.name}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  name: event.target.value,
                }))
              }
              placeholder="np. mieszkanie, samochod, kredyt"
            />
          </label>

          <FormattedNumberInput
            label="Aktualna wartosc"
            value={draft.value}
            min={0}
            precision={2}
            inputRef={valueRef}
            onChange={(value) =>
              setDraft((currentDraft) => ({
                ...currentDraft,
                value,
              }))
            }
          />

          <label className="field">
            <span>Waluta</span>
            <select
              value={draft.currency}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  currency: toCurrencyCode(event.target.value, "PLN"),
                }))
              }
            >
              {CURRENCY_OPTIONS.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Data dodania</span>
            <input
              ref={dateRef}
              type="date"
              value={draft.addedAt}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  addedAt: event.target.value,
                }))
              }
            />
          </label>

          <FormattedNumberInput
            label="Zmiana roczna (%)"
            value={draft.annualChangePercent}
            precision={2}
            onChange={(value) =>
              setDraft((currentDraft) => ({
                ...currentDraft,
                annualChangePercent: value,
              }))
            }
          />

          <label className="field field-full">
            <span>Opis</span>
            <input
              value={draft.description}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  description: event.target.value,
                }))
              }
              placeholder="np. lokalizacja, numer umowy, uwagi do wyceny"
            />
          </label>
        </div>

        {error ? <p className="field-note field-note-error mt-4">{error}</p> : null}

        <div className="sprint-action-row mt-5">
          <button className="primary-button" type="button" onClick={handleSave}>
            {draft.editingId ? "Zapisz pozycje" : "Dodaj pozycje"}
          </button>
          {draft.editingId ? (
            <button className="ghost-button" type="button" onClick={resetDraft}>
              Anuluj edycje
            </button>
          ) : null}
        </div>
      </section>

      <section className="panel wealth-list-panel">
        <div className="sprint-panel-head">
          <div>
            <p className="eyebrow">Lista majatku</p>
            <h2 className="section-title">Aktywa i pasywa</h2>
          </div>
        </div>

        <div className="wealth-list mt-6">
          {rows.map(({ item, projectedValue, projectedValuePln, valuePln }) => (
            <article key={item.id} className="wealth-item-card">
              <div>
                <span className="tag">{item.kind === "asset" ? "aktywo" : "pasywo"}</span>
                <h3>{item.name}</h3>
                <p className="table-note">
                  {getCategoryLabel(item.category, item.kind)} / dodano{" "}
                  {formatDate(item.addedAt)}
                </p>
              </div>

              <div className="wealth-item-values">
                <span>
                  teraz <strong>{formatCurrency(item.value, item.currency)}</strong>
                </span>
                <span>
                  PLN <strong>{formatCurrency(valuePln)}</strong>
                </span>
                <span>
                  za rok{" "}
                  <strong>{formatCurrency(projectedValue, item.currency)}</strong>
                </span>
                <span>
                  prognoza PLN <strong>{formatCurrency(projectedValuePln)}</strong>
                </span>
                <span>
                  zmiana <strong>{formatNumber(item.annualChangePercent, 2)}%</strong>
                </span>
              </div>

              {item.description ? (
                <p className="wealth-description">{item.description}</p>
              ) : null}

              <div className="sprint-inline-actions">
                <button className="ghost-button" type="button" onClick={() => handleEdit(item)}>
                  Edytuj
                </button>
                <button
                  className="ghost-button admin-danger-button"
                  type="button"
                  onClick={() => handleDelete(item.id)}
                >
                  Usun
                </button>
              </div>
            </article>
          ))}

          {rows.length === 0 ? (
            <p className="field-note">
              Nie dodano jeszcze pozycji majatku poza inwestycjami.
            </p>
          ) : null}
        </div>
      </section>
    </section>
  );
}
