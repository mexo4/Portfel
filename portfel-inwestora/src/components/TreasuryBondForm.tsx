"use client";

import { formatCurrency, formatDate } from "@/lib/utils";
import type {
  BondRedemptionQuote,
  BondSwapQuote,
  TreasuryBondDraft,
  TreasuryBondQuote,
  TreasuryBondSeries,
} from "@/types/portfolio";

type TreasuryBondFormProps = {
  draft: TreasuryBondDraft;
  series: TreasuryBondSeries | null;
  quote: TreasuryBondQuote | null;
  redemptionPreview: BondRedemptionQuote | null;
  swapPreview: BondSwapQuote | null;
  isLoadingSeries: boolean;
  isLoadingRedemption: boolean;
  isLoadingSwap: boolean;
  error?: string | null;
  redemptionError?: string | null;
  swapError?: string | null;
  onChange: (draft: TreasuryBondDraft) => void;
  onCodeChange: (code: string) => void;
  onBuySubmit: () => void;
  onSellSubmit: () => void;
  onRedeemSubmit: () => void;
  onSwapSubmit: () => void;
};

const parseIntegerInput = (value: string) => {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
};

const parseNumericInput = (value: string) => {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

export default function TreasuryBondForm({
  draft,
  series,
  quote,
  redemptionPreview,
  swapPreview,
  isLoadingSeries,
  isLoadingRedemption,
  isLoadingSwap,
  error,
  redemptionError,
  swapError,
  onChange,
  onCodeChange,
  onBuySubmit,
  onSellSubmit,
  onRedeemSubmit,
  onSwapSubmit,
}: TreasuryBondFormProps) {
  const swapPriceValue = series?.swapPrice ?? Math.max((series?.salePrice ?? 100) - 0.1, 0);

  return (
    <section className="panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="eyebrow">Obligacje</p>
          <h2 className="section-title">Kupno, wykup i zamiana serii</h2>
        </div>

        <p className="section-copy">
          EDO, COI i ROS. Kod emisji sam rozpoznaje typ, miesiac i rok wykupu.
        </p>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-[1.3fr_0.7fr_1fr_1fr_auto_auto_auto]">
        <label className="field">
          <span>Kod obligacji</span>
          <input
            value={draft.code}
            onChange={(event) => onCodeChange(event.target.value)}
            placeholder="Np. EDO0125"
          />
          {isLoadingSeries ? (
            <small className="field-note">Pobieram parametry emisji...</small>
          ) : null}
        </label>

        <label className="field">
          <span>Ilosc</span>
          <input
            type="number"
            min="0"
            step="1"
            value={draft.quantityInput}
            onChange={(event) =>
              onChange({
                ...draft,
                quantityInput: event.target.value,
                quantity: parseIntegerInput(event.target.value),
              })
            }
          />
        </label>

        <label className="field">
          <span>Data operacji</span>
          <input
            type="date"
            value={draft.purchaseDate}
            onChange={(event) =>
              onChange({
                ...draft,
                purchaseDate: event.target.value,
              })
            }
          />
        </label>

        <label className="field">
          <span>Cena transakcji (1 szt, PLN)</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.purchasePriceInput}
            onChange={(event) =>
              onChange({
                ...draft,
                purchasePriceInput: event.target.value,
                purchasePrice: parseNumericInput(event.target.value),
              })
            }
          />
          <small className="field-note">Domyslnie cena emisji, mozesz wpisac wlasna.</small>
        </label>

        <button
          className="transaction-button transaction-button-compact bond-transaction-button transaction-button-buy self-end"
          type="button"
          onClick={onBuySubmit}
        >
          Kup
        </button>

        <button
          className="transaction-button transaction-button-compact bond-transaction-button transaction-button-sell self-end"
          type="button"
          onClick={onSellSubmit}
        >
          Sprzedaj
        </button>

        <button
          className="transaction-button transaction-button-compact bond-transaction-button transaction-button-sell self-end"
          type="button"
          onClick={onRedeemSubmit}
          disabled={isLoadingRedemption}
        >
          {isLoadingRedemption ? "Licze wykup..." : "Wykup"}
        </button>
      </div>

      <div className="mt-3 grid gap-4 xl:grid-cols-[1.3fr_0.7fr_auto]">
        <label className="field">
          <span>Kod docelowej obligacji</span>
          <input
            value={draft.swapTargetCode}
            onChange={(event) =>
              onChange({
                ...draft,
                swapTargetCode: event.target.value.toUpperCase(),
              })
            }
            placeholder="Np. EDO0336"
          />
        </label>

        <label className="field">
          <span>Ilosc po zamianie</span>
          <input
            type="number"
            min="0"
            step="1"
            value={draft.swapTargetQuantityInput}
            onChange={(event) =>
              onChange({
                ...draft,
                swapTargetQuantityInput: event.target.value,
                swapTargetQuantity: parseIntegerInput(event.target.value),
              })
            }
          />
        </label>

        <button
          className="transaction-button transaction-button-compact bond-transaction-button transaction-button-buy self-end"
          type="button"
          onClick={onSwapSubmit}
          disabled={isLoadingSwap}
        >
          {isLoadingSwap ? "Licze zamiane..." : "Zamien"}
        </button>
      </div>

      {series ? (
        <p className="field-note mt-3">
          Cena zamiany wynosi obecnie {formatCurrency(swapPriceValue)}. To dotyczy tylko
          zamiany, nie zwyklego wykupu.
        </p>
      ) : null}

      {error ? <p className="field-note field-note-error mt-4">{error}</p> : null}
      {redemptionError ? <p className="field-note field-note-error mt-2">{redemptionError}</p> : null}
      {swapError ? <p className="field-note field-note-error mt-2">{swapError}</p> : null}

      {series ? (
        <div className="mt-5 grid gap-3 xl:grid-cols-3">
          <article className="lot-card">
            <p className="table-title">Typ obligacji</p>
            <strong>{series.type}</strong>
            <p className="table-note mt-2">
              {series.yearsToMaturity} lat - emisja {String(series.issueMonth).padStart(2, "0")}/{series.issueYear}
            </p>
          </article>

          <article className="lot-card">
            <p className="table-title">Wykup serii</p>
            <strong>
              {String(series.redemptionMonth).padStart(2, "0")}/{series.redemptionYear}
            </strong>
            <p className="table-note mt-2">
              Odsetki: {series.couponMode === "capitalized" ? "kapitalizacja" : "wyplata co roku"}
            </p>
          </article>

          <article className="lot-card">
            <p className="table-title">Wartosc 1 szt. dzisiaj</p>
            <strong>
              {quote ? formatCurrency(quote.grossValue) : formatCurrency(series.salePrice)}
            </strong>
            <p className="table-note mt-2">
              Cena zamiany: {formatCurrency(swapPriceValue)}
            </p>
          </article>
        </div>
      ) : null}

      {quote ? (
        <div className="mt-3 grid gap-3 xl:grid-cols-3">
          <article className="lot-card">
            <p className="table-title">Biezace oprocentowanie</p>
            <p className="table-note mt-2">{quote.annualRate.toFixed(2)}% rocznie</p>
          </article>
          <article className="lot-card">
            <p className="table-title">Termin wykupu zakupu</p>
            <p className="table-note mt-2">{formatDate(quote.maturityDate)}</p>
          </article>
          <article className="lot-card">
            <p className="table-title">Narastajace odsetki</p>
            <p className="table-note mt-2">{formatCurrency(quote.grossInterest)}</p>
          </article>
        </div>
      ) : null}

      {series?.isFamilyOnly ? (
        <p className="field-note mt-4">
          ROS to rodzinne obligacje skarbowe. Formularz pozwala je sledzic w portfelu,
          ale sam produkt jest przeznaczony dla beneficjentow programu 800+.
        </p>
      ) : null}

      {redemptionPreview ? (
        <div className="mt-5">
          <p className="eyebrow">Podglad wykupu</p>
          <div className="grid gap-3 xl:grid-cols-5">
            <article className="lot-card">
              <p className="table-title">Rozliczenie</p>
              <p className="table-note mt-2">{formatDate(redemptionPreview.settlementDate)}</p>
            </article>
            <article className="lot-card">
              <p className="table-title">Wartosc wykupu / 1 szt.</p>
              <p className="table-note mt-2">
                {formatCurrency(redemptionPreview.grossValuePerUnit)}
              </p>
            </article>
            <article className="lot-card">
              <p className="table-title">Wartosc wykupu brutto</p>
              <p className="table-note mt-2">
                {formatCurrency(redemptionPreview.grossValueTotal)}
              </p>
            </article>
            <article className="lot-card">
              <p className="table-title">Wartosc wykupu netto</p>
              <p className="table-note mt-2">
                {formatCurrency(redemptionPreview.netValueTotal)}
              </p>
            </article>
            <article className="lot-card">
              <p className="table-title">Podatek + oplata</p>
              <p className="table-note mt-2">
                {formatCurrency(redemptionPreview.taxTotal + redemptionPreview.feeTotal)}
              </p>
            </article>
          </div>
          {redemptionPreview.domesticTaxNote ? (
            <p className="field-note mt-3">{redemptionPreview.domesticTaxNote}</p>
          ) : null}
        </div>
      ) : null}

      {swapPreview ? (
        <div className="mt-5">
          <p className="eyebrow">Podglad zamiany</p>
          <div className="grid gap-3 xl:grid-cols-6">
            <article className="lot-card">
              <p className="table-title">Rozliczenie</p>
              <p className="table-note mt-2">{formatDate(swapPreview.settlementDate)}</p>
            </article>
            <article className="lot-card">
              <p className="table-title">Wplyw brutto</p>
              <p className="table-note mt-2">
                {formatCurrency(swapPreview.sourceRedemption.grossValueTotal)}
              </p>
            </article>
            <article className="lot-card">
              <p className="table-title">Wplyw netto</p>
              <p className="table-note mt-2">
                {formatCurrency(swapPreview.sourceRedemption.netValueTotal)}
              </p>
            </article>
            <article className="lot-card">
              <p className="table-title">Nowa seria</p>
              <p className="table-note mt-2">
                {swapPreview.targetCode} x {swapPreview.targetQuantity}
              </p>
            </article>
            <article className="lot-card">
              <p className="table-title">Cena zamiany</p>
              <p className="table-note mt-2">
                {formatCurrency(swapPreview.swapPricePerUnit)}
              </p>
            </article>
            <article className="lot-card">
              <p className="table-title">Pozostaje do wyplaty</p>
              <p className="table-note mt-2">
                {formatCurrency(swapPreview.residualCashPln)}
              </p>
            </article>
          </div>
          <p className="field-note mt-3">
            Cena zamiany dotyczy tylko nowej serii. Zwykly wykup rozlicza sie wedlug
            wartosci obligacji i naleznych odsetek.
          </p>
        </div>
      ) : null}
    </section>
  );
}
