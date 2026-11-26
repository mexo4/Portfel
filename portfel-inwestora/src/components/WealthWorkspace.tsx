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
import { addMonths, getDepositState, getLoanState, getWealthItemValue } from "@/lib/wealth-instruments";
import WealthReportPanel from "@/components/WealthReportPanel";
import type {
  CurrencyCode,
  FxRates,
  InvestmentPortfolio,
  PortfolioSummary,
  UserProfile,
  WealthCategory,
  WealthItem,
  WealthItemKind,
} from "@/types/portfolio";

type WealthWorkspaceProps = {
  profile: UserProfile;
  fxRates: FxRates;
  onChange: (profile: UserProfile) => void;
  /** Every real portfolio with its summary, for the wealth report. */
  portfolioSummaries?: Array<{ portfolio: InvestmentPortfolio; summary: PortfolioSummary }>;
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
  /** Deposit and loan terms (used for the "Lokata" category and for loans with a schedule). */
  termMonths: number;
  ratePercent: number;
  capitalization: "maturity" | "monthly" | "quarterly";
  taxed: boolean;
  useSchedule: boolean;
  installment: "equal" | "decreasing";
};

const LOAN_CATEGORIES = new Set<WealthCategory>(["mortgage", "car-loan", "loan"]);
const isDepositDraft = (draft: Pick<WealthDraft, "kind" | "category">) => draft.kind === "asset" && draft.category === "deposit";
const isScheduledLoanDraft = (draft: Pick<WealthDraft, "kind" | "category" | "useSchedule">) => draft.kind === "liability" && LOAN_CATEGORIES.has(draft.category) && draft.useSchedule;
const addOneYear = (date: string) => addMonths(date, 12);

const ASSET_CATEGORIES: Array<{ value: WealthCategory; label: string }> = [
  { value: "house", label: "Dom" },
  { value: "apartment", label: "Mieszkanie" },
  { value: "land", label: "Działka" },
  { value: "car", label: "Samochód" },
  { value: "motorcycle", label: "Motocykl" },
  { value: "gold", label: "Złoto" },
  { value: "art", label: "Dzieła sztuki" },
  { value: "collection", label: "Kolekcje" },
  { value: "deposit", label: "Lokata" },
  { value: "other", label: "Inne" },
];

const LIABILITY_CATEGORIES: Array<{ value: WealthCategory; label: string }> = [
  { value: "mortgage", label: "Kredyt hipoteczny" },
  { value: "car-loan", label: "Kredyt samochodowy" },
  { value: "loan", label: "Pożyczka" },
  { value: "other-liability", label: "Inne zobowiązanie" },
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
  termMonths: 12,
  ratePercent: 0,
  capitalization: "maturity",
  taxed: true,
  useSchedule: false,
  installment: "equal",
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
  (kind === "asset" ? "Inne" : "Inne zobowiązanie");

const getCurrencyRate = (currency: CurrencyCode, fxRates: FxRates) => {
  if (currency === "PLN") {
    return 1;
  }

  const rate = fxRates[currency];
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : 1;
};

/** One line about a deposit's or a loan's terms and where they stand today. */
const describeWealthTerms = (item: WealthItem, today: string) => {
  if (item.kind === "asset" && item.deposit) {
    const state = getDepositState(item.deposit, today);
    return state.isMatured
      ? `Lokata zakończona ${formatDate(state.maturityDate)} · odsetki netto ${formatCurrency(state.interestAtMaturityNet, item.currency)}`
      : `${formatNumber(item.deposit.annualRatePercent, 2)}% do ${formatDate(state.maturityDate)} · narosło ${formatCurrency(state.interestNet, item.currency)} · na koniec ${formatCurrency(state.interestAtMaturityNet, item.currency)}${item.deposit.taxed ? " netto" : ""}`;
  }
  if (item.kind === "liability" && item.loan) {
    const state = getLoanState(item.loan, today);
    return state.remainingInstallments === 0
      ? `Kredyt spłacony ${formatDate(state.endDate)}`
      : `Rata ${formatCurrency(state.nextInstallment?.payment ?? 0, item.currency)} (${formatDate(state.nextInstallment?.date)}) · zostało ${state.remainingInstallments} rat · odsetki zapłacone ${formatCurrency(state.paidInterest, item.currency)}, do zapłaty ${formatCurrency(state.remainingInterest, item.currency)}`;
  }
  return null;
};

const getProjectedValue = (value: number, annualChangePercent: number, years = 1) =>
  round(value * (1 + annualChangePercent / 100) ** years, 2);

export default function WealthWorkspace({
  profile,
  fxRates,
  onChange,
  portfolioSummaries = [],
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
        const today = getTodayDateInputValue();
        const value = getWealthItemValue(item, today);
        const valuePln = round(value * rate, 2);
        // A deposit and a scheduled loan follow their terms over the next year, not a growth rate.
        const projectedValue = item.deposit || item.loan
          ? getWealthItemValue(item, addOneYear(today))
          : getProjectedValue(item.value, item.annualChangePercent);
        const projectedValuePln = round(projectedValue * rate, 2);

        return {
          item,
          value,
          valuePln,
          projectedValue,
          projectedValuePln,
          detail: describeWealthTerms(item, today),
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
      setError("Podaj nazwę pozycji majątku.");
      nameRef.current?.focus();
      return;
    }

    if (!Number.isFinite(value) || value <= 0) {
      setError("Podaj dodatnią wartość pozycji.");
      valueRef.current?.focus();
      return;
    }

    if (!addedAt) {
      setError("Podaj poprawną datę dodania.");
      dateRef.current?.focus();
      return;
    }

    const termMonths = Math.round(draft.termMonths);
    const hasTerms = isDepositDraft(draft) || isScheduledLoanDraft(draft);
    if (hasTerms && (!Number.isFinite(termMonths) || termMonths < 1 || termMonths > 600)) {
      setError("Podaj okres od 1 do 600 miesięcy.");
      return;
    }
    if (hasTerms && (!Number.isFinite(draft.ratePercent) || draft.ratePercent < 0 || draft.ratePercent > 100)) {
      setError("Podaj oprocentowanie od 0 do 100%.");
      return;
    }
    const terms = { principal: value, startDate: addedAt, termMonths, annualRatePercent: round(draft.ratePercent, 4) };

    // A new value of a typed-in item applies from today; the earlier one stays in its history.
    const previous = profile.wealthItems.find((item) => item.id === draft.editingId);
    const isTypedIn = !isDepositDraft(draft) && !isScheduledLoanDraft(draft);
    const today = getTodayDateInputValue();
    const valueHistory = !isTypedIn || !previous || previous.deposit || previous.loan
      ? undefined
      : previous.value === value
        ? previous.valueHistory
        : [...(previous.valueHistory ?? [{ date: previous.addedAt, value: previous.value }]).filter((entry) => entry.date !== today), { date: today, value }];

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
      ...(isDepositDraft(draft) ? { deposit: { ...terms, capitalization: draft.capitalization, taxed: draft.taxed } } : {}),
      ...(isScheduledLoanDraft(draft) ? { loan: { ...terms, installment: draft.installment } } : {}),
      ...(valueHistory ? { valueHistory } : {}),
      createdAt: previous?.createdAt ?? now,
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
      // The principal is what the terms start from; the computed value is shown on the list.
      value: item.deposit?.principal ?? item.loan?.principal ?? item.value,
      currency: item.currency,
      addedAt: item.addedAt,
      description: item.description,
      annualChangePercent: item.annualChangePercent,
      termMonths: item.deposit?.termMonths ?? item.loan?.termMonths ?? 12,
      ratePercent: item.deposit?.annualRatePercent ?? item.loan?.annualRatePercent ?? 0,
      capitalization: item.deposit?.capitalization ?? "maturity",
      taxed: item.deposit?.taxed ?? true,
      useSchedule: Boolean(item.loan),
      installment: item.loan?.installment ?? "equal",
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
      <WealthReportPanel portfolioSummaries={portfolioSummaries} wealthItems={profile.wealthItems} fxRates={fxRates} />
      <section className="panel wealth-summary-panel">
        <div className="sprint-panel-head">
          <div>
            <p className="eyebrow">Majątek</p>
            <h2 className="section-title">Pulpit majątku</h2>
          </div>
          <span className="tag">{profile.wealthItems.length} pozycji</span>
        </div>

        <div className="wealth-summary-grid mt-6">
          <article className="metric-card">
            <span>Wartość aktywów</span>
            <strong>{formatCurrency(summary.assetsValuePln)}</strong>
          </article>
          <article className="metric-card">
            <span>Wartość pasywów</span>
            <strong>{formatCurrency(summary.liabilitiesValuePln)}</strong>
          </article>
          <article className="metric-card">
            <span>Majątek netto</span>
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
            odświeżenia kursów przeliczenie używa 1:1.
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
              placeholder="np. mieszkanie, samochód, kredyt"
            />
          </label>

          <FormattedNumberInput
            label={isDepositDraft(draft) ? "Kwota lokaty" : isScheduledLoanDraft(draft) ? "Kwota kredytu" : "Aktualna wartość"}
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
            <span>{isDepositDraft(draft) ? "Data założenia" : isScheduledLoanDraft(draft) ? "Data uruchomienia" : "Data dodania"}</span>
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

          {draft.kind === "liability" && LOAN_CATEGORIES.has(draft.category) ? (
            <label className="field">
              <span>Saldo kredytu</span>
              <span className="wealth-checkbox">
                <input type="checkbox" checked={draft.useSchedule} onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, useSchedule: event.target.checked }))} />
                Licz z harmonogramu spłat
              </span>
            </label>
          ) : null}

          {isDepositDraft(draft) || isScheduledLoanDraft(draft) ? (
            <>
              <FormattedNumberInput label="Okres (miesiące)" value={draft.termMonths} min={1} precision={0} onChange={(value) => setDraft((currentDraft) => ({ ...currentDraft, termMonths: value }))} />
              <FormattedNumberInput label="Oprocentowanie roczne (%)" value={draft.ratePercent} min={0} precision={2} onChange={(value) => setDraft((currentDraft) => ({ ...currentDraft, ratePercent: value }))} />
            </>
          ) : (
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
          )}

          {isDepositDraft(draft) ? (
            <>
              <label className="field">
                <span>Kapitalizacja odsetek</span>
                <select value={draft.capitalization} onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, capitalization: event.target.value as WealthDraft["capitalization"] }))}>
                  <option value="maturity">Na koniec okresu</option>
                  <option value="monthly">Co miesiąc</option>
                  <option value="quarterly">Co kwartał</option>
                </select>
              </label>
              <label className="field">
                <span>Podatek od odsetek</span>
                <span className="wealth-checkbox">
                  <input type="checkbox" checked={draft.taxed} onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, taxed: event.target.checked }))} />
                  Pobierany podatek 19%
                </span>
              </label>
            </>
          ) : null}

          {isScheduledLoanDraft(draft) ? (
            <label className="field">
              <span>Raty</span>
              <select value={draft.installment} onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, installment: event.target.value as WealthDraft["installment"] }))}>
                <option value="equal">Równe</option>
                <option value="decreasing">Malejące</option>
              </select>
            </label>
          ) : null}

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
            {draft.editingId ? "Zapisz pozycję" : "Dodaj pozycję"}
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
            <p className="eyebrow">Lista majątku</p>
            <h2 className="section-title">Aktywa i pasywa</h2>
          </div>
        </div>

        <div className="wealth-list mt-6">
          {rows.map(({ item, value, projectedValue, projectedValuePln, valuePln, detail }) => (
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
                  teraz <strong>{formatCurrency(value, item.currency)}</strong>
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
                {item.deposit || item.loan ? null : (
                  <span>
                    zmiana <strong>{formatNumber(item.annualChangePercent, 2)}%</strong>
                  </span>
                )}
              </div>

              {detail ? <p className="wealth-terms">{detail}</p> : null}

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
                  Usuń
                </button>
              </div>
            </article>
          ))}

          {rows.length === 0 ? (
            <p className="field-note">
              Nie dodano jeszcze pozycji majątku poza inwestycjami.
            </p>
          ) : null}
        </div>
      </section>
    </section>
  );
}
