"use client";

import { useMemo, useRef, useState } from "react";
import FormattedNumberInput from "@/components/FormattedNumberInput";
import {
  buildDividendCalendar,
  buildDividendForecast,
  buildDividendOperation,
  buildDividendReport,
  getDefaultDividendAccount,
  getDefaultDividendInstrument,
  getPortfolioDividends,
} from "@/lib/dividend-engine";
import { buildCashHistory, buildCashOperation, type CashOperationKind } from "@/lib/cash-engine";
import { calculateCashBalances } from "@/lib/operation-engine";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  getTodayDateInputValue,
  round,
  toCurrencyCode,
} from "@/lib/utils";
import type {
  DividendCalendarGroup,
  DividendReportBucket,
  FxRates,
  InvestmentPortfolio,
  PortfolioAccount,
  PortfolioDividend,
  PortfolioInstrument,
  PortfolioOperation,
} from "@/types/portfolio";

type DividendCashWorkspaceProps = {
  activeView: "dividends" | "cash";
  portfolio: InvestmentPortfolio;
  fxRates: FxRates;
  onOperationsChange: (operations: PortfolioOperation[]) => void;
};

type DividendDraft = {
  editingId: string | null;
  instrumentId: string;
  accountId: string;
  quantity: number;
  dividendPerShare: number;
  withholdingTax: number;
  domesticTax: number;
  currency: string;
  exchangeRate: number;
  exDividendDate: string;
  recordDate: string;
  paymentDate: string;
  country: string;
  notes: string;
};

type CashDraft = {
  operationType: CashOperationKind;
  accountId: string;
  targetAccountId: string;
  amount: number;
  currency: string;
  date: string;
  notes: string;
};

const DIVIDEND_REPORT_OPTIONS: Array<{
  value: DividendReportBucket;
  label: string;
}> = [
  { value: "monthly", label: "Miesiecznie" },
  { value: "quarterly", label: "Kwartalnie" },
  { value: "yearly", label: "Rocznie" },
  { value: "company", label: "Wedlug spolki" },
  { value: "portfolio", label: "Wedlug portfela" },
  { value: "currency", label: "Wedlug waluty" },
  { value: "country", label: "Wedlug kraju" },
];

const CASH_OPERATION_OPTIONS: Array<{
  value: CashOperationKind;
  label: string;
}> = [
  { value: "DEPOSIT", label: "Wplata" },
  { value: "WITHDRAW", label: "Wyplata" },
  { value: "TRANSFER", label: "Przelew" },
  { value: "INTEREST", label: "Odsetki" },
  { value: "FEE", label: "Prowizja / oplata" },
  { value: "CUSTOM", label: "Korekta gotowki" },
];

const createClientOperationId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getAccountLabel = (account: PortfolioAccount) =>
  `${account.name} (${account.currency}, ${account.kind})`;

const getInstrumentLabel = (instrument: PortfolioInstrument) =>
  `${instrument.symbol} - ${instrument.name}`;

const getOpenQuantityForInstrument = (
  portfolio: InvestmentPortfolio,
  instrument: PortfolioInstrument | null
) => {
  if (!instrument?.assetKind) return 0;

  return round(
    portfolio.assets
      .filter(
        (asset) =>
          asset.kind === instrument.assetKind && asset.symbol === instrument.symbol
      )
      .reduce((total, asset) => total + asset.quantity, 0),
    6
  );
};

const getDefaultDividendDraft = (portfolio: InvestmentPortfolio): DividendDraft => {
  const instrument = getDefaultDividendInstrument(portfolio);
  const account = getDefaultDividendAccount(portfolio.accounts);
  const currency = instrument?.marketCurrency ?? account?.currency ?? "PLN";
  const today = getTodayDateInputValue();

  return {
    editingId: null,
    instrumentId: instrument?.id ?? "",
    accountId: account?.id ?? "",
    quantity: getOpenQuantityForInstrument(portfolio, instrument),
    dividendPerShare: 0,
    withholdingTax: 0,
    domesticTax: 0,
    currency,
    exchangeRate: currency === "PLN" ? 1 : 0,
    exDividendDate: today,
    recordDate: today,
    paymentDate: today,
    country: currency === "PLN" ? "PL" : "",
    notes: "",
  };
};

const getDefaultCashDraft = (portfolio: InvestmentPortfolio): CashDraft => {
  const account =
    portfolio.accounts?.find((item) => item.kind === "cash") ??
    portfolio.accounts?.find((item) => item.kind === "currency") ??
    portfolio.accounts?.[0];

  return {
    operationType: "DEPOSIT",
    accountId: account?.id ?? "",
    targetAccountId: "",
    amount: 0,
    currency: account?.currency ?? "PLN",
    date: getTodayDateInputValue(),
    notes: "",
  };
};

const getDividendSummary = (dividends: PortfolioDividend[]) => {
  const today = getTodayDateInputValue();
  const currentYear = today.slice(0, 4);
  const currentMonth = today.slice(0, 7);

  return {
    ytd: round(
      dividends
        .filter((dividend) => dividend.paymentDate.slice(0, 4) === currentYear)
        .reduce((total, dividend) => total + dividend.netAmountPln, 0)
    ),
    month: round(
      dividends
        .filter((dividend) => dividend.paymentDate.slice(0, 7) === currentMonth)
        .reduce((total, dividend) => total + dividend.netAmountPln, 0)
    ),
    taxes: round(
      dividends.reduce(
        (total, dividend) => total + dividend.grossAmountPln - dividend.netAmountPln,
        0
      )
    ),
    gross: round(dividends.reduce((total, dividend) => total + dividend.grossAmountPln, 0)),
    net: round(dividends.reduce((total, dividend) => total + dividend.netAmountPln, 0)),
  };
};

const getReportLabel = (label: string, portfolio: InvestmentPortfolio) =>
  label === portfolio.id ? portfolio.name : label;

export default function DividendCashWorkspace({
  activeView,
  portfolio,
  fxRates,
  onOperationsChange,
}: DividendCashWorkspaceProps) {
  const [dividendDraft, setDividendDraft] = useState(() =>
    getDefaultDividendDraft(portfolio)
  );
  const [cashDraft, setCashDraft] = useState(() => getDefaultCashDraft(portfolio));
  const [dividendReportBucket, setDividendReportBucket] =
    useState<DividendReportBucket>("monthly");
  const [dividendError, setDividendError] = useState<string | null>(null);
  const [cashError, setCashError] = useState<string | null>(null);
  const dividendInstrumentRef = useRef<HTMLSelectElement | null>(null);
  const dividendQuantityRef = useRef<HTMLInputElement | null>(null);
  const dividendPerShareRef = useRef<HTMLInputElement | null>(null);
  const dividendPaymentDateRef = useRef<HTMLInputElement | null>(null);
  const cashAccountRef = useRef<HTMLSelectElement | null>(null);
  const cashAmountRef = useRef<HTMLInputElement | null>(null);
  const cashDateRef = useRef<HTMLInputElement | null>(null);

  const accounts = portfolio.accounts ?? [];
  const investmentAccounts = accounts.filter((account) => account.kind === "investment");
  const cashAccounts = accounts.filter(
    (account) =>
      account.kind === "cash" ||
      account.kind === "currency" ||
      account.kind === "investment"
  );
  const instruments = (portfolio.instruments ?? []).filter(
    (instrument) => instrument.type !== "CASH"
  );
  const dividends = useMemo(
    () => getPortfolioDividends(portfolio, fxRates),
    [fxRates, portfolio]
  );
  const dividendSummary = useMemo(() => getDividendSummary(dividends), [dividends]);
  const dividendReports = useMemo(
    () => buildDividendReport(dividends, dividendReportBucket),
    [dividendReportBucket, dividends]
  );
  const dividendCalendar = useMemo(() => buildDividendCalendar(dividends), [dividends]);
  const dividendForecast = useMemo(() => buildDividendForecast(dividends), [dividends]);
  const cashBalances = useMemo(
    () => calculateCashBalances(portfolio.operations ?? []),
    [portfolio.operations]
  );
  const cashHistory = useMemo(() => buildCashHistory(portfolio), [portfolio]);
  const selectedDividendInstrument =
    instruments.find((instrument) => instrument.id === dividendDraft.instrumentId) ?? null;
  const selectedDividendCurrency = toCurrencyCode(
    dividendDraft.currency,
    selectedDividendInstrument?.marketCurrency ?? "PLN"
  );
  const dividendGross = round(dividendDraft.quantity * dividendDraft.dividendPerShare, 6);
  const dividendNet = round(
    dividendGross - dividendDraft.withholdingTax - dividendDraft.domesticTax,
    6
  );
  const dividendGrossPln = round(
    dividendGross * (selectedDividendCurrency === "PLN" ? 1 : dividendDraft.exchangeRate)
  );
  const dividendNetPln = round(
    dividendNet * (selectedDividendCurrency === "PLN" ? 1 : dividendDraft.exchangeRate)
  );

  const replaceOperations = (operations: PortfolioOperation[]) => {
    onOperationsChange(operations);
  };

  const resetDividendDraft = () => {
    setDividendDraft(getDefaultDividendDraft(portfolio));
    setDividendError(null);
  };

  const handleDividendInstrumentChange = (instrumentId: string) => {
    const instrument = instruments.find((item) => item.id === instrumentId) ?? null;
    const currency = instrument?.marketCurrency ?? "PLN";

    setDividendDraft((currentDraft) => ({
      ...currentDraft,
      instrumentId,
      quantity: getOpenQuantityForInstrument(portfolio, instrument),
      currency,
      exchangeRate: currency === "PLN" ? 1 : fxRates[currency] ?? 0,
      country: currency === "PLN" ? "PL" : currentDraft.country,
    }));
    setDividendError(null);
  };

  const editDividend = (dividend: PortfolioDividend) => {
    setDividendDraft({
      editingId: dividend.operationId,
      instrumentId: dividend.instrumentId,
      accountId: dividend.accountId,
      quantity: dividend.quantity,
      dividendPerShare: dividend.dividendPerShare,
      withholdingTax: dividend.withholdingTax,
      domesticTax: dividend.domesticTax,
      currency: dividend.currency,
      exchangeRate: dividend.exchangeRate ?? (dividend.currency === "PLN" ? 1 : 0),
      exDividendDate: dividend.exDividendDate,
      recordDate: dividend.recordDate,
      paymentDate: dividend.paymentDate,
      country: dividend.country,
      notes: dividend.notes,
    });
    setDividendError(null);
    dividendInstrumentRef.current?.focus();
  };

  const deleteDividend = (dividend: PortfolioDividend) => {
    replaceOperations(
      (portfolio.operations ?? []).filter(
        (operation) => operation.id !== dividend.operationId
      )
    );
  };

  const saveDividend = () => {
    const instrument = instruments.find(
      (item) => item.id === dividendDraft.instrumentId
    );
    const account = investmentAccounts.find(
      (item) => item.id === dividendDraft.accountId
    );

    if (!instrument) {
      setDividendError("Wybierz instrument dla dywidendy.");
      dividendInstrumentRef.current?.focus();
      return;
    }

    if (!account) {
      setDividendError("Wybierz konto inwestycyjne.");
      dividendInstrumentRef.current?.focus();
      return;
    }

    if (dividendDraft.quantity <= 0) {
      setDividendError("Ilosc akcji musi byc wieksza od zera.");
      dividendQuantityRef.current?.focus();
      return;
    }

    if (dividendDraft.dividendPerShare <= 0) {
      setDividendError("Dywidenda na akcje musi byc wieksza od zera.");
      dividendPerShareRef.current?.focus();
      return;
    }

    if (!dividendDraft.paymentDate) {
      setDividendError("Podaj date wyplaty dywidendy.");
      dividendPaymentDateRef.current?.focus();
      return;
    }

    if (dividendNet < 0) {
      setDividendError("Podatki nie moga byc wyzsze niz dywidenda brutto.");
      dividendPerShareRef.current?.focus();
      return;
    }

    if (selectedDividendCurrency !== "PLN" && dividendDraft.exchangeRate <= 0) {
      setDividendError("Podaj kurs przewalutowania dla dywidendy walutowej.");
      dividendPerShareRef.current?.focus();
      return;
    }

    const existingOperation = (portfolio.operations ?? []).find(
      (operation) => operation.id === dividendDraft.editingId
    );
    const operation = buildDividendOperation({
      id: dividendDraft.editingId ?? createClientOperationId("dividend"),
      portfolioId: portfolio.id,
      accountId: account.id,
      instrumentId: instrument.id,
      quantity: dividendDraft.quantity,
      dividendPerShare: dividendDraft.dividendPerShare,
      currency: selectedDividendCurrency,
      exchangeRate:
        selectedDividendCurrency === "PLN" ? 1 : dividendDraft.exchangeRate,
      withholdingTax: dividendDraft.withholdingTax,
      domesticTax: dividendDraft.domesticTax,
      exDividendDate: dividendDraft.exDividendDate,
      recordDate: dividendDraft.recordDate,
      paymentDate: dividendDraft.paymentDate,
      country: dividendDraft.country,
      notes: dividendDraft.notes,
      createdAt: existingOperation?.createdAt,
    });
    const nextOperation = {
      ...operation,
      updatedAt: new Date().toISOString(),
    };
    const currentOperations = portfolio.operations ?? [];

    replaceOperations(
      dividendDraft.editingId
        ? currentOperations.map((item) =>
            item.id === dividendDraft.editingId ? nextOperation : item
          )
        : [...currentOperations, nextOperation]
    );
    resetDividendDraft();
  };

  const saveCashOperation = () => {
    const account = cashAccounts.find((item) => item.id === cashDraft.accountId);
    const targetAccount = cashAccounts.find(
      (item) => item.id === cashDraft.targetAccountId
    );

    if (!account) {
      setCashError("Wybierz konto gotowkowe lub inwestycyjne.");
      cashAccountRef.current?.focus();
      return;
    }

    if (cashDraft.operationType === "TRANSFER" && !targetAccount) {
      setCashError("Wybierz konto docelowe przelewu.");
      cashAccountRef.current?.focus();
      return;
    }

    if (cashDraft.amount <= 0) {
      setCashError("Kwota operacji gotowkowej musi byc wieksza od zera.");
      cashAmountRef.current?.focus();
      return;
    }

    if (!cashDraft.date) {
      setCashError("Podaj date operacji gotowkowej.");
      cashDateRef.current?.focus();
      return;
    }

    const operation = buildCashOperation({
      id: createClientOperationId("cash"),
      portfolioId: portfolio.id,
      accountId: account.id,
      targetAccountId:
        cashDraft.operationType === "TRANSFER" ? targetAccount?.id : undefined,
      operationType: cashDraft.operationType,
      amount: cashDraft.amount,
      currency: toCurrencyCode(cashDraft.currency, account.currency),
      date: cashDraft.date,
      notes: cashDraft.notes,
    });

    replaceOperations([...(portfolio.operations ?? []), operation]);
    setCashDraft(getDefaultCashDraft(portfolio));
    setCashError(null);
  };

  return (
    <>
      <section className="panel panel-compact">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="eyebrow">Sprint 2</p>
            <h2 className="section-title">Dywidendy i gotowka</h2>
          </div>
          <p className="section-copy">
            Widok operacyjny aktywnego portfela oparty o operacje Portfolio Engine V2.
          </p>
        </div>

        <div className="metric-grid mt-6">
          <article className="metric-card">
            <span>Saldo gotowki</span>
            <strong>
              {formatCurrency(
                cashBalances.reduce(
                  (total, balance) =>
                    total + balance.amount * (fxRates[balance.currency] ?? 1),
                  0
                )
              )}
            </strong>
          </article>
          <article className="metric-card">
            <span>Dywidendy YTD</span>
            <strong>{formatCurrency(dividendSummary.ytd)}</strong>
          </article>
          <article className="metric-card">
            <span>Dywidendy w tym miesiacu</span>
            <strong>{formatCurrency(dividendSummary.month)}</strong>
          </article>
          <article className="metric-card">
            <span>Roczny dochod z dywidend</span>
            <strong>{formatCurrency(dividendForecast.annualIncomePln)}</strong>
          </article>
          <article className="metric-card metric-card-muted">
            <span>Najblizsza wyplata</span>
            <strong>
              {dividendForecast.nextPayment
                ? formatCurrency(
                    dividendForecast.nextPayment.netAmount,
                    dividendForecast.nextPayment.currency
                  )
                : "Brak"}
            </strong>
            <p className="metric-copy">
              {dividendForecast.nextPayment
                ? `${formatDate(dividendForecast.nextPayment.paymentDate)} / ${dividendForecast.nextPayment.symbol}`
                : dividendForecast.message ?? "Brak przyszlych dywidend."}
            </p>
          </article>
        </div>
      </section>

      {activeView === "dividends" ? (
        <section className="sprint-two-grid dividend-workspace-grid">
          <article className="panel sprint-wide-panel dividend-entry-panel">
            <div className="sprint-panel-head">
              <div>
                <p className="eyebrow">Dywidendy</p>
                <h2 className="section-title">
                  {dividendDraft.editingId ? "Edytuj dywidende" : "Dodaj dywidende"}
                </h2>
              </div>
              <span className="tag">{dividends.length} wyplat</span>
            </div>

            <div className="sprint-form-grid dividend-form-grid mt-6">
              <label className="field">
                <span>Instrument</span>
                <select
                  ref={dividendInstrumentRef}
                  value={dividendDraft.instrumentId}
                  onChange={(event) => handleDividendInstrumentChange(event.target.value)}
                >
                  <option value="">Wybierz instrument</option>
                  {instruments.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {getInstrumentLabel(instrument)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Konto inwestycyjne</span>
                <select
                  value={dividendDraft.accountId}
                  onChange={(event) =>
                    setDividendDraft((currentDraft) => ({
                      ...currentDraft,
                      accountId: event.target.value,
                    }))
                  }
                >
                  <option value="">Wybierz konto</option>
                  {investmentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {getAccountLabel(account)}
                    </option>
                  ))}
                </select>
              </label>

              <FormattedNumberInput
                label="Ilosc akcji"
                value={dividendDraft.quantity}
                min={0}
                inputRef={dividendQuantityRef}
                onChange={(value) =>
                  setDividendDraft((currentDraft) => ({
                    ...currentDraft,
                    quantity: value,
                  }))
                }
              />

              <FormattedNumberInput
                label={`Dywidenda na akcje (${selectedDividendCurrency})`}
                value={dividendDraft.dividendPerShare}
                min={0}
                inputRef={dividendPerShareRef}
                onChange={(value) =>
                  setDividendDraft((currentDraft) => ({
                    ...currentDraft,
                    dividendPerShare: value,
                  }))
                }
              />

              <FormattedNumberInput
                label={`Podatek u zrodla (${selectedDividendCurrency})`}
                value={dividendDraft.withholdingTax}
                min={0}
                onChange={(value) =>
                  setDividendDraft((currentDraft) => ({
                    ...currentDraft,
                    withholdingTax: value,
                  }))
                }
              />

              <FormattedNumberInput
                label={`Podatek krajowy (${selectedDividendCurrency})`}
                value={dividendDraft.domesticTax}
                min={0}
                onChange={(value) =>
                  setDividendDraft((currentDraft) => ({
                    ...currentDraft,
                    domesticTax: value,
                  }))
                }
              />

              <label className="field">
                <span>Waluta</span>
                <input
                  value={dividendDraft.currency}
                  onChange={(event) =>
                    setDividendDraft((currentDraft) => ({
                      ...currentDraft,
                      currency: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </label>

              <FormattedNumberInput
                label="Kurs przewalutowania"
                value={dividendDraft.exchangeRate}
                min={0}
                precision={6}
                onChange={(value) =>
                  setDividendDraft((currentDraft) => ({
                    ...currentDraft,
                    exchangeRate: value,
                  }))
                }
              />

              <label className="field">
                <span>Ex-dividend date</span>
                <input
                  type="date"
                  value={dividendDraft.exDividendDate}
                  onChange={(event) =>
                    setDividendDraft((currentDraft) => ({
                      ...currentDraft,
                      exDividendDate: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>Record date</span>
                <input
                  type="date"
                  value={dividendDraft.recordDate}
                  onChange={(event) =>
                    setDividendDraft((currentDraft) => ({
                      ...currentDraft,
                      recordDate: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>Payment date</span>
                <input
                  ref={dividendPaymentDateRef}
                  type="date"
                  value={dividendDraft.paymentDate}
                  onChange={(event) =>
                    setDividendDraft((currentDraft) => ({
                      ...currentDraft,
                      paymentDate: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>Kraj</span>
                <input
                  value={dividendDraft.country}
                  onChange={(event) =>
                    setDividendDraft((currentDraft) => ({
                      ...currentDraft,
                      country: event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="PL, US, DE"
                />
              </label>

              <label className="field field-full">
                <span>Notatka</span>
                <input
                  value={dividendDraft.notes}
                  onChange={(event) =>
                    setDividendDraft((currentDraft) => ({
                      ...currentDraft,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="np. kwartalna wyplata"
                />
              </label>
            </div>

            <div className="dividend-preview mt-5">
              <article>
                <span>Brutto</span>
                <strong>{formatCurrency(dividendGross, selectedDividendCurrency)}</strong>
                <small>{formatCurrency(dividendGrossPln)}</small>
              </article>
              <article>
                <span>Netto</span>
                <strong>{formatCurrency(dividendNet, selectedDividendCurrency)}</strong>
                <small>{formatCurrency(dividendNetPln)}</small>
              </article>
              <article>
                <span>Podatki</span>
                <strong>
                  {formatCurrency(
                    dividendDraft.withholdingTax + dividendDraft.domesticTax,
                    selectedDividendCurrency
                  )}
                </strong>
                <small>{formatNumber(dividendDraft.quantity)} szt.</small>
              </article>
            </div>

            {dividendError ? (
              <p className="field-note field-note-error mt-4">{dividendError}</p>
            ) : null}

            <div className="sprint-action-row mt-5">
              <button className="primary-button" type="button" onClick={saveDividend}>
                {dividendDraft.editingId ? "Zapisz dywidende" : "Dodaj dywidende"}
              </button>
              {dividendDraft.editingId ? (
                <button className="ghost-button" type="button" onClick={resetDividendDraft}>
                  Anuluj edycje
                </button>
              ) : null}
            </div>
          </article>

          <article className="panel sprint-wide-panel dividend-summary-panel">
            <div className="sprint-panel-head">
              <div>
                <p className="eyebrow">Raporty dywidend</p>
                <h2 className="section-title">Podsumowania i prognozy</h2>
              </div>
              <span className="tag">{formatCurrency(dividendSummary.net)} netto</span>
            </div>

            <div className="metric-grid mt-6">
              <article className="metric-card">
                <span>Suma brutto</span>
                <strong>{formatCurrency(dividendSummary.gross)}</strong>
              </article>
              <article className="metric-card">
                <span>Suma netto</span>
                <strong>{formatCurrency(dividendSummary.net)}</strong>
              </article>
              <article className="metric-card">
                <span>Podatki</span>
                <strong>{formatCurrency(dividendSummary.taxes)}</strong>
              </article>
              <article className="metric-card">
                <span>Liczba wyplat</span>
                <strong>{dividends.length}</strong>
              </article>
            </div>

            <div className="line-chart-range-tabs mt-6">
              {DIVIDEND_REPORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={
                    dividendReportBucket === option.value
                      ? "line-chart-range-tab is-active"
                      : "line-chart-range-tab"
                  }
                  onClick={() => setDividendReportBucket(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="report-list mt-5">
              {dividendReports.map((row) => (
                <div key={row.key} className="report-row">
                  <span>{getReportLabel(row.label, portfolio)}</span>
                  <strong>{formatCurrency(row.netAmountPln)}</strong>
                  <em>
                    brutto {formatCurrency(row.grossAmountPln)} / podatki{" "}
                    {formatCurrency(row.taxPln)} / {row.paymentsCount} wyplat
                  </em>
                </div>
              ))}
              {dividendReports.length === 0 ? (
                <p className="field-note">Brak dywidend do raportu.</p>
              ) : null}
            </div>

            <div className="dividend-forecast mt-6">
              <article>
                <span>Prognoza miesieczna</span>
                <strong>{formatCurrency(dividendForecast.monthlyIncomePln)}</strong>
              </article>
              <article>
                <span>Prognoza roczna</span>
                <strong>{formatCurrency(dividendForecast.annualIncomePln)}</strong>
              </article>
              <article>
                <span>Nastepna wyplata</span>
                <strong>
                  {dividendForecast.nextPayment
                    ? dividendForecast.nextPayment.symbol
                    : "Brak"}
                </strong>
                <small>
                  {dividendForecast.nextPayment
                    ? formatDate(dividendForecast.nextPayment.paymentDate)
                    : dividendForecast.message ?? "Nie ma zaplanowanej wyplaty."}
                </small>
              </article>
            </div>
          </article>

          <article className="panel sprint-wide-panel">
            <div className="sprint-panel-head">
              <div>
                <p className="eyebrow">Kalendarz dywidend</p>
                <h2 className="section-title">Dzis, tydzien, miesiac, przyszlosc i historia</h2>
              </div>
            </div>

            <div className="dividend-calendar-grid mt-6">
              {dividendCalendar.map((group) => (
                <CalendarGroup key={group.bucket} group={group} />
              ))}
            </div>
          </article>

          <article className="panel sprint-wide-panel">
            <div className="sprint-panel-head">
              <div>
                <p className="eyebrow">Historia dywidend</p>
                <h2 className="section-title">Wszystkie wyplaty</h2>
              </div>
            </div>

            <div className="sprint-table-wrap mt-5">
              <table className="portfolio-table sprint-table">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Konto</th>
                    <th>Daty</th>
                    <th>Brutto</th>
                    <th>Podatki</th>
                    <th>Netto</th>
                    <th>Akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {dividends.map((dividend) => (
                    <tr key={dividend.id}>
                      <td>
                        <strong>{dividend.symbol}</strong>
                        <p className="table-note">{dividend.instrumentName}</p>
                      </td>
                      <td>{dividend.accountName}</td>
                      <td>
                        platnosc {formatDate(dividend.paymentDate)}
                        <p className="table-note">
                          ex {formatDate(dividend.exDividendDate)} / record{" "}
                          {formatDate(dividend.recordDate)}
                        </p>
                      </td>
                      <td>{formatCurrency(dividend.grossAmount, dividend.currency)}</td>
                      <td>
                        {formatCurrency(
                          dividend.withholdingTax + dividend.domesticTax,
                          dividend.currency
                        )}
                      </td>
                      <td>
                        <strong>{formatCurrency(dividend.netAmount, dividend.currency)}</strong>
                        <p className="table-note">{formatCurrency(dividend.netAmountPln)}</p>
                      </td>
                      <td>
                        <div className="sprint-inline-actions">
                          <span>{formatNumber(dividend.quantity)} szt.</span>
                          <button
                            className="ghost-button"
                            type="button"
                            onClick={() => editDividend(dividend)}
                          >
                            Edytuj
                          </button>
                          <button
                            className="ghost-button admin-danger-button"
                            type="button"
                            onClick={() => deleteDividend(dividend)}
                          >
                            Usun
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {dividends.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <p className="empty-row">Brak dywidend w aktywnym portfelu.</p>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}

      {activeView === "cash" ? (
        <section className="sprint-two-grid">
          <article className="panel">
            <div className="sprint-panel-head">
              <div>
                <p className="eyebrow">Gotowka</p>
                <h2 className="section-title">Dodaj operacje gotowkowa</h2>
              </div>
              <span className="tag">{cashBalances.length} sald</span>
            </div>

            <div className="sprint-form-grid mt-6">
              <label className="field">
                <span>Typ operacji</span>
                <select
                  value={cashDraft.operationType}
                  onChange={(event) =>
                    setCashDraft((currentDraft) => ({
                      ...currentDraft,
                      operationType: event.target.value as CashOperationKind,
                    }))
                  }
                >
                  {CASH_OPERATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Konto</span>
                <select
                  ref={cashAccountRef}
                  value={cashDraft.accountId}
                  onChange={(event) => {
                    const account = cashAccounts.find(
                      (item) => item.id === event.target.value
                    );
                    setCashDraft((currentDraft) => ({
                      ...currentDraft,
                      accountId: event.target.value,
                      currency: account?.currency ?? currentDraft.currency,
                    }));
                  }}
                >
                  <option value="">Wybierz konto</option>
                  {cashAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {getAccountLabel(account)}
                    </option>
                  ))}
                </select>
              </label>

              {cashDraft.operationType === "TRANSFER" ? (
                <label className="field">
                  <span>Konto docelowe</span>
                  <select
                    value={cashDraft.targetAccountId}
                    onChange={(event) =>
                      setCashDraft((currentDraft) => ({
                        ...currentDraft,
                        targetAccountId: event.target.value,
                      }))
                    }
                  >
                    <option value="">Wybierz konto docelowe</option>
                    {cashAccounts
                      .filter((account) => account.id !== cashDraft.accountId)
                      .map((account) => (
                        <option key={account.id} value={account.id}>
                          {getAccountLabel(account)}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}

              <FormattedNumberInput
                label="Kwota"
                value={cashDraft.amount}
                min={0}
                inputRef={cashAmountRef}
                onChange={(value) =>
                  setCashDraft((currentDraft) => ({
                    ...currentDraft,
                    amount: value,
                  }))
                }
              />

              <label className="field">
                <span>Waluta</span>
                <input
                  value={cashDraft.currency}
                  onChange={(event) =>
                    setCashDraft((currentDraft) => ({
                      ...currentDraft,
                      currency: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </label>

              <label className="field">
                <span>Data</span>
                <input
                  ref={cashDateRef}
                  type="date"
                  value={cashDraft.date}
                  onChange={(event) =>
                    setCashDraft((currentDraft) => ({
                      ...currentDraft,
                      date: event.target.value,
                    }))
                  }
                />
              </label>

              <label className="field field-full">
                <span>Notatka</span>
                <input
                  value={cashDraft.notes}
                  onChange={(event) =>
                    setCashDraft((currentDraft) => ({
                      ...currentDraft,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="np. przelew z konta bankowego"
                />
              </label>
            </div>

            {cashError ? (
              <p className="field-note field-note-error mt-4">{cashError}</p>
            ) : null}

            <div className="sprint-action-row mt-5">
              <button className="primary-button" type="button" onClick={saveCashOperation}>
                Dodaj operacje gotowkowa
              </button>
            </div>
          </article>

          <article className="panel">
            <div className="sprint-panel-head">
              <div>
                <p className="eyebrow">Salda</p>
                <h2 className="section-title">Gotowka wg kont i walut</h2>
              </div>
            </div>

            <div className="cash-balance-list mt-6">
              {cashBalances.map((balance) => {
                const account = accounts.find((item) => item.id === balance.accountId);

                return (
                  <article key={`${balance.accountId}:${balance.currency}`}>
                    <span>{account?.name ?? "Konto"}</span>
                    <strong>{formatCurrency(balance.amount, balance.currency)}</strong>
                    <small>{balance.currency}</small>
                  </article>
                );
              })}
              {cashBalances.length === 0 ? (
                <p className="field-note">Brak operacji gotowkowych.</p>
              ) : null}
            </div>
          </article>

          <article className="panel sprint-wide-panel">
            <div className="sprint-panel-head">
              <div>
                <p className="eyebrow">Historia gotowki</p>
                <h2 className="section-title">Saldo po operacji</h2>
              </div>
              <span className="tag">{cashHistory.length} wpisow</span>
            </div>

            <div className="sprint-table-wrap mt-5">
              <table className="portfolio-table sprint-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Typ</th>
                    <th>Konto</th>
                    <th>Kwota</th>
                    <th>Waluta</th>
                    <th>Saldo po operacji</th>
                    <th>Notatka</th>
                  </tr>
                </thead>
                <tbody>
                  {cashHistory.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatDate(entry.date)}</td>
                      <td>{entry.operationType}</td>
                      <td>{entry.accountName}</td>
                      <td className={entry.amount >= 0 ? "tone-positive" : "tone-negative"}>
                        {formatCurrency(entry.amount, entry.currency)}
                      </td>
                      <td>{entry.currency}</td>
                      <td>{formatCurrency(entry.balanceAfter, entry.currency)}</td>
                      <td>
                        <span className="table-note">{entry.notes || "-"}</span>
                      </td>
                    </tr>
                  ))}
                  {cashHistory.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <p className="empty-row">Brak historii gotowki.</p>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      ) : null}
    </>
  );
}

function CalendarGroup({ group }: { group: DividendCalendarGroup }) {
  return (
    <article className="calendar-card">
      <div className="calendar-card-head">
        <strong>{group.label}</strong>
        <span>{group.dividends.length}</span>
      </div>
      <p className="table-note">
        netto {formatCurrency(group.netAmountPln)} / brutto{" "}
        {formatCurrency(group.grossAmountPln)}
      </p>
      <div className="calendar-list">
        {group.dividends.slice(0, 4).map((dividend) => (
          <div key={`${group.bucket}:${dividend.id}`} className="calendar-row">
            <span>{formatDate(dividend.paymentDate)}</span>
            <strong>{dividend.symbol}</strong>
            <em>{formatCurrency(dividend.netAmount, dividend.currency)}</em>
          </div>
        ))}
        {group.dividends.length === 0 ? (
          <p className="field-note">Brak wpisow.</p>
        ) : null}
      </div>
    </article>
  );
}
