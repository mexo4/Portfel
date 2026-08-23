"use client";

import { useMemo, useState } from "react";
import { buildCashHistory, buildCashOperation, type CashEntryKind, type CashOperationKind } from "@/lib/cash-engine";
import { SUPPORTED_CURRENCIES } from "@/lib/constants";
import { calculateCashBalances, ensurePortfolioCashAccount } from "@/lib/operation-engine";
import { convertCurrency } from "@/lib/pricing";
import { formatCurrency, formatDate, getTodayDateInputValue, toCurrencyCode } from "@/lib/utils";
import type { CurrencyCode, FxRates, InvestmentPortfolio, PortfolioAccount, PortfolioOperation } from "@/types/portfolio";

type Props = {
  portfolio?: InvestmentPortfolio | null;
  portfolios?: InvestmentPortfolio[];
  activePortfolioId?: string;
  isAllPortfoliosSelected?: boolean;
  fxRates: FxRates;
  baseCurrency: CurrencyCode;
  totalPortfolioValue?: number;
  onPortfolioChange: (portfolio: InvestmentPortfolio) => void | Promise<void>;
};

type Draft = {
  operationType: CashOperationKind;
  entryKind: CashEntryKind;
  accountId: string;
  targetAccountId: string;
  amount: string;
  currency: string;
  targetCurrency: string;
  targetAmount: string;
  date: string;
  notes: string;
};

const operationLabels: Record<CashOperationKind, string> = {
  DEPOSIT: "Wpłata",
  WITHDRAW: "Wypłata",
  TRANSFER: "Przelew między kontami",
  CONVERSION: "Przewalutowanie",
  INTEREST: "Odsetki",
  FEE: "Opłata",
  CUSTOM: "Korekta salda",
};

const historyLabels: Record<string, string> = {
  ...operationLabels,
  BUY: "Zakup aktywa",
  SELL: "Sprzedaż aktywa",
  DIVIDEND: "Dywidenda",
  COUPON: "Kupon obligacji",
  TAX: "Podatek",
  FEE: "Opłata",
  SPLIT: "Split",
  REVERSE_SPLIT: "Reverse split",
  BONUS: "Bonus",
};

const editableCashTypes = new Set<CashOperationKind>(Object.keys(operationLabels) as CashOperationKind[]);
const editableCashEntryKinds = new Set<CashEntryKind>(["STANDARD", "INITIAL_BALANCE", "BALANCE_ADJUSTMENT"]);
const isEditableCashOperation = (operation: PortfolioOperation) =>
  editableCashTypes.has(operation.operationType as CashOperationKind) &&
  editableCashEntryKinds.has(operation.metadata.cashEntryKind as CashEntryKind);

const createDraft = (): Draft => ({
  operationType: "DEPOSIT",
  entryKind: "STANDARD",
  accountId: "",
  targetAccountId: "",
  amount: "",
  currency: "PLN",
  targetCurrency: "USD",
  targetAmount: "",
  date: getTodayDateInputValue(),
  notes: "",
});

const numberValue = (value: string) => Number(value.replace(/\s/g, "").replace(",", "."));

function accountCandidates(accounts: PortfolioAccount[] | undefined, currency?: string) {
  return (accounts ?? []).filter((account) =>
    (account.kind === "cash" || account.kind === "currency") &&
    (!currency || account.currency === toCurrencyCode(currency, "PLN"))
  );
}

function operationLabel(operation: PortfolioOperation) {
  const entryKind = operation.metadata.cashEntryKind;
  if (entryKind === "INITIAL_BALANCE") return "Saldo początkowe";
  if (entryKind === "BALANCE_ADJUSTMENT") return "Korekta salda";
  return historyLabels[operation.operationType] ?? "Operacja gotówkowa";
}

export default function CashWorkspace({
  portfolio,
  portfolios = portfolio ? [portfolio] : [],
  activePortfolioId = portfolio?.id ?? "",
  isAllPortfoliosSelected = false,
  fxRates,
  baseCurrency,
  totalPortfolioValue = 0,
  onPortfolioChange,
}: Props) {
  const [targetPortfolioId, setTargetPortfolioId] = useState(activePortfolioId || portfolios[0]?.id || "");
  const [draft, setDraft] = useState<Draft>(createDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const aggregate = isAllPortfoliosSelected;
  const selectedPortfolio = aggregate
    ? portfolios.find((item) => item.id === targetPortfolioId) ?? portfolios[0] ?? null
    : portfolio ?? portfolios.find((item) => item.id === activePortfolioId) ?? null;
  const allBalances = useMemo(() => {
    const result = new Map<string, { accountId: string; accountName: string; currency: CurrencyCode; amount: number }>();
    portfolios.forEach((item) => {
      calculateCashBalances(item.operations ?? [], item.accounts).forEach((balance) => {
        const account = item.accounts?.find((candidate) => candidate.id === balance.accountId);
        const key = `${item.id}:${balance.accountId}:${balance.currency}`;
        result.set(key, { accountId: balance.accountId, accountName: `${item.name} · ${account?.name ?? "Gotówka"}`, currency: balance.currency, amount: balance.amount });
      });
    });
    return Array.from(result.values());
  }, [portfolios]);
  const balances = useMemo(
    () => aggregate
      ? allBalances
      : selectedPortfolio
        ? calculateCashBalances(selectedPortfolio.operations ?? [], selectedPortfolio.accounts)
        : [],
    [aggregate, allBalances, selectedPortfolio]
  );
  const cashValue = balances.reduce((sum, balance) => sum + convertCurrency(balance.amount, balance.currency, baseCurrency, fxRates), 0);
  const portfolioValue = totalPortfolioValue;
  const cashShare = portfolioValue > 0 ? (cashValue / portfolioValue) * 100 : 0;
  const history = useMemo(() => {
    if (!selectedPortfolio) return [];
    const readable = (entry: ReturnType<typeof buildCashHistory>[number]) => ({
      ...entry,
      operationType: (historyLabels[entry.operationType] ?? entry.operationType) as typeof entry.operationType,
    });
    if (!aggregate) return buildCashHistory(selectedPortfolio).map(readable);
    return portfolios.flatMap((item) => buildCashHistory(item).map((entry) => ({ ...readable(entry), accountName: `${item.name} · ${entry.accountName}`, notes: entry.notes }))).sort((left, right) => right.date.localeCompare(left.date));
  }, [aggregate, portfolios, selectedPortfolio]);
  const accounts = useMemo(() => selectedPortfolio?.accounts ?? [], [selectedPortfolio]);
  const currencyOptions = useMemo(() => Array.from(new Set([
    ...SUPPORTED_CURRENCIES,
    ...accounts.map((account) => account.currency),
    ...balances.map((balance) => balance.currency),
  ])).sort((left, right) => left.localeCompare(right)), [accounts, balances]);
  const accountForCurrency = accountCandidates(selectedPortfolio?.accounts, draft.currency);
  const targetAccounts = accountCandidates(selectedPortfolio?.accounts, draft.targetCurrency);

  const updateDraft = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const changeOperationType = (operationType: CashOperationKind) => setDraft((current) => ({ ...current, operationType, entryKind: "STANDARD" }));
  const changeEntryKind = (entryKind: CashEntryKind) => setDraft((current) => ({ ...current, entryKind, operationType: entryKind === "INITIAL_BALANCE" ? "DEPOSIT" : entryKind === "BALANCE_ADJUSTMENT" ? "CUSTOM" : current.operationType }));

  const submit = async () => {
    if (pending) return;
    const amount = numberValue(draft.amount);
    if (!selectedPortfolio || !Number.isFinite(amount) || amount === 0 || !draft.date) {
      setMessage({ type: "error", text: "Wybierz portfel, podaj kwotę i datę operacji." });
      return;
    }
    if (aggregate && !targetPortfolioId) {
      setMessage({ type: "error", text: "W widoku wszystkich portfeli wybierz portfel docelowy." });
      return;
    }
    const currency = toCurrencyCode(draft.currency, baseCurrency);
    const selectedSourceAccount = draft.accountId
      ? selectedPortfolio.accounts?.find((account) => account.id === draft.accountId)
      : undefined;
    if (
      draft.accountId &&
      (!selectedSourceAccount || selectedSourceAccount.currency !== currency)
    ) {
      setMessage({ type: "error", text: "Wybierz konto źródłowe zgodne z walutą operacji." });
      return;
    }
    const selectedTargetAccount = draft.targetAccountId
      ? selectedPortfolio.accounts?.find((account) => account.id === draft.targetAccountId)
      : undefined;
    if (draft.operationType === "TRANSFER" && !selectedTargetAccount) {
      setMessage({ type: "error", text: "Wybierz konto docelowe dla przelewu." });
      return;
    }
    const targetCurrency = draft.operationType === "TRANSFER"
      ? selectedTargetAccount?.currency ?? currency
      : selectedTargetAccount?.currency ?? toCurrencyCode(draft.targetCurrency, currency);
    const targetAmount = draft.operationType === "CONVERSION" ? numberValue(draft.targetAmount) : amount;
    if (draft.operationType === "CONVERSION" && (!Number.isFinite(targetAmount) || targetAmount <= 0)) {
      setMessage({ type: "error", text: "Podaj poprawną kwotę po przewalutowaniu." });
      return;
    }
    const ensuredSource = ensurePortfolioCashAccount(selectedPortfolio.accounts ?? [], selectedPortfolio.id, currency);
    const ensuredTarget = draft.operationType === "CONVERSION" ? ensurePortfolioCashAccount(ensuredSource.accounts, selectedPortfolio.id, targetCurrency) : ensuredSource;
    const accountId = selectedSourceAccount?.id ?? ensuredSource.account.id;
    const targetAccountId = draft.targetAccountId || (draft.operationType === "CONVERSION" ? ensuredTarget.account.id : "");
    if (draft.operationType === "TRANSFER" && (!targetAccountId || accountId === targetAccountId)) {
      setMessage({ type: "error", text: "Wybierz inne konto docelowe dla przelewu." });
      return;
    }
    if (draft.operationType === "TRANSFER" && targetCurrency !== currency) {
      setMessage({ type: "error", text: "Przelew musi używać tej samej waluty. Do zmiany waluty użyj przewalutowania." });
      return;
    }
    if (
      draft.operationType === "CONVERSION" &&
      (targetCurrency === currency || accountId === targetAccountId)
    ) {
      setMessage({ type: "error", text: "Przewalutowanie wymaga innej waluty i innego konta docelowego." });
      return;
    }
    const id = editingId ?? `cash-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const operation = buildCashOperation({ id, portfolioId: selectedPortfolio.id, accountId, targetAccountId: targetAccountId || undefined, targetCurrency, targetAmount, operationType: draft.operationType, amount: draft.operationType === "CUSTOM" ? amount : Math.abs(amount), currency, date: draft.date, notes: draft.notes, entryKind: draft.entryKind, createdAt: editingId ? selectedPortfolio.operations?.find((item) => item.id === editingId)?.createdAt : undefined });
    const nextOperations = editingId ? (selectedPortfolio.operations ?? []).map((item) => item.id === editingId ? { ...operation, metadata: { ...item.metadata, ...operation.metadata } } : item) : [...(selectedPortfolio.operations ?? []), operation];
    const nextPortfolio: InvestmentPortfolio = { ...selectedPortfolio, accounts: ensuredTarget.accounts, operations: nextOperations, updatedAt: new Date().toISOString() };
    setPending(true); setMessage(null);
    try {
      await onPortfolioChange(nextPortfolio);
      setDraft(createDraft()); setEditingId(null); setMessage({ type: "success", text: editingId ? "Operacja została zaktualizowana." : "Operacja została zapisana." });
    } catch {
      setMessage({ type: "error", text: "Nie udało się zapisać operacji. Spróbuj ponownie." });
    } finally { setPending(false); }
  };

  const edit = (operation: PortfolioOperation) => {
    if (aggregate || !isEditableCashOperation(operation)) return;
    updateDraft({ operationType: operation.operationType as CashOperationKind, entryKind: (operation.metadata.cashEntryKind as CashEntryKind) ?? "STANDARD", accountId: operation.accountId, targetAccountId: typeof operation.metadata.targetAccountId === "string" ? operation.metadata.targetAccountId : "", amount: String(operation.amount), currency: operation.currency, targetCurrency: typeof operation.metadata.targetCurrency === "string" ? operation.metadata.targetCurrency : operation.currency, targetAmount: typeof operation.metadata.targetAmount === "number" ? String(operation.metadata.targetAmount) : String(operation.amount), date: operation.date, notes: operation.notes });
    setEditingId(operation.id); setMessage(null);
  };

  const remove = async (operation: PortfolioOperation) => {
    if (aggregate || pending || !isEditableCashOperation(operation) || !selectedPortfolio) return;
    if (typeof window !== "undefined" && !window.confirm("Usunąć tę operację gotówkową?")) return;
    setPending(true); setMessage(null);
    try {
      await onPortfolioChange({ ...selectedPortfolio, operations: (selectedPortfolio.operations ?? []).filter((item) => item.id !== operation.id), updatedAt: new Date().toISOString() });
      setMessage({ type: "success", text: "Operacja została usunięta." });
    } catch { setMessage({ type: "error", text: "Nie udało się usunąć operacji." }); } finally { setPending(false); }
  };

  return (
    <section className="cash-workspace">
      <div className="panel cash-summary-panel">
        <div className="sprint-panel-head"><div><p className="eyebrow">Gotówka</p><h2 className="section-title">Saldo gotówkowe</h2><p className="section-copy">Środki są liczone z tego samego dziennika operacji co portfel.</p></div>{aggregate ? <span className="tag">Wszystkie portfele</span> : null}</div>
        {aggregate ? <label className="field cash-target-portfolio"><span>Portfel docelowy dla nowych operacji</span><select value={targetPortfolioId} onChange={(event) => setTargetPortfolioId(event.target.value)}>{portfolios.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        <div className="workspace-performance-metric-grid cash-summary-grid mt-6"><article><span>Łączna gotówka</span><strong>{formatCurrency(cashValue, baseCurrency)}</strong></article><article><span>Udział w portfelu</span><strong>{cashShare.toFixed(1)}%</strong></article><article><span>Waluty / konta</span><strong>{balances.length}</strong></article></div>
        {balances.some((item) => item.amount < 0) ? <p className="field-note field-note-error mt-4">Saldo ujemne jest dozwolone, ale wymaga weryfikacji.</p> : null}
        <div className="cash-balance-list mt-6">{balances.map((balance) => { const accountName = "accountName" in balance ? String(balance.accountName) : selectedPortfolio?.accounts?.find((account) => account.id === balance.accountId)?.name ?? "Gotówka"; return <article key={`${balance.accountId}:${balance.currency}`}><span>{accountName}</span><strong className={balance.amount < 0 ? "tone-negative" : ""}>{formatCurrency(balance.amount, balance.currency)}</strong><small>{balance.currency} · {formatCurrency(convertCurrency(balance.amount, balance.currency, baseCurrency, fxRates), baseCurrency)}</small></article>; })}{balances.length === 0 ? <p className="field-note">Brak sald gotówkowych.</p> : null}</div>
      </div>

      <article className="panel cash-form-panel mt-6"><div className="sprint-panel-head"><div><p className="eyebrow">Dziennik gotówki</p><h2 className="section-title">{editingId ? "Edytuj operację" : "Dodaj operację"}</h2></div>{editingId ? <button type="button" className="ghost-button" onClick={() => { setEditingId(null); setDraft(createDraft()); }}>Anuluj edycję</button> : null}</div>
        <div className="cash-form-grid mt-5">
          <label className="field"><span>Typ operacji</span><select value={draft.operationType} onChange={(event) => changeOperationType(event.target.value as CashOperationKind)}>{Object.entries(operationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field"><span>Rodzaj wpisu</span><select value={draft.entryKind} onChange={(event) => changeEntryKind(event.target.value as CashEntryKind)}><option value="STANDARD">Standardowa operacja</option><option value="INITIAL_BALANCE">Saldo początkowe (wpłata)</option><option value="BALANCE_ADJUSTMENT">Korekta salda</option></select></label>
          <label className="field"><span>Konto źródłowe</span><select value={draft.accountId} onChange={(event) => updateDraft({ accountId: event.target.value })}><option value="">Automatycznie według waluty</option>{accountForCurrency.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label>
          <label className="field"><span>Kwota {draft.operationType === "CUSTOM" ? "(może być ujemna)" : ""}</span><input inputMode="decimal" value={draft.amount} onChange={(event) => updateDraft({ amount: event.target.value })} placeholder="0,00" /></label>
          <label className="field"><span>Waluta</span><select value={draft.currency} onChange={(event) => updateDraft({ currency: event.target.value, accountId: "" })}>{currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
          {draft.operationType === "CONVERSION" ? <><label className="field"><span>Kwota docelowa</span><input inputMode="decimal" value={draft.targetAmount} onChange={(event) => updateDraft({ targetAmount: event.target.value })} placeholder="0,00" /></label><label className="field"><span>Waluta docelowa</span><select value={draft.targetCurrency} onChange={(event) => updateDraft({ targetCurrency: event.target.value, targetAccountId: "" })}>{currencyOptions.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label><label className="field"><span>Konto docelowe</span><select value={draft.targetAccountId} onChange={(event) => updateDraft({ targetAccountId: event.target.value })}><option value="">Automatycznie według waluty</option>{targetAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label></> : null}
          {draft.operationType === "TRANSFER" ? <label className="field"><span>Konto docelowe</span><select value={draft.targetAccountId} onChange={(event) => updateDraft({ targetAccountId: event.target.value })}><option value="">Wybierz konto</option>{accounts.filter((account) => account.id !== draft.accountId && (account.kind === "cash" || account.kind === "currency")).map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}</select></label> : null}
          <label className="field"><span>Data</span><input type="date" value={draft.date} onChange={(event) => updateDraft({ date: event.target.value })} /></label><label className="field field-full"><span>Notatka</span><input value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} placeholder="np. przelew z rachunku bankowego" /></label>
        </div>
        {message ? <p className={`field-note mt-4 ${message.type === "error" ? "field-note-error" : "tone-positive"}`} role={message.type === "error" ? "alert" : "status"}>{message.text}</p> : null}
        <div className="sprint-action-row mt-5"><button type="button" className="primary-button" onClick={submit} disabled={pending}>{pending ? "Zapisywanie…" : editingId ? "Zapisz zmiany" : "Dodaj operację"}</button></div>
      </article>

      <article className="panel sprint-wide-panel mt-6"><div className="sprint-panel-head"><div><p className="eyebrow">Historia gotówki</p><h2 className="section-title">Operacje i saldo po operacji</h2></div><span className="tag">{history.length} wpisów</span></div><div className="sprint-table-wrap mt-5"><table className="portfolio-table sprint-table"><thead><tr><th>Data</th><th>Typ</th><th>Konto</th><th>Kwota</th><th>Saldo</th><th>Opis</th><th>Akcje</th></tr></thead><tbody>{history.map((entry) => { const op = selectedPortfolio?.operations?.find((item) => item.id === entry.operationId); return <tr key={entry.id}><td>{formatDate(entry.date)}</td><td>{op ? operationLabel(op) : entry.operationType}</td><td>{entry.accountName}</td><td className={entry.amount < 0 ? "tone-negative" : "tone-positive"}>{formatCurrency(entry.amount, entry.currency)}</td><td>{formatCurrency(entry.balanceAfter, entry.currency)}</td><td><span className="table-note">{entry.notes || "—"}</span></td><td>{op && !aggregate && isEditableCashOperation(op) ? <span className="inline-actions"><button type="button" className="ghost-button" onClick={() => edit(op)}>Edytuj</button><button type="button" className="ghost-button" onClick={() => void remove(op)} disabled={pending}>Usuń</button></span> : <span className="table-note">—</span>}</td></tr>; })}{history.length === 0 ? <tr><td colSpan={7}><p className="empty-row">Brak historii gotówki.</p></td></tr> : null}</tbody></table></div><div className="cash-mobile-history">{history.map((entry) => { const op = selectedPortfolio?.operations?.find((item) => item.id === entry.operationId); return <article key={`mobile-${entry.id}`} className="cash-mobile-row"><div><strong>{op ? operationLabel(op) : entry.operationType}</strong><span>{formatDate(entry.date)} · {entry.accountName}</span></div><strong className={entry.amount < 0 ? "tone-negative" : "tone-positive"}>{formatCurrency(entry.amount, entry.currency)}</strong>{op && !aggregate && isEditableCashOperation(op) ? <div className="inline-actions"><button type="button" className="ghost-button" onClick={() => edit(op)}>Edytuj</button><button type="button" className="ghost-button" onClick={() => void remove(op)} disabled={pending}>Usuń</button></div> : null}</article>; })}</div></article>
    </section>
  );
}
