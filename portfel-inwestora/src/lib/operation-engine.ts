import { BASE_CURRENCY } from "@/lib/constants";
import { getPortfolioAssetGroupKey, normalizeSymbol } from "@/lib/ticker";
import { resolveTickerIdentity } from "@/lib/ticker-aliases";
import { getTodayDateInputValue, round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
import {
  normalizePortfolioAccountConfiguration,
  normalizePortfolioAccountType,
} from "@/lib/portfolio-account-rules";
import type {
  AccountKind,
  BrokerCode,
  CashBalance,
  CurrencyCode,
  InvestmentPortfolio,
  OperationType,
  PortfolioAccount,
  PortfolioBenchmarkDefinition,
  PortfolioInstrument,
  PortfolioOperation,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  PortfolioState,
  PortfolioTag,
  PortfolioTagAssignment,
  TagTargetType,
  InstrumentType,
  AssetKind,
  InstrumentIdentity,
  TreasuryBondSeries,
} from "@/types/portfolio";

const SUPPORTED_OPERATION_TYPES = new Set<OperationType>([
  "BUY",
  "SELL",
  "DEPOSIT",
  "WITHDRAW",
  "TRANSFER",
  "DIVIDEND",
  "COUPON",
  "INTEREST",
  "FEE",
  "TAX",
  "CONVERSION",
  "SPLIT",
  "REVERSE_SPLIT",
  "BONUS",
  "CUSTOM",
]);

const SUPPORTED_ACCOUNT_KINDS = new Set<AccountKind>([
  "investment",
  "cash",
  "currency",
]);

const SUPPORTED_BROKERS = new Set<BrokerCode>([
  "XTB",
  "IBKR",
  "DEGIRO",
  "TRADING212",
  "REVOLUT",
  "MBANK",
  "BOS",
  "SANTANDER",
  "BINANCE",
  "BYBIT",
  "KRAKEN",
  "CASH",
  "CURRENCY",
  "OTHER",
]);

const TAG_TARGET_TYPES = new Set<TagTargetType>([
  "portfolio",
  "instrument",
  "operation",
]);

const hasFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const getString = (value: unknown, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const normalizeCurrency = (
  value: unknown,
  fallback: CurrencyCode = BASE_CURRENCY
) => (typeof value === "string" ? toCurrencyCode(value, fallback) : fallback);

const getBoolean = (value: unknown, fallback = false) =>
  typeof value === "boolean" ? value : fallback;

const normalizeIsoDateTime = (value: unknown, fallback: string) => {
  if (typeof value !== "string" || !value) {
    return fallback;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? value : fallback;
};

const sortOperations = (operations: PortfolioOperation[]) =>
  [...operations].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
  );

export const getDefaultInvestmentAccountId = (portfolioId: string) =>
  `${portfolioId}:account:investment:default`;

export const getDefaultCashAccountId = (
  portfolioId: string,
  currency: CurrencyCode = BASE_CURRENCY
) => `${portfolioId}:account:cash:${toCurrencyCode(currency, BASE_CURRENCY)}`;

export const getDefaultCurrencyAccountId = (
  portfolioId: string,
  currency: CurrencyCode
) => getDefaultCashAccountId(portfolioId, currency);

const normalizePortfolioAccountId = (portfolioId: string, accountId: string) => {
  const legacyPrefix = `${portfolioId}:account:currency:`;

  return accountId.startsWith(legacyPrefix)
    ? `${portfolioId}:account:cash:${accountId.slice(legacyPrefix.length)}`
    : accountId;
};

export const getPortfolioInstrumentId = (
  portfolioId: string,
  target: {
    kind?: AssetKind;
    symbol?: string;
    instrumentIdentity?: InstrumentIdentity;
  }
) => {
  const kind = target.kind ?? "stock";
  const symbol = resolveTickerIdentity({
    symbol: target.symbol ?? "",
    kind,
  }).symbol;
  const key = getPortfolioAssetGroupKey({
    kind,
    symbol,
    instrumentIdentity: target.instrumentIdentity,
  });

  return `${portfolioId}:instrument:${key}`;
};

export const getInstrumentTypeForAssetKind = (kind: AssetKind): InstrumentType => {
  if (kind === "etf") return "ETF";
  if (kind === "crypto") return "CRYPTO";
  if (kind === "bond") return "BOND";
  return "STOCK";
};

const createDefaultAccount = ({
  portfolioId,
  id,
  name,
  kind,
  broker,
  currency,
  now,
}: {
  portfolioId: string;
  id: string;
  name: string;
  kind: AccountKind;
  broker: BrokerCode;
  currency: CurrencyCode;
  now: string;
}): PortfolioAccount => ({
  id,
  portfolioId,
  name,
  kind,
  broker,
  currency: toCurrencyCode(currency, BASE_CURRENCY),
  isDefault: true,
  metadata: {},
  createdAt: now,
  updatedAt: now,
});

const normalizeBroker = (value: unknown, fallback: BrokerCode): BrokerCode =>
  typeof value === "string" && SUPPORTED_BROKERS.has(value as BrokerCode)
    ? (value as BrokerCode)
    : fallback;

const normalizeAccountKind = (value: unknown, fallback: AccountKind): AccountKind =>
  typeof value === "string" && SUPPORTED_ACCOUNT_KINDS.has(value as AccountKind)
    ? (value as AccountKind)
    : fallback;

export const createDefaultPortfolioAccounts = (
  portfolioId: string,
  baseCurrency: CurrencyCode = BASE_CURRENCY,
  now = new Date().toISOString()
) => {
  const normalizedBaseCurrency = toCurrencyCode(baseCurrency, BASE_CURRENCY);

  return [
    createDefaultAccount({
      portfolioId,
      id: getDefaultInvestmentAccountId(portfolioId),
      name: "Domyslne konto inwestycyjne",
      kind: "investment",
      broker: "OTHER",
      currency: normalizedBaseCurrency,
      now,
    }),
    createDefaultAccount({
      portfolioId,
      id: getDefaultCashAccountId(portfolioId, normalizedBaseCurrency),
      name: `Gotowka ${normalizedBaseCurrency}`,
      kind: "cash",
      broker: "CASH",
      currency: normalizedBaseCurrency,
      now,
    }),
  ];
};

export const ensurePortfolioCashAccount = (
  accounts: PortfolioAccount[],
  portfolioId: string,
  currency: CurrencyCode,
  now = new Date().toISOString()
) => {
  const normalizedCurrency = toCurrencyCode(currency, BASE_CURRENCY);
  const defaultAccountId = getDefaultCashAccountId(portfolioId, normalizedCurrency);
  const existingAccount = accounts.find(
    (account) =>
      account.metadata.archived !== true &&
      account.id === defaultAccountId
  );

  if (existingAccount) {
    return { accounts, account: existingAccount };
  }

  const account = createDefaultAccount({
    portfolioId,
    id: defaultAccountId,
    name: `Gotowka ${normalizedCurrency}`,
    kind: normalizedCurrency === BASE_CURRENCY ? "cash" : "currency",
    broker: normalizedCurrency === BASE_CURRENCY ? "CASH" : "CURRENCY",
    currency: normalizedCurrency,
    now,
  });

  return {
    accounts: [...accounts, account],
    account,
  };
};

export const normalizePortfolioAccounts = (
  portfolioId: string,
  accounts: unknown,
  baseCurrency: CurrencyCode = BASE_CURRENCY,
  now = new Date().toISOString()
) => {
  const normalizedAccounts = (Array.isArray(accounts) ? accounts : [])
    .map((account): PortfolioAccount | null => {
      const rawAccount = asRecord(account);
      const id = getString(rawAccount.id);

      if (!id) {
        return null;
      }

      const metadata = asRecord(rawAccount.metadata);

      if (metadata.archived === true) {
        return null;
      }

      const kind = normalizeAccountKind(rawAccount.kind, "investment");
      const currency = normalizeCurrency(rawAccount.currency);

      return {
        id: normalizePortfolioAccountId(portfolioId, id),
        portfolioId,
        parentAccountId: getString(rawAccount.parentAccountId) || undefined,
        name: getString(rawAccount.name, kind === "investment" ? "Konto inwestycyjne" : `Gotowka ${currency}`),
        kind,
        broker: normalizeBroker(rawAccount.broker, kind === "investment" ? "OTHER" : "CASH"),
        currency,
        isDefault: getBoolean(rawAccount.isDefault, false),
        metadata,
        createdAt: normalizeIsoDateTime(rawAccount.createdAt, now),
        updatedAt: normalizeIsoDateTime(rawAccount.updatedAt, now),
      } satisfies PortfolioAccount;
    })
    .filter((account): account is PortfolioAccount => Boolean(account));

  const defaultAccounts = createDefaultPortfolioAccounts(portfolioId, baseCurrency, now);
  const accountsById = new Map<string, PortfolioAccount>();

  [...normalizedAccounts, ...defaultAccounts].forEach((account) => {
    const existing = accountsById.get(account.id);
    accountsById.set(account.id, existing ? { ...account, ...existing } : account);
  });

  return Array.from(accountsById.values());
};

const normalizeInstrumentType = (value: unknown, fallback: InstrumentType): InstrumentType => {
  if (
    value === "STOCK" ||
    value === "ETF" ||
    value === "BOND" ||
    value === "CRYPTO" ||
    value === "FUND" ||
    value === "TERM_DEPOSIT" ||
    value === "CASH" ||
    value === "OTHER"
  ) {
    return value;
  }

  return fallback;
};

const buildLegacyInstruments = (
  portfolioId: string,
  state: PortfolioState,
  now: string
) => {
  const instrumentsById = new Map<string, PortfolioInstrument>();
  const addInstrument = (
    source: {
      kind: AssetKind;
      symbol: string;
      name?: string;
      marketCurrency?: CurrencyCode;
      provider?: PortfolioInstrument["provider"];
      providerId?: string;
      priceScale?: number;
      instrumentIdentity?: InstrumentIdentity;
      bondMeta?: TreasuryBondSeries;
    }
  ) => {
    const id = getPortfolioInstrumentId(portfolioId, source);

    if (instrumentsById.has(id)) {
      return;
    }

    instrumentsById.set(id, {
      id,
      portfolioId,
      type: getInstrumentTypeForAssetKind(source.kind),
      assetKind: source.kind,
      symbol: resolveTickerIdentity({
        symbol: source.symbol,
        kind: source.kind,
        marketCurrency: source.marketCurrency,
      }).symbol,
      name: source.name?.trim() || normalizeSymbol(source.symbol),
      marketCurrency: toCurrencyCode(source.marketCurrency, BASE_CURRENCY),
      provider: source.provider,
      providerId: source.providerId,
      priceScale: source.priceScale,
      metadata: {
        legacyGroupKey: getPortfolioAssetGroupKey({
          kind: source.kind,
          symbol: source.symbol,
          instrumentIdentity: source.instrumentIdentity,
        }),
        ...(source.bondMeta
          ? {
              treasuryBondType: source.bondMeta.type,
              treasuryBondCode: source.bondMeta.code,
            }
          : {}),
      },
      instrumentIdentity: source.instrumentIdentity,
      createdAt: now,
      updatedAt: now,
    });
  };

  state.assets.forEach(addInstrument);
  state.sales.forEach(addInstrument);
  state.sales.forEach((sale) => {
    sale.allocations.forEach((allocation) => {
      if (allocation.kind && allocation.symbol) {
        addInstrument({
          kind: allocation.kind,
          symbol: allocation.symbol,
          name: allocation.name,
          marketCurrency: allocation.marketCurrency,
          provider: allocation.provider,
          providerId: allocation.providerId,
          priceScale: allocation.priceScale,
          instrumentIdentity: allocation.instrumentIdentity,
          bondMeta: allocation.bondMeta,
        });
      }
    });
  });

  return Array.from(instrumentsById.values());
};

export const normalizePortfolioInstruments = (
  portfolioId: string,
  instruments: unknown,
  state: PortfolioState,
  now = new Date().toISOString()
) => {
  const normalizedInstruments = (Array.isArray(instruments) ? instruments : [])
    .map((instrument): PortfolioInstrument | null => {
      const rawInstrument = asRecord(instrument);
      const id = getString(rawInstrument.id);
      const symbol = normalizeSymbol(getString(rawInstrument.symbol));

      if (!id || !symbol) {
        return null;
      }

      const assetKind =
        rawInstrument.assetKind === "stock" ||
        rawInstrument.assetKind === "etf" ||
        rawInstrument.assetKind === "crypto" ||
        rawInstrument.assetKind === "bond"
          ? rawInstrument.assetKind
          : undefined;
      const type = normalizeInstrumentType(
        rawInstrument.type,
        assetKind ? getInstrumentTypeForAssetKind(assetKind) : "OTHER"
      );

      return {
        id,
        portfolioId,
        type,
        assetKind,
        symbol,
        name: getString(rawInstrument.name, symbol),
        marketCurrency: normalizeCurrency(rawInstrument.marketCurrency),
        provider:
          typeof rawInstrument.provider === "string"
            ? (rawInstrument.provider as PortfolioInstrument["provider"])
            : undefined,
        providerId: getString(rawInstrument.providerId) || undefined,
        isin: getString(rawInstrument.isin) || undefined,
        priceScale:
          hasFiniteNumber(rawInstrument.priceScale) && rawInstrument.priceScale > 0
            ? rawInstrument.priceScale
            : undefined,
        instrumentIdentity:
          assetKind === "etf" && asRecord(rawInstrument.instrumentIdentity).ticker
            ? (asRecord(rawInstrument.instrumentIdentity) as InstrumentIdentity)
            : undefined,
        metadata: asRecord(rawInstrument.metadata),
        createdAt: normalizeIsoDateTime(rawInstrument.createdAt, now),
        updatedAt: normalizeIsoDateTime(rawInstrument.updatedAt, now),
      } satisfies PortfolioInstrument;
    })
    .filter((instrument): instrument is PortfolioInstrument => Boolean(instrument));
  const instrumentsById = new Map(
    [...normalizedInstruments, ...buildLegacyInstruments(portfolioId, state, now)].map(
      (instrument) => [instrument.id, instrument] as const
    )
  );

  return Array.from(instrumentsById.values()).sort((left, right) =>
    left.symbol.localeCompare(right.symbol)
  );
};

const createOperation = ({
  id,
  portfolioId,
  accountId,
  assetId,
  operationType,
  quantity,
  price,
  currency,
  exchangeRate,
  fee = 0,
  tax = 0,
  amount,
  date,
  notes = "",
  metadata,
  createdAt,
  updatedAt = createdAt,
}: PortfolioOperation): PortfolioOperation => ({
  id,
  portfolioId,
  accountId,
  assetId,
  operationType,
  quantity: quantity === null ? null : round(quantity, 8),
  price: price === null ? null : round(price, 8),
  currency: toCurrencyCode(currency, BASE_CURRENCY),
  exchangeRate: exchangeRate === null ? null : round(exchangeRate, 8),
  fee: round(fee, 8),
  tax: round(tax, 8),
  amount: round(amount, 8),
  date: toDateInputValue(date, getTodayDateInputValue()),
  notes,
  metadata,
  createdAt,
  updatedAt,
});

const getLegacyOperationMetadata = (
  source: string,
  sourceId: string,
  metadata: Record<string, unknown> = {}
) => ({
  ...metadata,
  legacySource: source,
  legacySourceId: sourceId,
  // Legacy positions describe holdings, not a complete cash ledger.
  cashImpact: false,
});

const buildBuyOperation = (
  portfolioId: string,
  asset: PortfolioState["assets"][number],
  originalQuantity = asset.quantity,
  originalFeePln = asset.feePln
) => {
  const priceCurrency = toCurrencyCode(asset.purchasePriceCurrency, asset.purchaseCurrency);
  const exchangeRate =
    typeof asset.purchaseFxRateToPln === "number" && Number.isFinite(asset.purchaseFxRateToPln)
      ? asset.purchaseFxRateToPln
      : priceCurrency === BASE_CURRENCY
        ? 1
        : null;
  const settlementCurrency = toCurrencyCode(asset.purchaseCurrency, priceCurrency);
  const settlementFxRateToPln =
    typeof asset.purchaseSettlementFxRateToPln === "number" &&
    Number.isFinite(asset.purchaseSettlementFxRateToPln) &&
    asset.purchaseSettlementFxRateToPln > 0
      ? asset.purchaseSettlementFxRateToPln
      : settlementCurrency === BASE_CURRENCY
        ? 1
        : settlementCurrency === priceCurrency
          ? exchangeRate
          : null;
  const marketAmount = round(originalQuantity * asset.purchasePrice, 8);
  const settlementAmount =
    settlementCurrency === priceCurrency
      ? marketAmount
      : exchangeRate && settlementFxRateToPln
        ? round((marketAmount * exchangeRate) / settlementFxRateToPln, 8)
        : marketAmount;
  const settlementFee = settlementCurrency === BASE_CURRENCY ? originalFeePln : 0;

  return createOperation({
    id: `op-buy-${asset.id}`,
    portfolioId,
    accountId: getDefaultCashAccountId(portfolioId, settlementCurrency),
    assetId: getPortfolioInstrumentId(portfolioId, asset),
    operationType: "BUY",
    quantity: originalQuantity,
    price: asset.purchasePrice,
    currency: settlementCurrency,
    exchangeRate,
    fee: settlementFee,
    tax: 0,
    amount: settlementAmount,
    date: asset.purchaseDate,
    notes: "",
    metadata: getLegacyOperationMetadata("asset", asset.id, {
      lotId: asset.id,
      feeCurrency: BASE_CURRENCY,
      marketCurrency: asset.marketCurrency,
      settlementCurrency,
      cashCurrency: settlementCurrency,
      cashAmount: settlementAmount,
      cashSettlementDirect: true,
      purchasePriceCurrency: priceCurrency,
      marketAmount,
      settlementFxRateToPln,
      provider: asset.provider,
      providerId: asset.providerId,
      groupOrder: asset.groupOrder,
    }),
    createdAt: asset.createdAt,
    updatedAt: asset.createdAt,
  });
};

const buildSellOperation = (portfolioId: string, sale: PortfolioSale) => {
  const settlementCurrency = toCurrencyCode(
    sale.realizedValueCurrency ?? sale.allocations[0]?.purchaseCurrency,
    sale.marketCurrency
  );
  const hasRecordedSettlementAmount =
    typeof sale.realizedProceedsValue === "number" &&
    Number.isFinite(sale.realizedProceedsValue);
  const settlementAmount = hasRecordedSettlementAmount
    ? sale.realizedProceedsValue!
    : settlementCurrency === BASE_CURRENCY
      ? sale.realizedProceedsPln
      : round(sale.quantity * sale.salePrice, 8);
  const settlementFee = hasRecordedSettlementAmount ? 0 : settlementCurrency === BASE_CURRENCY ? sale.feePln : 0;
  const settlementTax = hasRecordedSettlementAmount ? 0 : settlementCurrency === BASE_CURRENCY ? sale.taxTotalPln ?? 0 : 0;

  return createOperation({
    id: `op-sell-${sale.id}`,
    portfolioId,
    accountId: getDefaultCashAccountId(portfolioId, settlementCurrency),
    assetId: getPortfolioInstrumentId(portfolioId, sale),
    operationType: "SELL",
    quantity: sale.quantity,
    price: sale.salePrice,
    currency: settlementCurrency,
    exchangeRate: sale.marketCurrency === BASE_CURRENCY ? 1 : null,
    fee: settlementFee,
    tax: settlementTax,
    amount: settlementAmount,
    date: sale.saleDate,
    notes: "",
    metadata: getLegacyOperationMetadata("sale", sale.id, {
      transactionKind: sale.transactionKind,
      allocations: sale.allocations,
      feeCurrency: BASE_CURRENCY,
      taxCurrency: BASE_CURRENCY,
      realizedInvestedPln: sale.realizedInvestedPln,
      realizedProceedsPln: sale.realizedProceedsPln,
      realizedProfitLossPln: sale.realizedProfitLossPln,
      realizedValueCurrency: sale.realizedValueCurrency,
      realizedProfitLossValue: sale.realizedProfitLossValue,
      grossProfitLossPln: sale.grossProfitLossPln,
      marketCurrency: sale.marketCurrency,
      cashCurrency: settlementCurrency,
      cashAmount: settlementAmount,
      cashSettlementDirect: true,
      cashAmountIsNet: hasRecordedSettlementAmount,
    }),
    createdAt: sale.createdAt,
    updatedAt: sale.createdAt,
  });
};

const removeLegacyOperationMetadata = (metadata: Record<string, unknown>) => {
  const currentMetadata = { ...metadata };
  delete currentMetadata.legacySource;
  delete currentMetadata.legacySourceId;
  return currentMetadata;
};

/**
 * New manual trades receive an explicit cash mirror. Historical lots remain
 * protected by the legacy `cashImpact: false` marker, so enabling cash does
 * not invent an opening balance for portfolios whose earlier ledger may be
 * incomplete.
 */
export const buildCashImpactBuyOperation = (
  portfolioId: string,
  asset: PortfolioState["assets"][number]
) => {
  const operation = buildBuyOperation(portfolioId, asset);

  return {
    ...operation,
    id: `op-cash-buy-${asset.id}`,
    fee: round(Math.abs(asset.feePln), 8),
    metadata: {
      ...removeLegacyOperationMetadata(operation.metadata),
      cashImpact: true,
      cashMirror: true,
      lotId: asset.id,
      feeCurrency: BASE_CURRENCY,
      feeAccountId: getDefaultCashAccountId(portfolioId, BASE_CURRENCY),
    },
  } satisfies PortfolioOperation;
};

export const buildCashImpactSellOperation = (
  portfolioId: string,
  sale: PortfolioSale
) => {
  const operation = buildSellOperation(portfolioId, sale);

  return {
    ...operation,
    id: `op-cash-sell-${sale.id}`,
    metadata: {
      ...removeLegacyOperationMetadata(operation.metadata),
      cashImpact: true,
      cashMirror: true,
      saleId: sale.id,
    },
  } satisfies PortfolioOperation;
};

const buildAdjustmentOperation = (
  portfolioId: string,
  adjustment: PortfolioRealizedAdjustment
) => {
  const currency = toCurrencyCode(adjustment.currency, BASE_CURRENCY);
  const exchangeRate =
    currency === BASE_CURRENCY
      ? 1
      : adjustment.amount !== 0
        ? round(adjustment.amountPlnSnapshot / adjustment.amount, 8)
        : null;

  return createOperation({
    id: `op-adjustment-${adjustment.id}`,
    portfolioId,
    accountId:
      currency === BASE_CURRENCY
        ? getDefaultCashAccountId(portfolioId, currency)
        : getDefaultCurrencyAccountId(portfolioId, currency),
    assetId: null,
    operationType: adjustment.source === "bond-coupon" ? "COUPON" : "CUSTOM",
    quantity: null,
    price: null,
    currency,
    exchangeRate,
    fee: 0,
    tax: 0,
    amount: adjustment.amount,
    date: adjustment.date,
    notes: adjustment.note ?? "",
    metadata: getLegacyOperationMetadata("realizedAdjustment", adjustment.id, {
      amountPlnSnapshot: adjustment.amountPlnSnapshot,
      source: adjustment.source,
      bondCode: adjustment.bondCode,
    }),
    createdAt: adjustment.createdAt,
    updatedAt: adjustment.createdAt,
  });
};

const getSoldLotHistoryById = (sales: PortfolioSale[]) => {
  const soldLotHistoryById = new Map<string, { quantity: number; feePln: number }>();

  sales.forEach((sale) => {
    sale.allocations.forEach((allocation) => {
      const current = soldLotHistoryById.get(allocation.lotId) ?? {
        quantity: 0,
        feePln: 0,
      };
      soldLotHistoryById.set(
        allocation.lotId,
        {
          quantity: round(current.quantity + allocation.quantity, 8),
          feePln: round(current.feePln + allocation.allocatedBuyFeePln, 8),
        }
      );
    });
  });

  return soldLotHistoryById;
};

export const buildOperationsFromLegacyState = (
  portfolioId: string,
  state: PortfolioState
) => {
  const soldLotHistoryById = getSoldLotHistoryById(state.sales);

  return sortOperations([
    ...state.assets.map((asset) => {
      const soldLotHistory = soldLotHistoryById.get(asset.id);

      return buildBuyOperation(
        portfolioId,
        asset,
        round(asset.quantity + (soldLotHistory?.quantity ?? 0), 8),
        round(asset.feePln + (soldLotHistory?.feePln ?? 0), 8)
      );
    }),
    ...state.sales.map((sale) => buildSellOperation(portfolioId, sale)),
    ...state.realizedAdjustments.map((adjustment) =>
      buildAdjustmentOperation(portfolioId, adjustment)
    ),
  ]);
};

const normalizeOperationType = (value: unknown): OperationType =>
  typeof value === "string" && SUPPORTED_OPERATION_TYPES.has(value as OperationType)
    ? (value as OperationType)
    : "CUSTOM";

export const normalizePortfolioOperation = (
  portfolioId: string,
  operation: unknown,
  _accounts: PortfolioAccount[],
  instruments: PortfolioInstrument[],
  now = new Date().toISOString()
) => {
  const rawOperation = asRecord(operation);
  const id = getString(rawOperation.id);

  if (!id) {
    return null;
  }

  const instrumentIds = new Set(instruments.map((instrument) => instrument.id));
  const fallbackAccountId = getDefaultInvestmentAccountId(portfolioId);
  const accountId = normalizePortfolioAccountId(
    portfolioId,
    getString(rawOperation.accountId, fallbackAccountId)
  );
  const assetId = getString(rawOperation.assetId) || null;
  const operationType = normalizeOperationType(rawOperation.operationType);
  const quantity = hasFiniteNumber(rawOperation.quantity) ? rawOperation.quantity : null;
  const price = hasFiniteNumber(rawOperation.price) ? rawOperation.price : null;
  const amount =
    hasFiniteNumber(rawOperation.amount) && rawOperation.amount !== 0
      ? rawOperation.amount
      : quantity && price
        ? quantity * price
        : 0;

  return createOperation({
    id,
    portfolioId,
    accountId: accountId || fallbackAccountId,
    assetId: assetId && instrumentIds.has(assetId) ? assetId : null,
    operationType,
    quantity,
    price,
    currency: normalizeCurrency(rawOperation.currency),
    exchangeRate: hasFiniteNumber(rawOperation.exchangeRate) ? rawOperation.exchangeRate : null,
    fee: hasFiniteNumber(rawOperation.fee) ? rawOperation.fee : 0,
    tax: hasFiniteNumber(rawOperation.tax) ? rawOperation.tax : 0,
    amount,
    date: toDateInputValue(getString(rawOperation.date), getTodayDateInputValue()),
    notes: getString(rawOperation.notes),
    metadata: asRecord(rawOperation.metadata),
    createdAt: normalizeIsoDateTime(rawOperation.createdAt, now),
    updatedAt: normalizeIsoDateTime(rawOperation.updatedAt, now),
  });
};

const isLegacyOperation = (operation: PortfolioOperation) =>
  typeof operation.metadata.legacySource === "string";

const getTradeOperationIdentity = (operation: PortfolioOperation) => {
  if (
    (operation.operationType !== "BUY" && operation.operationType !== "SELL") ||
    !operation.assetId ||
    operation.quantity === null ||
    operation.price === null
  ) {
    return null;
  }

  return [
    operation.operationType,
    operation.assetId,
    operation.date,
    round(operation.quantity, 8),
    round(operation.price, 8),
  ].join(":");
};

const normalizeAutomaticBrokerFxOperations = (operations: PortfolioOperation[]) => {
  const existingAutomaticConversionIds = new Set(
    operations
      .map((operation) =>
        typeof operation.metadata.autoFxForOperationId === "string"
          ? operation.metadata.autoFxForOperationId
          : null
      )
      .filter((operationId): operationId is string => Boolean(operationId))
  );

  return operations.flatMap((operation) => {
    const isTrade = operation.operationType === "BUY" || operation.operationType === "SELL";
    const marketCurrency = getMetadataString(operation.metadata, "marketCurrency");
    const cashCurrency = getMetadataString(operation.metadata, "cashCurrency");
    const marketAmount =
      getMetadataNumber(operation.metadata, "marketAmount") ??
      (operation.quantity && operation.price ? operation.quantity * operation.price : 0);
    const cashAmount = getMetadataNumber(operation.metadata, "cashAmount") ?? operation.amount;
    const isAlreadyNormalized = operation.metadata.autoFxTradeNormalized === true;

    if (
      !isTrade ||
      operation.metadata.autoFxConversion !== true ||
      isAlreadyNormalized ||
      !marketCurrency ||
      !cashCurrency ||
      marketCurrency === cashCurrency ||
      marketAmount <= 0 ||
      cashAmount <= 0 ||
      existingAutomaticConversionIds.has(operation.id)
    ) {
      return [operation];
    }

    const isBuy = operation.operationType === "BUY";
    const sourceCurrency = toCurrencyCode(isBuy ? cashCurrency : marketCurrency);
    const sourceAmount = isBuy ? cashAmount : marketAmount;
    const targetCurrency = toCurrencyCode(isBuy ? marketCurrency : cashCurrency);
    const targetAmount = isBuy ? marketAmount : cashAmount;
    const conversionId = `${operation.id}:auto-fx`;
    const conversionCreatedAt = new Date(
      Date.parse(operation.createdAt) + (isBuy ? -1 : 1)
    ).toISOString();
    const normalizedTrade: PortfolioOperation = {
      ...operation,
      currency: toCurrencyCode(marketCurrency),
      amount: round(marketAmount, 6),
      metadata: {
        ...operation.metadata,
        autoFxTradeNormalized: true,
      },
    };
    const automaticConversion: PortfolioOperation = {
      id: conversionId,
      portfolioId: operation.portfolioId,
      accountId: operation.accountId,
      assetId: null,
      operationType: "CONVERSION",
      quantity: null,
      price: null,
      currency: sourceCurrency,
      exchangeRate: null,
      fee: 0,
      tax: 0,
      amount: round(sourceAmount, 6),
      date: operation.date,
      notes: "Automatyczne przewalutowanie brokera",
      metadata: {
        kind: "cash",
        cashImpact: true,
        importSource: operation.metadata.importSource,
        autoFxConversion: true,
        autoFxForOperationId: operation.id,
        brokerFxSpreadRate: operation.metadata.brokerFxSpreadRate,
        targetAccountId: operation.accountId,
        targetCurrency,
        targetAmount: round(targetAmount, 6),
      },
      createdAt: conversionCreatedAt,
      updatedAt: conversionCreatedAt,
    };

    return [automaticConversion, normalizedTrade];
  });
};

export const normalizePortfolioOperations = (
  portfolioId: string,
  operations: unknown,
  accounts: PortfolioAccount[],
  instruments: PortfolioInstrument[],
  state: PortfolioState,
  now = new Date().toISOString()
) => {
  const normalizedExisting = (Array.isArray(operations) ? operations : [])
    .map((operation) =>
      normalizePortfolioOperation(portfolioId, operation, accounts, instruments, now)
    )
    .filter((operation): operation is PortfolioOperation => Boolean(operation));
  const existingCustomOperations = normalizeAutomaticBrokerFxOperations(
    normalizedExisting.filter(
    (operation) => !isLegacyOperation(operation)
    )
  );
  const customTradeIndexes = new Map<string, number[]>();

  existingCustomOperations.forEach((operation, index) => {
    const identity = getTradeOperationIdentity(operation);

    if (identity) {
      customTradeIndexes.set(identity, [
        ...(customTradeIndexes.get(identity) ?? []),
        index,
      ]);
    }
  });

  const derivedLegacyOperations = buildOperationsFromLegacyState(portfolioId, state).filter(
    (operation) => {
      const identity = getTradeOperationIdentity(operation);
      const matchingCustomIndexes = identity
        ? customTradeIndexes.get(identity) ?? []
        : [];

      if (!identity || matchingCustomIndexes.length === 0) {
        return true;
      }

      const [matchingCustomIndex, ...remainingIndexes] = matchingCustomIndexes;
      customTradeIndexes.set(identity, remainingIndexes);
      const matchingCustomOperation = existingCustomOperations[matchingCustomIndex!];
      const legacySourceId = getMetadataString(operation.metadata, "legacySourceId");

      if (matchingCustomOperation && legacySourceId) {
        existingCustomOperations[matchingCustomIndex!] = {
          ...matchingCustomOperation,
          metadata: {
            ...matchingCustomOperation.metadata,
            ...(operation.operationType === "BUY" &&
            typeof matchingCustomOperation.metadata.lotId !== "string"
              ? { lotId: legacySourceId }
              : {}),
            ...(operation.operationType === "SELL" &&
            typeof matchingCustomOperation.metadata.saleId !== "string"
              ? { saleId: legacySourceId }
              : {}),
          },
        };
      }
      return false;
    }
  );
  const operationsById = new Map(
    [...existingCustomOperations, ...derivedLegacyOperations].map(
      (operation) => [operation.id, operation] as const
    )
  );

  return sortOperations(Array.from(operationsById.values()));
};

const normalizeTagColor = (value: unknown) => {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim())) {
    return value.trim();
  }

  return "#64748b";
};

export const normalizePortfolioTags = (
  portfolioId: string,
  tags: unknown,
  now = new Date().toISOString()
) =>
  (Array.isArray(tags) ? tags : [])
    .map((tag): PortfolioTag | null => {
      const rawTag = asRecord(tag);
      const id = getString(rawTag.id);
      const name = getString(rawTag.name);

      if (!id || !name) {
        return null;
      }

      return {
        id,
        portfolioId,
        name: name.slice(0, 48),
        color: normalizeTagColor(rawTag.color),
        createdAt: normalizeIsoDateTime(rawTag.createdAt, now),
        updatedAt: normalizeIsoDateTime(rawTag.updatedAt, now),
      } satisfies PortfolioTag;
    })
    .filter((tag): tag is PortfolioTag => Boolean(tag));

export const normalizePortfolioTagAssignments = (
  portfolioId: string,
  assignments: unknown,
  tags: PortfolioTag[],
  operations: PortfolioOperation[],
  instruments: PortfolioInstrument[],
  now = new Date().toISOString()
) => {
  const tagIds = new Set(tags.map((tag) => tag.id));
  const operationIds = new Set(operations.map((operation) => operation.id));
  const instrumentIds = new Set(instruments.map((instrument) => instrument.id));

  return (Array.isArray(assignments) ? assignments : [])
    .map((assignment): PortfolioTagAssignment | null => {
      const rawAssignment = asRecord(assignment);
      const id = getString(rawAssignment.id);
      const tagId = getString(rawAssignment.tagId);
      const targetType =
        typeof rawAssignment.targetType === "string" &&
        TAG_TARGET_TYPES.has(rawAssignment.targetType as TagTargetType)
          ? (rawAssignment.targetType as TagTargetType)
          : null;
      const targetId = getString(rawAssignment.targetId);

      if (!id || !tagIds.has(tagId) || !targetType || !targetId) {
        return null;
      }

      if (targetType === "operation" && !operationIds.has(targetId)) {
        return null;
      }

      if (targetType === "instrument" && !instrumentIds.has(targetId)) {
        return null;
      }

      if (targetType === "portfolio" && targetId !== portfolioId) {
        return null;
      }

      return {
        id,
        portfolioId,
        tagId,
        targetType,
        targetId,
        createdAt: normalizeIsoDateTime(rawAssignment.createdAt, now),
      } satisfies PortfolioTagAssignment;
    })
    .filter((assignment): assignment is PortfolioTagAssignment => Boolean(assignment));
};

export const normalizePortfolioBenchmarks = (benchmarks: unknown) =>
  (Array.isArray(benchmarks) ? benchmarks : [])
    .map((benchmark): PortfolioBenchmarkDefinition | null => {
      const rawBenchmark = asRecord(benchmark);
      const id = getString(rawBenchmark.id);
      const symbol = normalizeSymbol(getString(rawBenchmark.symbol));

      if (!id || !symbol) {
        return null;
      }

      const kind =
        rawBenchmark.kind === "stock" ||
        rawBenchmark.kind === "etf" ||
        rawBenchmark.kind === "crypto" ||
        rawBenchmark.kind === "bond"
          ? rawBenchmark.kind
          : "etf";

      return {
        id,
        name: getString(rawBenchmark.name, symbol),
        symbol,
        kind,
        marketCurrency: normalizeCurrency(rawBenchmark.marketCurrency),
        provider:
          typeof rawBenchmark.provider === "string"
            ? (rawBenchmark.provider as PortfolioBenchmarkDefinition["provider"])
            : "stooq",
        providerId: getString(rawBenchmark.providerId) || undefined,
        priceScale:
          hasFiniteNumber(rawBenchmark.priceScale) && rawBenchmark.priceScale > 0
            ? rawBenchmark.priceScale
            : undefined,
      } satisfies PortfolioBenchmarkDefinition;
    })
    .filter((benchmark): benchmark is PortfolioBenchmarkDefinition => Boolean(benchmark));

export const collectPortfolioCurrencies = (
  state: PortfolioState,
  operations: unknown = []
) =>
  Array.from(
    new Set(
      [
        BASE_CURRENCY,
        ...state.assets.flatMap((asset) => [
          asset.purchaseCurrency,
          asset.purchasePriceCurrency,
          asset.marketCurrency,
        ]),
        ...state.sales.flatMap((sale) => [
          sale.realizedValueCurrency,
          sale.marketCurrency,
          ...sale.allocations.flatMap((allocation) => [
            allocation.purchaseCurrency,
            allocation.purchasePriceCurrency,
            allocation.marketCurrency,
          ]),
        ]),
        ...state.realizedAdjustments.map((adjustment) => adjustment.currency),
        ...(Array.isArray(operations)
          ? operations.flatMap((operation) => {
              const rawOperation = asRecord(operation);
              const metadata = asRecord(rawOperation.metadata);

              return [
                rawOperation.currency,
                metadata.cashCurrency,
                metadata.sourceCurrency,
                metadata.targetCurrency,
              ].map((currency) => normalizeCurrency(currency));
            })
          : []),
      ].map((currency) => toCurrencyCode(currency, BASE_CURRENCY))
    )
  );

export const ensurePortfolioCoreModel = (
  portfolio: InvestmentPortfolio
): InvestmentPortfolio => {
  const now = new Date().toISOString();
  const baseCurrency = toCurrencyCode(portfolio.baseCurrency, BASE_CURRENCY);
  const accounts = normalizePortfolioAccounts(portfolio.id, portfolio.accounts, baseCurrency, now);
  const instruments = normalizePortfolioInstruments(
    portfolio.id,
    portfolio.instruments,
    portfolio,
    now
  );
  const operations = normalizePortfolioOperations(
    portfolio.id,
    portfolio.operations,
    accounts,
    instruments,
    portfolio,
    now
  );
  const tags = normalizePortfolioTags(portfolio.id, portfolio.tags, now);
  const accountType = normalizePortfolioAccountType(portfolio.accountType);

  return {
    ...portfolio,
    accountType,
    accountConfiguration: normalizePortfolioAccountConfiguration(
      portfolio.accountConfiguration,
      accountType
    ),
    schemaVersion: 2,
    baseCurrency,
    subPortfolios: Array.isArray(portfolio.subPortfolios)
      ? portfolio.subPortfolios
          .map((subPortfolio) => {
            const rawSubPortfolio = asRecord(subPortfolio);
            const id = getString(rawSubPortfolio.id);
            const name = getString(rawSubPortfolio.name);

            if (!id || !name) {
              return null;
            }

            return {
              id,
              portfolioId: portfolio.id,
              name: name.slice(0, 64),
              currency: normalizeCurrency(rawSubPortfolio.currency),
              metadata: asRecord(rawSubPortfolio.metadata),
              createdAt: normalizeIsoDateTime(rawSubPortfolio.createdAt, now),
              updatedAt: normalizeIsoDateTime(rawSubPortfolio.updatedAt, now),
            };
          })
          .filter(
            (subPortfolio): subPortfolio is NonNullable<InvestmentPortfolio["subPortfolios"]>[number] =>
              Boolean(subPortfolio)
          )
      : [],
    accounts,
    instruments,
    operations,
    tags,
    tagAssignments: normalizePortfolioTagAssignments(
      portfolio.id,
      portfolio.tagAssignments,
      tags,
      operations,
      instruments,
      now
    ),
    benchmarks: normalizePortfolioBenchmarks(portfolio.benchmarks),
    metadata: asRecord(portfolio.metadata),
  };
};

const getCashEffectAmount = (operation: PortfolioOperation) => {
  const amount = Math.abs(operation.amount);
  const feeAndTax = Math.abs(operation.fee) + Math.abs(operation.tax);

  switch (operation.operationType) {
    case "BUY":
    case "WITHDRAW":
      return -(amount + feeAndTax);
    case "SELL":
    case "DEPOSIT":
    case "COUPON":
    case "INTEREST":
    case "BONUS":
      return amount - feeAndTax;
    case "DIVIDEND":
      return hasFiniteNumber(operation.metadata.netAmount)
        ? operation.metadata.netAmount
        : amount - feeAndTax;
    case "FEE":
      return -Math.max(amount, Math.abs(operation.fee));
    case "TAX":
      return -Math.max(amount, Math.abs(operation.tax));
    case "CUSTOM":
      return operation.amount - feeAndTax;
    default:
      return 0;
  }
};

const getMetadataString = (
  metadata: Record<string, unknown>,
  key: string
) => (typeof metadata[key] === "string" ? metadata[key] : undefined);

const getMetadataNumber = (
  metadata: Record<string, unknown>,
  key: string
) => (hasFiniteNumber(metadata[key]) ? metadata[key] : undefined);

export const getOperationCashDeltas = (operation: PortfolioOperation): CashBalance[] => {
  if (operation.metadata.cashImpact === false) {
    return [];
  }

  if (operation.operationType === "SPLIT" || operation.operationType === "REVERSE_SPLIT") {
    return [];
  }

  if (
    (operation.operationType === "BUY" || operation.operationType === "SELL") &&
    operation.metadata.cashSettlementDirect === true
  ) {
    const cashCurrency = toCurrencyCode(
      getMetadataString(operation.metadata, "cashCurrency"),
      operation.currency
    );
    const cashAmount =
      getMetadataNumber(operation.metadata, "cashAmount") ?? Math.abs(operation.amount);
    const cashAmountIsNet = operation.metadata.cashAmountIsNet === true;
    const deltas: CashBalance[] = [
      {
        accountId: operation.accountId,
        currency: cashCurrency,
        amount: round(
          operation.operationType === "BUY"
            ? -Math.abs(cashAmount)
            : Math.abs(cashAmount),
          8
        ),
      },
    ];

    if (!cashAmountIsNet && Math.abs(operation.fee) > 0) {
      deltas.push({
        accountId:
          getMetadataString(operation.metadata, "feeAccountId") ?? operation.accountId,
        currency: toCurrencyCode(
          getMetadataString(operation.metadata, "feeCurrency"),
          cashCurrency
        ),
        amount: round(-Math.abs(operation.fee), 8),
      });
    }

    if (!cashAmountIsNet && Math.abs(operation.tax) > 0) {
      deltas.push({
        accountId:
          getMetadataString(operation.metadata, "taxAccountId") ?? operation.accountId,
        currency: toCurrencyCode(
          getMetadataString(operation.metadata, "taxCurrency"),
          cashCurrency
        ),
        amount: round(-Math.abs(operation.tax), 8),
      });
    }

    const combinedDeltas = new Map<string, CashBalance>();
    deltas.forEach((delta) => {
      const key = `${delta.accountId}:${delta.currency}`;
      const current = combinedDeltas.get(key);
      combinedDeltas.set(key, {
        accountId: delta.accountId,
        currency: delta.currency,
        amount: round((current?.amount ?? 0) + delta.amount, 8),
      });
    });

    return Array.from(combinedDeltas.values()).filter((delta) => delta.amount !== 0);
  }

  if (operation.operationType === "TRANSFER") {
    const targetAccountId = getMetadataString(operation.metadata, "targetAccountId");
    const targetAmount = getMetadataNumber(operation.metadata, "targetAmount") ?? operation.amount;
    const targetCurrency = toCurrencyCode(
      getMetadataString(operation.metadata, "targetCurrency"),
      operation.currency
    );

    return [
      {
        accountId: operation.accountId,
        currency: operation.currency,
        amount: round(-(Math.abs(operation.amount) + Math.abs(operation.fee)), 8),
      },
      ...(targetAccountId
        ? [
            {
              accountId: targetAccountId,
              currency: targetCurrency,
              amount: round(Math.abs(targetAmount), 8),
            },
          ]
        : []),
    ];
  }

  if (operation.operationType === "CONVERSION") {
    const targetAccountId =
      getMetadataString(operation.metadata, "targetAccountId") ?? operation.accountId;
    const targetCurrency = toCurrencyCode(
      getMetadataString(operation.metadata, "targetCurrency"),
      operation.currency
    );
    const targetAmount =
      getMetadataNumber(operation.metadata, "targetAmount") ??
      (operation.exchangeRate ? operation.amount * operation.exchangeRate : 0);

    return [
      {
        accountId: operation.accountId,
        currency: operation.currency,
        amount: round(-(Math.abs(operation.amount) + Math.abs(operation.fee)), 8),
      },
      {
        accountId: targetAccountId,
        currency: targetCurrency,
        amount: round(Math.abs(targetAmount), 8),
      },
    ];
  }

  const amount = getCashEffectAmount(operation);

  if (amount === 0) {
    return [];
  }

  return [
    {
      accountId: operation.accountId,
      currency: operation.currency,
      amount: round(amount, 8),
    },
  ];
};

export const calculateCashBalances = (
  operations: PortfolioOperation[],
  accounts?: PortfolioAccount[]
) => {
  const balancesByKey = new Map<string, CashBalance>();
  const activeAccountIds = accounts && accounts.length > 0
    ? new Set(
        accounts
          .filter((account) => account.metadata.archived !== true)
          .map((account) => account.id)
      )
    : null;

  operations.forEach((operation) => {
    getOperationCashDeltas(operation).forEach((delta) => {
      if (activeAccountIds && !activeAccountIds.has(delta.accountId)) {
        return;
      }

      const key = `${delta.accountId}:${delta.currency}`;
      const current = balancesByKey.get(key);

      balancesByKey.set(key, {
        accountId: delta.accountId,
        currency: delta.currency,
        amount: round((current?.amount ?? 0) + delta.amount, 8),
      });
    });
  });

  return Array.from(balancesByKey.values())
    .filter((balance) => balance.amount !== 0)
    .sort(
      (left, right) =>
        left.accountId.localeCompare(right.accountId) ||
        left.currency.localeCompare(right.currency)
    );
};
