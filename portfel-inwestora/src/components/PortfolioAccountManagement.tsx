"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  OKI_EFFECTIVE_DATE,
  OKI_ANNUAL_RULES,
  PORTFOLIO_ACCOUNT_TYPE_LABELS,
  PORTFOLIO_ACCOUNT_TYPE_LONG_LABELS,
  calculateOkiTax,
  estimateIkzeTaxBenefit,
  getAnnualContributionSummary,
  normalizePortfolioAccountConfiguration,
  normalizePortfolioAccountType,
} from "@/lib/portfolio-account-rules";
import { formatCurrency } from "@/lib/utils";
import type {
  IkzeLimitVariant,
  IkzeTaxEstimateRate,
  InvestmentPortfolio,
  PortfolioAccountConfiguration,
  PortfolioAccountType,
  PortfolioSummary,
} from "@/types/portfolio";

type AccountDraft = {
  accountType: PortfolioAccountType;
  ikzeLimitVariant: IkzeLimitVariant;
  ikzeTaxEstimateRate: "" | IkzeTaxEstimateRate;
};

type CreateDraft = AccountDraft & { name: string };

type Props = {
  portfolios: InvestmentPortfolio[];
  activePortfolio: InvestmentPortfolio | null | undefined;
  activePortfolioId: string;
  isAllPortfoliosSelected: boolean;
  summaries: Array<{ portfolio: InvestmentPortfolio; summary: PortfolioSummary }>;
  isPending: boolean;
  onSelect: (portfolioId: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onCreate: (input: {
    name: string;
    accountType: PortfolioAccountType;
    accountConfiguration: PortfolioAccountConfiguration;
  }) => Promise<void>;
  onUpdateAccount: (input: {
    accountType: PortfolioAccountType;
    accountConfiguration: PortfolioAccountConfiguration;
  }) => void;
};

const AVAILABLE_YEARS = [2024, 2025, 2026] as const;
const CURRENT_RULE_YEAR = 2026;

const createAccountDraft = (portfolio?: InvestmentPortfolio | null): AccountDraft => {
  const accountType = normalizePortfolioAccountType(portfolio?.accountType);
  const configuration = normalizePortfolioAccountConfiguration(
    portfolio?.accountConfiguration,
    accountType
  );
  return {
    accountType,
    ikzeLimitVariant: configuration.ikzeLimitVariant ?? "STANDARD",
    ikzeTaxEstimateRate: configuration.ikzeTaxEstimateRate ?? "",
  };
};

const toConfiguration = (draft: AccountDraft): PortfolioAccountConfiguration =>
  draft.accountType === "IKZE"
    ? {
        ikzeLimitVariant: draft.ikzeLimitVariant,
        ...(draft.ikzeTaxEstimateRate
          ? { ikzeTaxEstimateRate: draft.ikzeTaxEstimateRate }
          : {}),
      }
    : {};

function AccountTypeFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: AccountDraft;
  onChange: (nextDraft: AccountDraft) => void;
  idPrefix: string;
}) {
  return (
    <>
      <label className="field">
        <span>Typ rachunku</span>
        <select
          id={`${idPrefix}-type`}
          value={draft.accountType}
          onChange={(event) =>
            onChange({
              ...draft,
              accountType: event.target.value as PortfolioAccountType,
            })
          }
        >
          {Object.entries(PORTFOLIO_ACCOUNT_TYPE_LONG_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      {draft.accountType === "IKZE" ? (
        <>
          <label className="field">
            <span>Limit wpłat IKZE</span>
            <select
              value={draft.ikzeLimitVariant}
              onChange={(event) =>
                onChange({
                  ...draft,
                  ikzeLimitVariant: event.target.value as IkzeLimitVariant,
                })
              }
            >
              <option value="STANDARD">Podstawowy</option>
              <option value="BUSINESS">Dla osoby prowadzącej działalność</option>
            </select>
          </label>
          <label className="field">
            <span>Stawka do szacunku ulgi</span>
            <select
              value={draft.ikzeTaxEstimateRate}
              onChange={(event) =>
                onChange({
                  ...draft,
                  ikzeTaxEstimateRate: event.target.value
                    ? (Number(event.target.value) as IkzeTaxEstimateRate)
                    : "",
                })
              }
            >
              <option value="">Bez szacunku</option>
              <option value="0.12">12%</option>
              <option value="0.19">19%</option>
              <option value="0.32">32%</option>
            </select>
          </label>
        </>
      ) : null}
      {draft.accountType === "OKI" ? (
        <p className="field-note account-type-inline-note">
          Zasady OKI obowiązują od {OKI_EFFECTIVE_DATE}. Do tego dnia Mexo nie nalicza podatku OKI.
        </p>
      ) : null}
    </>
  );
}

function ContributionCard({ portfolio }: { portfolio: InvestmentPortfolio }) {
  const [year, setYear] = useState<number>(CURRENT_RULE_YEAR);
  const accountType = normalizePortfolioAccountType(portfolio.accountType);
  const configuration = normalizePortfolioAccountConfiguration(
    portfolio.accountConfiguration,
    accountType
  );
  const summary = getAnnualContributionSummary({ portfolio, year });
  const estimatedBenefit = estimateIkzeTaxBenefit({
    contributionSummary: summary,
    taxRate: configuration.ikzeTaxEstimateRate,
  });
  const progress = Math.max(0, Math.min(100, summary.utilizationPercent ?? 0));

  return (
    <article className="account-rule-card">
      <div className="account-rule-card-head">
        <div>
          <p className="eyebrow">Limit roczny</p>
          <h3>{PORTFOLIO_ACCOUNT_TYPE_LABELS[accountType]} · {year}</h3>
        </div>
        <div className="account-year-switch" aria-label="Rok limitu wpłat">
          {AVAILABLE_YEARS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={candidate === year ? "is-active" : ""}
              onClick={() => setYear(candidate)}
              aria-pressed={candidate === year}
            >
              {candidate}
            </button>
          ))}
        </div>
      </div>
      <div className="account-contribution-metrics">
        <div><span>Wpłacono</span><strong>{formatCurrency(summary.contributedPln, "PLN")}</strong></div>
        <div><span>Limit ustawowy</span><strong>{summary.limitPln === null ? "Brak danych" : formatCurrency(summary.limitPln, "PLN")}</strong></div>
        <div><span>Pozostało</span><strong>{summary.remainingPln === null ? "—" : formatCurrency(summary.remainingPln, "PLN")}</strong></div>
      </div>
      {summary.limitPln !== null ? (
        <div className="account-limit-progress" aria-label={`Wykorzystanie limitu ${summary.utilizationPercent ?? 0}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      <div className="account-rule-foot">
        <span>{summary.utilizationPercent === null ? "Limit nieznany" : `${summary.utilizationPercent}% limitu`}</span>
        {estimatedBenefit !== null ? <strong>Szacowana ulga: {formatCurrency(estimatedBenefit, "PLN")}</strong> : null}
      </div>
      {summary.exceededByPln > 0 ? (
        <p className="field-note field-note-error mt-3">
          Wpłaty przekraczają limit o {formatCurrency(summary.exceededByPln, "PLN")}. Mexo ostrzega, ale nie blokuje zapisu.
        </p>
      ) : null}
      {summary.missingFxOperations > 0 ? (
        <p className="field-note field-note-error mt-3">
          {summary.missingFxOperations} operacji nie ma wiarygodnego przeliczenia na PLN. Podsumowanie może być niepełne.
        </p>
      ) : null}
      {accountType === "IKZE" && configuration.ikzeTaxEstimateRate ? (
        <p className="field-note mt-3">
          Ulga jest wyłącznie szacunkiem dla stawki {Math.round(configuration.ikzeTaxEstimateRate * 100)}%; Mexo nie rozlicza PIT.
        </p>
      ) : null}
    </article>
  );
}

function OkiCard({
  portfolio,
  currentValuePln,
  aggregate = false,
}: {
  portfolio: InvestmentPortfolio;
  currentValuePln?: number;
  aggregate?: boolean;
}) {
  const tax = calculateOkiTax({ year: 2027, accounts: [] });
  const rule = OKI_ANNUAL_RULES[2027];
  return (
    <article className="account-rule-card account-rule-card-oki">
      <div className="account-rule-card-head">
        <div><p className="eyebrow">OKI · od 2027</p><h3>{portfolio.name}</h3></div>
        <span className="account-type-badge">OKI</span>
      </div>
      <div className="account-contribution-metrics">
        <div><span>Wartość dziś</span><strong>{typeof currentValuePln === "number" ? formatCurrency(currentValuePln, "PLN") : "—"}</strong></div>
        <div><span>Łączne zwolnienie</span><strong>{formatCurrency(rule.totalExemptionPln, "PLN")}</strong></div>
        <div><span>Stawka 2027</span><strong>{(rule.taxRate * 100).toFixed(2)}%</strong></div>
      </div>
      <p className="field-note">W limicie łącznym część oszczędnościowa ma własny próg {formatCurrency(rule.savingsExemptionPln, "PLN")} i pierwszeństwo. Wartość bieżąca nie jest ustawową średnią roczną.</p>
      <strong className="account-rule-state">Brak pełnej historii dziennych wycen</strong>
      <p className="field-note">{tax.note} Mexo nie stosuje uproszczenia „saldo × 0,85%”.</p>
      {aggregate ? (
        <p className="field-note account-aggregate-note">
          Rachunek pokazujemy osobno, ale ustawowy podatek OKI rozlicza się łącznie na poziomie podatnika.
        </p>
      ) : null}
    </article>
  );
}

function PortfolioAccountSettings({
  portfolio,
  isPending,
  onUpdate,
}: {
  portfolio: InvestmentPortfolio;
  isPending: boolean;
  onUpdate: Props["onUpdateAccount"];
}) {
  const [editDraft, setEditDraft] = useState<AccountDraft>(() => createAccountDraft(portfolio));
  return (
    <section className="panel portfolio-account-settings">
      <div className="sprint-panel-head">
        <div><p className="eyebrow">Typ rachunku</p><h2 className="section-title">{portfolio.name}</h2><p className="section-copy">Możesz poprawić klasyfikację rachunku bez przepisywania aktywów, operacji ani wyników.</p></div>
        <span className="account-type-badge account-type-badge-strong">{PORTFOLIO_ACCOUNT_TYPE_LABELS[normalizePortfolioAccountType(portfolio.accountType)]}</span>
      </div>
      <div className="portfolio-account-settings-grid mt-5">
        <AccountTypeFields draft={editDraft} onChange={setEditDraft} idPrefix="edit-account" />
      </div>
      <p className="field-note account-type-warning mt-4">Zmiana typu modyfikuje interpretację limitów i podatków. Nie zmienia historycznych kwot, pozycji, P/L ani stopy zwrotu.</p>
      <div className="sprint-action-row mt-4"><button type="button" className="primary-button" onClick={() => onUpdate({ accountType: editDraft.accountType, accountConfiguration: toConfiguration(editDraft) })} disabled={isPending}>{isPending ? "Zapisywanie…" : "Zapisz typ rachunku"}</button></div>
    </section>
  );
}

export default function PortfolioAccountManagement({
  portfolios,
  activePortfolio,
  activePortfolioId,
  isAllPortfoliosSelected,
  summaries,
  isPending,
  onSelect,
  onRename,
  onDelete,
  onCreate,
  onUpdateAccount,
}: Props) {
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateDraft>({
    name: `Portfel ${portfolios.length + 1}`,
    ...createAccountDraft(),
  });
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);
  const createDialogRef = useRef<HTMLElement | null>(null);
  const createNameInputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const createSubmittingRef = useRef(false);
  const okiPortfolios = portfolios.filter(
    (portfolio) => normalizePortfolioAccountType(portfolio.accountType) === "OKI"
  );
  const summaryByPortfolioId = new Map(
    summaries.map(({ portfolio, summary }) => [portfolio.id, summary] as const)
  );

  useEffect(() => {
    if (!isCreating) return;

    const previousBodyOverflow = document.body.style.overflow;
    const focusTimeout = window.setTimeout(() => createNameInputRef.current?.focus(), 0);
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.clearTimeout(focusTimeout);
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnTarget?.isConnected) {
        window.requestAnimationFrame(() => returnTarget.focus());
      }
    };
  }, [isCreating]);

  const openCreateModal = () => {
    if (isPending) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : createTriggerRef.current;
    setCreateDraft({ name: `Portfel ${portfolios.length + 1}`, ...createAccountDraft() });
    setCreateError(null);
    setIsCreating(true);
  };

  const closeCreateModal = () => {
    if (createSubmittingRef.current) return;
    setCreateError(null);
    setIsCreating(false);
  };

  const handleCreateKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCreateModal();
      return;
    }

    if (event.key !== "Tab" || !createDialogRef.current) return;

    const focusable = Array.from(
      createDialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      createDialogRef.current.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !createDialogRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !createDialogRef.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createSubmittingRef.current || isPending) return;

    const name = createDraft.name.trim();
    if (!name) {
      setCreateError("Wpisz nazwę portfela, aby kontynuować.");
      createNameInputRef.current?.focus();
      return;
    }
    if (name.length > 64) {
      setCreateError("Nazwa portfela może mieć maksymalnie 64 znaki.");
      createNameInputRef.current?.focus();
      return;
    }

    createSubmittingRef.current = true;
    setIsSubmittingCreate(true);
    setCreateError(null);
    try {
      await onCreate({
        name,
        accountType: createDraft.accountType,
        accountConfiguration: toConfiguration(createDraft),
      });
      setCreateDraft({ name: `Portfel ${portfolios.length + 2}`, ...createAccountDraft() });
      setIsCreating(false);
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : "";
      setCreateError(
        message && message.length <= 220
          ? message
          : "Nie udało się utworzyć portfela. Spróbuj ponownie za chwilę."
      );
    } finally {
      createSubmittingRef.current = false;
      setIsSubmittingCreate(false);
    }
  };

  return (
    <section className="portfolio-account-management">
      <section className="panel portfolio-hub-panel workspace-portfolio-manager" aria-busy={isPending}>
        <div className="portfolio-hub-head">
          <div>
            <p className="eyebrow">Portfele</p>
            <h2 className="section-title">Zarządzaj przestrzenią inwestycji</h2>
            <p className="section-copy">Każdy realny portfel ma własny typ rachunku. „Wszystkie portfele” pozostaje wyłącznie widokiem łącznym.</p>
          </div>
          <div className="portfolio-hub-actions">
            <button className="ghost-button" type="button" onClick={onRename} disabled={isPending || isAllPortfoliosSelected}>Zmień nazwę</button>
            <button className="ghost-button admin-danger-button" type="button" onClick={onDelete} disabled={portfolios.length <= 1 || isPending || isAllPortfoliosSelected}>{isPending ? "Zapisywanie…" : "Usuń portfel"}</button>
            <button ref={createTriggerRef} className="primary-button" type="button" onClick={openCreateModal} disabled={isPending}>Dodaj portfel</button>
          </div>
        </div>

        {isCreating ? (
          <div
            className="portfolio-create-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeCreateModal();
            }}
          >
            <section
              ref={createDialogRef}
              className="portfolio-create-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="portfolio-create-title"
              aria-describedby="portfolio-create-description"
              tabIndex={-1}
              onKeyDown={handleCreateKeyDown}
            >
              <header className="portfolio-create-header">
                <div className="portfolio-create-heading-mark" aria-hidden="true">+</div>
                <div>
                  <p className="eyebrow">Portfele</p>
                  <h2 id="portfolio-create-title">Nowy portfel</h2>
                  <p id="portfolio-create-description">Utwórz osobną przestrzeń do śledzenia inwestycji i wyników.</p>
                </div>
                <button
                  type="button"
                  className="portfolio-create-close"
                  aria-label="Zamknij okno tworzenia portfela"
                  onClick={closeCreateModal}
                  disabled={isSubmittingCreate}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </header>

              <form className="portfolio-create-form" onSubmit={(event) => void handleCreateSubmit(event)}>
                <div className="portfolio-create-body">
                  <label className="field portfolio-create-name" htmlFor="portfolio-create-name">
                    <span>Nazwa portfela</span>
                    <input
                      ref={createNameInputRef}
                      id="portfolio-create-name"
                      value={createDraft.name}
                      onChange={(event) => {
                        setCreateDraft((current) => ({ ...current, name: event.target.value }));
                        if (createError) setCreateError(null);
                      }}
                      maxLength={64}
                      autoComplete="off"
                      placeholder="np. Inwestycje długoterminowe"
                      aria-invalid={createError ? "true" : undefined}
                      aria-describedby={createError ? "portfolio-create-error" : undefined}
                      disabled={isSubmittingCreate}
                    />
                    <small>{createDraft.name.trim().length}/64 znaków</small>
                  </label>

                  <div className="portfolio-create-account-fields">
                    <AccountTypeFields
                      draft={createDraft}
                      onChange={(next) => setCreateDraft((current) => ({ ...current, ...next }))}
                      idPrefix="create-account"
                    />
                  </div>

                  {createError ? (
                    <p id="portfolio-create-error" className="portfolio-create-error" role="alert">
                      <span aria-hidden="true">!</span>{createError}
                    </p>
                  ) : null}
                </div>

                <footer className="portfolio-create-footer">
                  <button type="button" className="ghost-button" onClick={closeCreateModal} disabled={isSubmittingCreate}>
                    Anuluj
                  </button>
                  <button type="submit" className="primary-button" disabled={isSubmittingCreate || isPending}>
                    {isSubmittingCreate ? "Tworzenie…" : "Utwórz portfel"}
                  </button>
                </footer>
              </form>
            </section>
          </div>
        ) : null}

        <div className="portfolio-card-grid mt-5">
          {summaries.map(({ portfolio, summary }) => {
            const isActive = portfolio.id === activePortfolioId && !isAllPortfoliosSelected;
            const accountType = normalizePortfolioAccountType(portfolio.accountType);
            return (
              <button key={portfolio.id} type="button" className={`portfolio-switch-card${isActive ? " is-active" : ""}`} onClick={() => onSelect(portfolio.id)} disabled={isPending} aria-pressed={isActive}>
                <span className="portfolio-card-kicker"><span>{isActive ? "Aktywny portfel" : "Przełącz"}</span><span className="account-type-badge">{PORTFOLIO_ACCOUNT_TYPE_LABELS[accountType]}</span></span>
                <strong>{portfolio.name}</strong>
                <div><span>{formatCurrency(summary.totalValue, summary.currency)}</span><span className={summary.combinedProfitLoss >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(summary.combinedProfitLoss, summary.currency)}</span></div>
                <small>{summary.currency} · {summary.positionsCount} pozycji / {summary.salesCount} sprzedaży</small>
              </button>
            );
          })}
        </div>
      </section>

      {!isAllPortfoliosSelected && activePortfolio ? <PortfolioAccountSettings key={`${activePortfolio.id}:${activePortfolio.accountType}:${JSON.stringify(activePortfolio.accountConfiguration ?? {})}`} portfolio={activePortfolio} isPending={isPending} onUpdate={onUpdateAccount} /> : null}

      {!isAllPortfoliosSelected && activePortfolio && ["IKE", "IKZE"].includes(normalizePortfolioAccountType(activePortfolio.accountType)) ? <ContributionCard portfolio={activePortfolio} /> : null}
      {!isAllPortfoliosSelected && activePortfolio && normalizePortfolioAccountType(activePortfolio.accountType) === "OKI" ? <OkiCard portfolio={activePortfolio} currentValuePln={summaryByPortfolioId.get(activePortfolio.id)?.totalValuePln} /> : null}
      {isAllPortfoliosSelected && okiPortfolios.length > 0 ? (
        <section className="panel portfolio-account-aggregate">
          <div><p className="eyebrow">OKI · wszystkie portfele</p><h2 className="section-title">Rachunki pokazane osobno</h2><p className="section-copy">Mexo nie łączy rachunków w fikcyjny portfel podatkowy. Ostateczne rozliczenie OKI dotyczy podatnika.</p></div>
          <div className="portfolio-account-rule-grid mt-5">{okiPortfolios.map((portfolio) => <OkiCard key={portfolio.id} portfolio={portfolio} currentValuePln={summaryByPortfolioId.get(portfolio.id)?.totalValuePln} aggregate />)}</div>
        </section>
      ) : null}
    </section>
  );
}
