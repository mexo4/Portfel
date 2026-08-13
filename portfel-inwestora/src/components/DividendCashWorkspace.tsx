"use client";

import { useMemo, useRef, useState } from "react";
import FormattedNumberInput from "@/components/FormattedNumberInput";
import TruncatedText from "@/components/TruncatedText";
import { getBlankDividendNumericInputs } from "@/lib/dividend-input-defaults";
import {
  buildDividendCalendar,
  buildDividendForecast,
  buildDividendOperation,
  buildDividendReport,
  getPortfolioDividends,
} from "@/lib/dividend-engine";
import { buildCashHistory, buildCashOperation, type CashOperationKind } from "@/lib/cash-engine";
import {
  calculateCashBalances,
  getDefaultCashAccountId,
  getDefaultCurrencyAccountId,
  getPortfolioInstrumentId,
} from "@/lib/operation-engine";
import { convertCurrency, convertFromPln } from "@/lib/pricing";
import { normalizeSymbol } from "@/lib/ticker";
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
  CurrencyCode,
  FxRates,
  InvestmentPortfolio,
  PortfolioAccount,
  PortfolioDividend,
  PortfolioInstrument,
  PortfolioOperation,
  QuoteProvider,
} from "@/types/portfolio";

type DividendCashWorkspaceProps = {
  activeView: "dividends" | "cash";
  portfolio: InvestmentPortfolio;
  fxRates: FxRates;
  baseCurrency: CurrencyCode;
  onPortfolioChange: (portfolio: InvestmentPortfolio) => void;
};

type DividendDraft = {
  editingId: string | null;
  instrumentId: string;
  instrumentSearch: string;
  useCustomInstrument: boolean;
  customInstrumentName: string;
  customInstrumentSymbol: string;
  accountId: string;
  newAccountName: string;
  newAccountCurrency: string;
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

const CREATE_DIVIDEND_ACCOUNT_VALUE = "__create_dividend_account__";
const MANUAL_DIVIDEND_PROVIDER: QuoteProvider = "catalog";

const getAccountLabel = (account: PortfolioAccount) =>
  `${account.name} (${account.currency}, ${account.kind})`;

const getInstrumentLabel = (instrument: PortfolioInstrument) =>
  `${instrument.symbol} - ${instrument.name}`;

const getDividendAccountCandidates = (accounts: PortfolioAccount[]) =>
  accounts.filter(
    (account) =>
      account.kind === "cash" ||
      account.kind === "currency" ||
      account.kind === "investment"
  );

const getDefaultDividendAccountForCurrency = (
  accounts: PortfolioAccount[],
  currency: string
) => {
  const normalizedCurrency = toCurrencyCode(currency, "PLN");
  const candidates = getDividendAccountCandidates(accounts);

  return (
    candidates.find(
      (account) =>
        account.currency === normalizedCurrency &&
        (account.kind === "cash" || account.kind === "currency")
    ) ??
    candidates.find((account) => account.currency === normalizedCurrency) ??
    candidates.find((account) => account.kind === "cash" && account.isDefault) ??
    candidates.find((account) => account.kind === "currency" && account.isDefault) ??
    candidates[0] ??
    null
  );
};

const buildManualInstrumentSymbol = (name: string, symbol: string) =>
  normalizeSymbol(symbol || name).replace(/[^A-Z0-9._-]/g, "").slice(0, 18);

const getDefaultDividendDraft = (): DividendDraft => {
  const today = getTodayDateInputValue();
  const blankNumericInputs = getBlankDividendNumericInputs();

  return {
    editingId: null,
    // A new dividend must never silently target the first portfolio
    // instrument or account. Selecting both is an explicit user action.
    instrumentId: "",
    instrumentSearch: "",
    useCustomInstrument: false,
    customInstrumentName: "",
    customInstrumentSymbol: "",
    accountId: "",
    newAccountName: "",
    newAccountCurrency: "PLN",
    // These are intentionally blank in the UI (numeric zero) until the user
    // confirms the values.  A default instrument must not silently become a
    // default number of shares or an FX rate.
    quantity: blankNumericInputs.quantity,
    dividendPerShare: 0,
    withholdingTax: 0,
    domesticTax: 0,
    currency: "PLN",
    exchangeRate: blankNumericInputs.exchangeRate,
    exDividendDate: today,
    recordDate: today,
    paymentDate: today,
    country: "PL",
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
  baseCurrency,
  onPortfolioChange,
}: DividendCashWorkspaceProps) {
  const [dividendDraft, setDividendDraft] = useState(() => getDefaultDividendDraft());
  const [cashDraft, setCashDraft] = useState(() => getDefaultCashDraft(portfolio));
  const [dividendReportBucket, setDividendReportBucket] =
    useState<DividendReportBucket>("monthly");
  const [dividendError, setDividendError] = useState<string | null>(null);
  const [cashError, setCashError] = useState<string | null>(null);
  const dividendInstrumentRef = useRef<HTMLInputElement | null>(null);
  const dividendCustomNameRef = useRef<HTMLInputElement | null>(null);
  const dividendAccountRef = useRef<HTMLSelectElement | null>(null);
  const dividendQuantityRef = useRef<HTMLInputElement | null>(null);
  const dividendPerShareRef = useRef<HTMLInputElement | null>(null);
  const dividendPaymentDateRef = useRef<HTMLInputElement | null>(null);
  const cashAccountRef = useRef<HTMLSelectElement | null>(null);
  const cashAmountRef = useRef<HTMLInputElement | null>(null);
  const cashDateRef = useRef<HTMLInputElement | null>(null);

  const accounts = portfolio.accounts ?? [];
  const dividendAccounts = getDividendAccountCandidates(accounts);
  const cashAccounts = accounts.filter(
    (account) =>
      account.kind === "cash" ||
      account.kind === "currency" ||
      account.kind === "investment"
  );
  const portfolioInstruments = portfolio.instruments ?? [];
  const instruments = portfolioInstruments.filter(
    (instrument) => instrument.type !== "CASH"
  );
  const dividendInstrumentQuery = dividendDraft.instrumentSearch.trim().toLowerCase();
  const filteredDividendInstruments = dividendInstrumentQuery
    ? instruments.filter((instrument) =>
        `${instrument.symbol} ${instrument.name}`
          .toLowerCase()
          .includes(dividendInstrumentQuery)
      )
    : instruments;
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
    () => calculateCashBalances(portfolio.operations ?? [], portfolio.accounts ?? []),
    [portfolio.accounts, portfolio.operations]
  );
  const cashHistory = useMemo(() => buildCashHistory(portfolio), [portfolio]);
  const dividendSummaryInBase = useMemo(
    () => ({
      ytd: convertFromPln(dividendSummary.ytd, baseCurrency, fxRates),
      month: convertFromPln(dividendSummary.month, baseCurrency, fxRates),
      taxes: convertFromPln(dividendSummary.taxes, baseCurrency, fxRates),
      gross: convertFromPln(dividendSummary.gross, baseCurrency, fxRates),
      net: convertFromPln(dividendSummary.net, baseCurrency, fxRates),
    }),
    [baseCurrency, dividendSummary, fxRates]
  );
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
    onPortfolioChange({
      ...portfolio,
      operations,
      updatedAt: new Date().toISOString(),
    });
  };

  const replacePortfolioCore = ({
    accounts: nextAccounts = accounts,
    instruments: nextInstruments = instruments,
    operations,
  }: {
    accounts?: PortfolioAccount[];
    instruments?: PortfolioInstrument[];
    operations: PortfolioOperation[];
  }) => {
    onPortfolioChange({
      ...portfolio,
      accounts: nextAccounts,
      instruments: nextInstruments,
      operations,
      updatedAt: new Date().toISOString(),
    });
  };

  const resetDividendDraft = () => {
    setDividendDraft(getDefaultDividendDraft());
    setDividendError(null);
  };

  const handleDividendInstrumentChange = (instrumentId: string) => {
    const instrument = instruments.find((item) => item.id === instrumentId) ?? null;
    const currency = instrument?.marketCurrency ?? "PLN";
    const account = getDefaultDividendAccountForCurrency(accounts, currency);

    setDividendDraft((currentDraft) => ({
      ...currentDraft,
      instrumentId,
      useCustomInstrument: false,
      quantity: 0,
      currency,
      exchangeRate: 0,
      accountId: account?.id ?? currentDraft.accountId,
      newAccountCurrency: currency,
      country: currency === "PLN" ? "PL" : currentDraft.country,
    }));
    setDividendError(null);
  };

  const handleDividendCurrencyChange = (value: string) => {
    const currency = toCurrencyCode(value, "PLN");
    const account = getDefaultDividendAccountForCurrency(accounts, currency);

    setDividendDraft((currentDraft) => ({
      ...currentDraft,
      currency,
      exchangeRate: 0,
      accountId: account?.currency === currency ? account.id : CREATE_DIVIDEND_ACCOUNT_VALUE,
      newAccountCurrency: currency,
      newAccountName:
        currentDraft.newAccountName || (currency === "PLN" ? "Konto PLN" : `Konto ${currency}`),
      country: currency === "PLN" ? "PL" : currentDraft.country,
    }));
    setDividendError(null);
  };

  const handleToggleCustomInstrument = () => {
    setDividendDraft((currentDraft) => ({
      ...currentDraft,
      useCustomInstrument: !currentDraft.useCustomInstrument,
      instrumentId: currentDraft.useCustomInstrument ? currentDraft.instrumentId : "",
      quantity: currentDraft.useCustomInstrument ? currentDraft.quantity : 0,
    }));
    setDividendError(null);
  };

  const editDividend = (dividend: PortfolioDividend) => {
    setDividendDraft({
      editingId: dividend.operationId,
      instrumentId: dividend.instrumentId,
      instrumentSearch: "",
      useCustomInstrument: false,
      customInstrumentName: "",
      customInstrumentSymbol: "",
      accountId: dividend.accountId,
      newAccountName: "",
      newAccountCurrency: dividend.currency,
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

  const getResolvedDividendInstrument = () => {
    if (!dividendDraft.useCustomInstrument) {
      return {
        instrument: instruments.find((item) => item.id === dividendDraft.instrumentId) ?? null,
        instruments: portfolioInstruments,
      };
    }

    const name = dividendDraft.customInstrumentName.trim();
    const symbol = buildManualInstrumentSymbol(name, dividendDraft.customInstrumentSymbol);

    if (!name || !symbol) {
      return {
        instrument: null,
        instruments: portfolioInstruments,
      };
    }

    const existingInstrument = instruments.find(
      (instrument) => instrument.symbol === symbol
    );

    if (existingInstrument) {
      return {
        instrument: existingInstrument,
        instruments: portfolioInstruments,
      };
    }

    const now = new Date().toISOString();
    const nextInstrument: PortfolioInstrument = {
      id: getPortfolioInstrumentId(portfolio.id, { kind: "stock", symbol }),
      portfolioId: portfolio.id,
      type: "STOCK",
      assetKind: "stock",
      symbol,
      name,
      marketCurrency: selectedDividendCurrency,
      provider: MANUAL_DIVIDEND_PROVIDER,
      metadata: {
        manualDividendInstrument: true,
      },
      createdAt: now,
      updatedAt: now,
    };

    return {
      instrument: nextInstrument,
      instruments: [...portfolioInstruments, nextInstrument],
    };
  };

  const getResolvedDividendAccount = () => {
    if (dividendDraft.accountId !== CREATE_DIVIDEND_ACCOUNT_VALUE) {
      return {
        account: dividendAccounts.find((item) => item.id === dividendDraft.accountId) ?? null,
        accounts,
      };
    }

    const now = new Date().toISOString();
    const currency = toCurrencyCode(
      dividendDraft.newAccountCurrency,
      selectedDividendCurrency
    );
    const existingAccount = dividendAccounts.find(
      (account) =>
        account.currency === currency &&
        (account.kind === "cash" || account.kind === "currency")
    );

    if (existingAccount) {
      return {
        account: existingAccount,
        accounts,
      };
    }

    const accountName =
      dividendDraft.newAccountName.trim() ||
      (currency === "PLN" ? "Konto PLN" : `Konto ${currency}`);
    const nextAccount: PortfolioAccount = {
      id:
        currency === "PLN"
          ? getDefaultCashAccountId(portfolio.id, currency)
          : getDefaultCurrencyAccountId(portfolio.id, currency),
      portfolioId: portfolio.id,
      name: accountName.slice(0, 64),
      kind: currency === "PLN" ? "cash" : "currency",
      broker: currency === "PLN" ? "CASH" : "CURRENCY",
      currency,
      isDefault: false,
      metadata: {
        manualDividendAccount: true,
      },
      createdAt: now,
      updatedAt: now,
    };

    return {
      account: nextAccount,
      accounts: [...accounts, nextAccount],
    };
  };

  const saveDividend = () => {
    const resolvedInstrument = getResolvedDividendInstrument();
    const instrument = resolvedInstrument.instrument;
    const resolvedAccount = getResolvedDividendAccount();
    const account = resolvedAccount.account;

    if (!instrument) {
      setDividendError(
        dividendDraft.useCustomInstrument
          ? "Podaj nazwe i ticker spolki dla dywidendy."
          : "Wybierz instrument albo dodaj wlasna nazwe."
      );
      (dividendDraft.useCustomInstrument
        ? dividendCustomNameRef.current
        : dividendInstrumentRef.current
      )?.focus();
      return;
    }

    if (!account) {
      setDividendError("Wybierz konto wplywu albo utworz nowe konto walutowe.");
      dividendAccountRef.current?.focus();
      return;
    }

    if (account.currency !== selectedDividendCurrency) {
      setDividendError(
        `Konto wplywu musi byc w walucie ${selectedDividendCurrency}. Wybierz zgodne konto albo utworz nowe.`
      );
      dividendAccountRef.current?.focus();
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
    const nextOperations = dividendDraft.editingId
      ? currentOperations.map((item) =>
          item.id === dividendDraft.editingId ? nextOperation : item
        )
      : [...currentOperations, nextOperation];

    replacePortfolioCore({
      accounts: resolvedAccount.accounts,
      instruments: resolvedInstrument.instruments,
      operations: nextOperations,
    });
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
            <h2 className="section-title">Dywidendy</h2>
          </div>
          <p className="section-copy">
            Widok operacyjny aktywnego portfela oparty o operacje Portfolio Engine V2.
          </p>
        </div>

        <div className="metric-grid mt-6">
          <article className="metric-card">
            <span>Dywidendy YTD</span>
            <strong>{formatCurrency(dividendSummaryInBase.ytd, baseCurrency)}</strong>
          </article>
          <article className="metric-card">
            <span>Dywidendy w tym miesiacu</span>
            <strong>{formatCurrency(dividendSummaryInBase.month, baseCurrency)}</strong>
          </article>
          <article className="metric-card">
            <span>Roczny dochod z dywidend</span>
            <strong>
              {formatCurrency(
                convertFromPln(dividendForecast.annualIncomePln, baseCurrency, fxRates),
                baseCurrency
              )}
            </strong>
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
                <span>Szukaj instrumentu</span>
                <input
                  ref={dividendInstrumentRef}
                  value={dividendDraft.instrumentSearch}
                  onChange={(event) =>
                    setDividendDraft((currentDraft) => ({
                      ...currentDraft,
                      instrumentSearch: event.target.value,
                    }))
                  }
                  placeholder="Apple, Microsoft, Orlen..."
                />
              </label>

              <label className="field">
                <span>Instrument z portfela</span>
                <select
                  value={dividendDraft.instrumentId}
                  disabled={dividendDraft.useCustomInstrument}
                  onChange={(event) => handleDividendInstrumentChange(event.target.value)}
                >
                  <option value="">Wybierz instrument</option>
                  {filteredDividendInstruments.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {getInstrumentLabel(instrument)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Konto wplywu</span>
                <select
                  ref={dividendAccountRef}
                  value={dividendDraft.accountId}
                  onChange={(event) =>
                    setDividendDraft((currentDraft) => ({
                      ...currentDraft,
                      accountId: event.target.value,
                    }))
                  }
                >
                  <option value="">Wybierz konto</option>
                  {dividendAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {getAccountLabel(account)}
                    </option>
                  ))}
                  <option value={CREATE_DIVIDEND_ACCOUNT_VALUE}>
                    Utworz konto {selectedDividendCurrency}
                  </option>
                </select>
              </label>

              <div className="field">
                <span>Wlasna spolka</span>
                <button
                  className="ghost-button dividend-inline-button"
                  type="button"
                  onClick={handleToggleCustomInstrument}
                >
                  {dividendDraft.useCustomInstrument
                    ? "Wybierz z listy"
                    : "Nie ma na liscie? Dodaj wlasna nazwe."}
                </button>
              </div>

              {dividendDraft.useCustomInstrument ? (
                <>
                  <label className="field">
                    <span>Nazwa spolki</span>
                    <input
                      ref={dividendCustomNameRef}
                      value={dividendDraft.customInstrumentName}
                      onChange={(event) =>
                        setDividendDraft((currentDraft) => ({
                          ...currentDraft,
                          customInstrumentName: event.target.value,
                        }))
                      }
                      placeholder="np. Coca-Cola"
                    />
                  </label>

                  <label className="field">
                    <span>Ticker</span>
                    <input
                      value={dividendDraft.customInstrumentSymbol}
                      onChange={(event) =>
                        setDividendDraft((currentDraft) => ({
                          ...currentDraft,
                          customInstrumentSymbol: event.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="np. KO"
                    />
                  </label>
                </>
              ) : null}

              {dividendDraft.accountId === CREATE_DIVIDEND_ACCOUNT_VALUE ? (
                <>
                  <label className="field">
                    <span>Nazwa nowego konta</span>
                    <input
                      value={dividendDraft.newAccountName}
                      onChange={(event) =>
                        setDividendDraft((currentDraft) => ({
                          ...currentDraft,
                          newAccountName: event.target.value,
                        }))
                      }
                      placeholder={`Konto ${selectedDividendCurrency}`}
                    />
                  </label>

                  <label className="field">
                    <span>Waluta nowego konta</span>
                    <input
                      value={dividendDraft.newAccountCurrency}
                      onChange={(event) =>
                        setDividendDraft((currentDraft) => ({
                          ...currentDraft,
                          newAccountCurrency: event.target.value.toUpperCase(),
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}

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
                  onChange={(event) => handleDividendCurrencyChange(event.target.value)}
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
                <small>
                  {formatCurrency(
                    convertFromPln(dividendGrossPln, baseCurrency, fxRates),
                    baseCurrency
                  )}
                </small>
              </article>
              <article>
                <span>Netto</span>
                <strong>{formatCurrency(dividendNet, selectedDividendCurrency)}</strong>
                <small>
                  {formatCurrency(
                    convertFromPln(dividendNetPln, baseCurrency, fxRates),
                    baseCurrency
                  )}
                </small>
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
              <span className="tag">
                {formatCurrency(dividendSummaryInBase.net, baseCurrency)} netto
              </span>
            </div>

            <div className="metric-grid mt-6">
              <article className="metric-card">
                <span>Suma brutto</span>
                <strong>{formatCurrency(dividendSummaryInBase.gross, baseCurrency)}</strong>
              </article>
              <article className="metric-card">
                <span>Suma netto</span>
                <strong>{formatCurrency(dividendSummaryInBase.net, baseCurrency)}</strong>
              </article>
              <article className="metric-card">
                <span>Podatki</span>
                <strong>{formatCurrency(dividendSummaryInBase.taxes, baseCurrency)}</strong>
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
                  <strong>
                    {formatCurrency(
                      convertFromPln(row.netAmountPln, baseCurrency, fxRates),
                      baseCurrency
                    )}
                  </strong>
                  <em>
                    brutto {formatCurrency(
                      convertFromPln(row.grossAmountPln, baseCurrency, fxRates),
                      baseCurrency
                    )} / podatki{" "}
                    {formatCurrency(
                      convertFromPln(row.taxPln, baseCurrency, fxRates),
                      baseCurrency
                    )} / {row.paymentsCount} wyplat
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
                <strong>
                  {formatCurrency(
                    convertFromPln(dividendForecast.monthlyIncomePln, baseCurrency, fxRates),
                    baseCurrency
                  )}
                </strong>
              </article>
              <article>
                <span>Prognoza roczna</span>
                <strong>
                  {formatCurrency(
                    convertFromPln(dividendForecast.annualIncomePln, baseCurrency, fxRates),
                    baseCurrency
                  )}
                </strong>
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
                <CalendarGroup
                  key={group.bucket}
                  group={group}
                  baseCurrency={baseCurrency}
                  fxRates={fxRates}
                />
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

            <div className="sprint-table-wrap mt-5 dividend-payments-table-wrap">
              <table className="portfolio-table sprint-table dividend-payments-table">
                <colgroup>
                  <col className="dividend-payments-column-instrument" />
                  <col className="dividend-payments-column-account" />
                  <col className="dividend-payments-column-dates" />
                  <col className="dividend-payments-column-gross" />
                  <col className="dividend-payments-column-taxes" />
                  <col className="dividend-payments-column-net" />
                  <col className="dividend-payments-column-actions" />
                </colgroup>
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
                        <TruncatedText
                          as="p"
                          className="table-note"
                          text={dividend.instrumentName}
                        />
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
                        <p className="table-note">
                          {formatCurrency(
                            convertFromPln(dividend.netAmountPln, baseCurrency, fxRates),
                            baseCurrency
                          )}
                        </p>
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
            <div className="dividend-payment-cards mt-5">
              {dividends.map((dividend) => (
                <article className="dividend-payment-card" key={dividend.id}>
                  <div className="dividend-payment-card-head">
                    <span><strong>{dividend.symbol}</strong><TruncatedText as="span" text={dividend.instrumentName} /></span>
                    <strong>{formatCurrency(dividend.netAmount, dividend.currency)}</strong>
                  </div>
                  <dl>
                    <div><dt>Konto</dt><dd title={dividend.accountName}>{dividend.accountName}</dd></div>
                    <div><dt>Wypłata</dt><dd>{formatDate(dividend.paymentDate)}</dd></div>
                    <div><dt>Brutto</dt><dd>{formatCurrency(dividend.grossAmount, dividend.currency)}</dd></div>
                    <div><dt>Podatki</dt><dd>{formatCurrency(dividend.withholdingTax + dividend.domesticTax, dividend.currency)}</dd></div>
                  </dl>
                  <div className="sprint-inline-actions">
                    <span>{formatNumber(dividend.quantity)} szt.</span>
                    <button className="ghost-button" type="button" onClick={() => editDividend(dividend)}>Edytuj</button>
                    <button className="ghost-button admin-danger-button" type="button" onClick={() => deleteDividend(dividend)}>Usuń</button>
                  </div>
                </article>
              ))}
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
                    <small>
                      {balance.currency} · {formatCurrency(
                        convertCurrency(balance.amount, balance.currency, baseCurrency, fxRates),
                        baseCurrency
                      )}
                    </small>
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

function CalendarGroup({
  group,
  baseCurrency,
  fxRates,
}: {
  group: DividendCalendarGroup;
  baseCurrency: CurrencyCode;
  fxRates: FxRates;
}) {
  return (
    <article className="calendar-card">
      <div className="calendar-card-head">
        <strong>{group.label}</strong>
        <span>{group.dividends.length}</span>
      </div>
      <p className="table-note">
        netto {formatCurrency(convertFromPln(group.netAmountPln, baseCurrency, fxRates), baseCurrency)} / brutto{" "}
        {formatCurrency(convertFromPln(group.grossAmountPln, baseCurrency, fxRates), baseCurrency)}
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
