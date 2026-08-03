import { BASE_CURRENCY } from "@/lib/constants";
import { getPortfolioAssetGroupKey, normalizeSymbol } from "@/lib/ticker";
import { resolveTickerIdentity } from "@/lib/ticker-aliases";
import { getTodayDateInputValue, round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
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
) => `${portfolioId}:account:currency:${toCurrencyCode(currency, BASE_CURRENCY)}`;

export const getPortfolioInstrumentId = (
  portfolioId: string,
  target: { kind?: AssetKind; symbol?: string }
) => {
  const kind = target.kind ?? "stock";
  const symbol = resolveTickerIdentity({
    symbol: target.symbol ?? "",
    kind,
  }).symbol;
  const key = getPortfolioAssetGroupKey({ kind, symbol });

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
  currencies: CurrencyCode[] = [BASE_CURRENCY],
  now = new Date().toISOString()
) => {
  const normalizedCurrencies = Array.from(
    new Set([BASE_CURRENCY, ...currencies].map((currency) => toCurrencyCode(currency)))
  );

  return [
    createDefaultAccount({
      portfolioId,
      id: getDefaultInvestmentAccountId(portfolioId),
      name: "Domyslne konto inwestycyjne",
      kind: "investment",
      broker: "OTHER",
      currency: BASE_CURRENCY,
      now,
    }),
    ...normalizedCurrencies.map((currency) =>
      createDefaultAccount({
        portfolioId,
        id:
          currency === BASE_CURRENCY
            ? getDefaultCashAccountId(portfolioId, currency)
            : getDefaultCurrencyAccountId(portfolioId, currency),
        name: currency === BASE_CURRENCY ? "Gotowka PLN" : `Konto walutowe ${currency}`,
        kind: currency === BASE_CURRENCY ? "cash" : "currency",
        broker: currency === BASE_CURRENCY ? "CASH" : "CURRENCY",
        currency,
        now,
      })
    ),
  ];
};

export const normalizePortfolioAccounts = (
  portfolioId: string,
  accounts: unknown,
  currencies: CurrencyCode[] = [],
  now = new Date().toISOString()
) => {
  const normalizedAccounts = (Array.isArray(accounts) ? accounts : [])
    .map((account): PortfolioAccount | null => {
      const rawAccount = asRecord(account);
      const id = getString(rawAccount.id);

      if (!id) {
        return null;
      }

      const kind = normalizeAccountKind(rawAccount.kind, "investment");
      const currency = normalizeCurrency(rawAccount.currency);

      return {
        id,
        portfolioId,
        parentAccountId: getString(rawAccount.parentAccountId) || undefined,
        name: getString(rawAccount.name, kind === "investment" ? "Konto inwestycyjne" : `Gotowka ${currency}`),
        kind,
        broker: normalizeBroker(rawAccount.broker, kind === "investment" ? "OTHER" : "CASH"),
        currency,
        isDefault: getBoolean(rawAccount.isDefault, false),
        metadata: asRecord(rawAccount.metadata),
        createdAt: normalizeIsoDateTime(rawAccount.createdAt, now),
        updatedAt: normalizeIsoDateTime(rawAccount.updatedAt, now),
      } satisfies PortfolioAccount;
    })
    .filter((account): account is PortfolioAccount => Boolean(account));

  const defaultAccounts = createDefaultPortfolioAccounts(portfolioId, currencies, now);
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
        }),
      },
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
});

const buildBuyOperation = (
  portfolioId: string,
  asset: PortfolioState["assets"][number]
) => {
  const priceCurrency = toCurrencyCode(asset.purchasePriceCurrency, asset.purchaseCurrency);
  const exchangeRate =
    typeof asset.purchaseFxRateToPln === "number" && Number.isFinite(asset.purchaseFxRateToPln)
      ? asset.purchaseFxRateToPln
      : priceCurrency === BASE_CURRENCY
        ? 1
        : null;

  return createOperation({
    id: `op-buy-${asset.id}`,
    portfolioId,
    accountId: getDefaultInvestmentAccountId(portfolioId),
    assetId: getPortfolioInstrumentId(portfolioId, asset),
    operationType: "BUY",
    quantity: asset.quantity,
    price: asset.purchasePrice,
    currency: priceCurrency,
    exchangeRate,
    fee: asset.feePln,
    tax: 0,
    amount: round(asset.quantity * asset.purchasePrice, 8),
    date: asset.purchaseDate,
    notes: "",
    metadata: getLegacyOperationMetadata("asset", asset.id, {
      lotId: asset.id,
      feeCurrency: BASE_CURRENCY,
      marketCurrency: asset.marketCurrency,
      settlementCurrency: asset.purchaseCurrency,
      purchasePriceCurrency: priceCurrency,
      provider: asset.provider,
      providerId: asset.providerId,
      groupOrder: asset.groupOrder,
    }),
    createdAt: asset.createdAt,
    updatedAt: asset.createdAt,
  });
};

const buildSellOperation = (portfolioId: string, sale: PortfolioSale) =>
  createOperation({
    id: `op-sell-${sale.id}`,
    portfolioId,
    accountId: getDefaultInvestmentAccountId(portfolioId),
    assetId: getPortfolioInstrumentId(portfolioId, sale),
    operationType: "SELL",
    quantity: sale.quantity,
    price: sale.salePrice,
    currency: sale.marketCurrency,
    exchangeRate: sale.marketCurrency === BASE_CURRENCY ? 1 : null,
    fee: sale.feePln,
    tax: sale.taxTotalPln ?? 0,
    amount: round(sale.quantity * sale.salePrice, 8),
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
    }),
    createdAt: sale.createdAt,
    updatedAt: sale.createdAt,
  });

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

export const buildOperationsFromLegacyState = (
  portfolioId: string,
  state: PortfolioState
) =>
  sortOperations([
    ...state.assets.map((asset) => buildBuyOperation(portfolioId, asset)),
    ...state.sales.map((sale) => buildSellOperation(portfolioId, sale)),
    ...state.realizedAdjustments.map((adjustment) =>
      buildAdjustmentOperation(portfolioId, adjustment)
    ),
  ]);

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
  const accountId = getString(rawOperation.accountId, fallbackAccountId);
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
  const existingCustomOperations = normalizedExisting.filter(
    (operation) => !isLegacyOperation(operation)
  );
  const derivedLegacyOperations = buildOperationsFromLegacyState(portfolioId, state);
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
  const currencies = collectPortfolioCurrencies(portfolio, portfolio.operations);
  const accounts = normalizePortfolioAccounts(portfolio.id, portfolio.accounts, currencies, now);
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

  return {
    ...portfolio,
    schemaVersion: 2,
    baseCurrency: toCurrencyCode(portfolio.baseCurrency, BASE_CURRENCY),
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

const hasExplicitCashImpact = (operation: PortfolioOperation) =>
  operation.metadata.cashImpact === true ||
  operation.metadata.kind === "cash" ||
  operation.metadata.kind === "dividend";

const isMigratedLegacyOperation = (operation: PortfolioOperation) =>
  typeof operation.metadata.legacySource === "string";

export const getOperationCashDeltas = (operation: PortfolioOperation): CashBalance[] => {
  if (operation.operationType === "SPLIT" || operation.operationType === "REVERSE_SPLIT") {
    return [];
  }

  if (isMigratedLegacyOperation(operation) && !hasExplicitCashImpact(operation)) {
    return [];
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
    ? new Set(accounts.map((account) => account.id))
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
