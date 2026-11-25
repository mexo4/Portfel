"use client";

import { useMemo, useState } from "react";
import {
  RECURRING_FREQUENCIES,
  RECURRING_FREQUENCY_LABELS,
  RECURRING_TYPES,
  RECURRING_TYPE_LABELS,
  bookRecurringOccurrences,
  getDueRecurringOccurrences,
  getNextOccurrence,
  readRecurringOperations,
  withRecurringOperations,
  type RecurringFrequency,
  type RecurringOperationType,
} from "@/lib/recurring-operations";
import { formatCurrency, formatDate, getTodayDateInputValue } from "@/lib/utils";
import type { InvestmentPortfolio } from "@/types/portfolio";

const createId = (prefix: string) =>
  `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;

type Draft = { operationType: RecurringOperationType; amount: string; accountId: string; frequency: RecurringFrequency; startDate: string; endDate: string; notes: string };

export default function RecurringOperationsPanel({
  portfolio,
  isPending,
  onPortfolioChange,
}: {
  portfolio: InvestmentPortfolio;
  isPending: boolean;
  onPortfolioChange: (portfolio: InvestmentPortfolio) => void | Promise<void>;
}) {
  const today = getTodayDateInputValue();
  const accounts = portfolio.accounts ?? [];
  const definitions = useMemo(() => readRecurringOperations(portfolio), [portfolio]);
  const due = useMemo(() => getDueRecurringOccurrences(portfolio, today), [portfolio, today]);
  const [draft, setDraft] = useState<Draft>({ operationType: "DEPOSIT", amount: "", accountId: accounts[0]?.id ?? "", frequency: "monthly", startDate: today, endDate: "", notes: "" });
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (next: InvestmentPortfolio, success: string) => {
    setSaving(true);
    setMessage(null);
    try {
      await onPortfolioChange(next);
      setMessage({ text: success, isError: false });
      return true;
    } catch {
      setMessage({ text: "Nie udało się zapisać zmian. Spróbuj ponownie.", isError: true });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addDefinition = async () => {
    const amount = Number(draft.amount.replace(/\s/g, "").replace(",", "."));
    const account = accounts.find((item) => item.id === draft.accountId);
    if (!Number.isFinite(amount) || amount <= 0) return setMessage({ text: "Podaj kwotę większą od zera.", isError: true });
    if (!account) return setMessage({ text: "Wybierz konto.", isError: true });
    if (!draft.startDate) return setMessage({ text: "Podaj datę pierwszej operacji.", isError: true });
    if (draft.endDate && draft.endDate < draft.startDate) return setMessage({ text: "Data końca musi być po dacie pierwszej operacji.", isError: true });
    const next = withRecurringOperations(portfolio, [
      ...definitions,
      { id: createId("recurring"), operationType: draft.operationType, amount: Math.round(amount * 100) / 100, currency: account.currency, accountId: account.id, frequency: draft.frequency, startDate: draft.startDate, endDate: draft.endDate || null, notes: draft.notes.trim().slice(0, 200), createdAt: new Date().toISOString() },
    ]);
    if (await save(next, "Dodano operację cykliczną.")) {
      setDraft((current) => ({ ...current, amount: "", notes: "", endDate: "" }));
      setIsOpen(false);
    }
  };

  const removeDefinition = (id: string) =>
    void save(withRecurringOperations(portfolio, definitions.filter((item) => item.id !== id)), "Usunięto operację cykliczną. Zaksięgowane operacje zostają w historii.");

  const bookDue = () =>
    void save(bookRecurringOccurrences(portfolio, due, () => createId("op")), `Zaksięgowano ${due.length} ${due.length === 1 ? "operację" : due.length < 5 ? "operacje" : "operacji"}.`);

  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? "konto usunięte";

  return (
    <section className="panel recurring-panel" aria-labelledby="recurring-title">
      <div className="sprint-panel-head">
        <div>
          <p className="eyebrow">Operacje cykliczne</p>
          <h2 id="recurring-title" className="section-title">Stałe wpłaty, wypłaty i opłaty</h2>
          <p className="section-copy">Zaplanuj powtarzalne operacje gotówkowe. Mexo nie księguje ich samo: gdy nadejdzie termin, zobaczysz je tutaj i zaksięgujesz jednym kliknięciem.</p>
        </div>
        <button type="button" className="ghost-button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} disabled={isPending || saving || accounts.length === 0}>
          {isOpen ? "Zamknij" : "Dodaj operację cykliczną"}
        </button>
      </div>

      {due.length > 0 ? (
        <div className="recurring-due mt-4" role="status">
          <div>
            <strong>{due.length} {due.length === 1 ? "operacja czeka" : due.length < 5 ? "operacje czekają" : "operacji czeka"} na zaksięgowanie</strong>
            <small>{due.slice(0, 3).map((item) => `${RECURRING_TYPE_LABELS[item.definition.operationType]} ${formatCurrency(item.definition.amount, item.definition.currency)} · ${formatDate(item.date)}`).join("; ")}{due.length > 3 ? "…" : ""}</small>
          </div>
          <button type="button" className="primary-button" onClick={bookDue} disabled={isPending || saving}>Zaksięguj</button>
        </div>
      ) : null}

      {isOpen ? (
        <div className="recurring-form mt-4">
          <label className="field"><span>Typ</span>
            <select value={draft.operationType} onChange={(event) => setDraft({ ...draft, operationType: event.target.value as RecurringOperationType })}>
              {RECURRING_TYPES.map((type) => <option key={type} value={type}>{RECURRING_TYPE_LABELS[type]}</option>)}
            </select>
          </label>
          <label className="field"><span>Kwota</span><input inputMode="decimal" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} placeholder="np. 500" /></label>
          <label className="field"><span>Konto</span>
            <select value={draft.accountId} onChange={(event) => setDraft({ ...draft, accountId: event.target.value })}>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({account.currency})</option>)}
            </select>
          </label>
          <label className="field"><span>Częstotliwość</span>
            <select value={draft.frequency} onChange={(event) => setDraft({ ...draft, frequency: event.target.value as RecurringFrequency })}>
              {RECURRING_FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{RECURRING_FREQUENCY_LABELS[frequency]}</option>)}
            </select>
          </label>
          <label className="field"><span>Pierwsza operacja</span><input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
          <label className="field"><span>Koniec (opcjonalnie)</span><input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label>
          <label className="field field-full"><span>Notatka</span><input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="np. comiesięczna wpłata na IKE" /></label>
          <button type="button" className="primary-button" onClick={() => void addDefinition()} disabled={isPending || saving}>Zapisz operację cykliczną</button>
        </div>
      ) : null}

      {definitions.length > 0 ? (
        <ul className="recurring-list mt-4">
          {definitions.map((definition) => {
            const next = getNextOccurrence(definition, today);
            return (
              <li key={definition.id}>
                <span>
                  <strong>{RECURRING_TYPE_LABELS[definition.operationType]} {formatCurrency(definition.amount, definition.currency)} {RECURRING_FREQUENCY_LABELS[definition.frequency]}</strong>
                  <small>{accountName(definition.accountId)} · od {formatDate(definition.startDate)}{definition.endDate ? ` do ${formatDate(definition.endDate)}` : ""} · {next ? `następna ${formatDate(next)}` : "zakończona"}{definition.notes ? ` · ${definition.notes}` : ""}</small>
                </span>
                <button type="button" className="ghost-button" onClick={() => removeDefinition(definition.id)} disabled={isPending || saving}>Usuń</button>
              </li>
            );
          })}
        </ul>
      ) : !isOpen ? (
        <p className="field-note mt-4">Nie masz jeszcze operacji cyklicznych.</p>
      ) : null}

      {message ? <p className={message.isError ? "field-note field-note-error mt-3" : "field-note mt-3"} role={message.isError ? "alert" : "status"}>{message.text}</p> : null}
    </section>
  );
}
