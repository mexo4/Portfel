"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AddAssetForm from "@/components/AddAssetForm";
import AppWorkspaceShell from "@/components/AppWorkspaceShell";
import AssetModeSelector from "@/components/AssetModeSelector";
import BrokerImportPanel from "@/components/BrokerImportPanel";
import ChangePasswordPanel from "@/components/ChangePasswordPanel";
import PortfolioIncomeWorkspace from "@/components/PortfolioIncomeWorkspace";
import RealizedAdjustmentsPanel from "@/components/RealizedAdjustmentsPanel";
import PortfolioSummary from "@/components/PortfolioSummary";
import SalesHistoryPanel from "@/components/SalesHistoryPanel";
import TreasuryBondForm from "@/components/TreasuryBondForm";
import UserProfilePanel from "@/components/UserProfilePanel";
import WealthWorkspace from "@/components/WealthWorkspace";
import { PortfolioWorkspaceProvider, type PortfolioWorkspaceValue } from "@/components/PortfolioWorkspaceContext";
import {
  AUTO_REFRESH_INTERVAL_MS,
  CRYPTO_AUTO_REFRESH_INTERVAL_MS,
  FALLBACK_FX_RATES,
  FREE_PLAN_ASSET_LIMIT,
  SEARCH_DEBOUNCE_MS,
} from "@/lib/constants";
import {
  ApiError,
  applyRefreshedPortfolioAssetSnapshot,
  fetchFxRates,
  fetchQuotePreview,
  fetchTreasuryBondRedemption,
  fetchTreasuryBondSeries,
  fetchTreasuryBondSwap,
  logoutUser,
  refreshPortfolioQuotesWithProgress,
  requestEmailVerification,
  resolveEtfListingPrice,
  savePortfolioQuoteSnapshots,
  savePortfolioState,
  saveUserProfile,
  searchAssets,
  searchEtfInstruments,
} from "@/lib/api";
import {
  applySaleToPortfolio,
  buildAutomaticBondCouponAdjustments,
  canUndoPortfolioSale,
  createInvestmentPortfolio,
  createEmptyRealizedAdjustmentDraft,
  createPortfolioRealizedAdjustment,
  getDuplicatePortfolioName,
  getManualOrderKeys,
  getNextGroupOrder,
  getSortedPortfolioRealizedAdjustments,
  getSortedPortfolioSales,
  normalizePortfolioBook,
  normalizeStoredPortfolioAssets,
  undoPortfolioSale,
} from "@/lib/portfolio-state";
import {
  aggregatePortfolioSummaries,
  convertFromPln,
  getAllPortfolioScopedGroups,
  getGroupedPortfolioAssets,
  getPortfolioSummary,
  hasAssetLivePrice,
} from "@/lib/pricing";
import {
  ensurePortfolioCoreModel,
  getInstrumentTypeForAssetKind,
  getPortfolioInstrumentId,
} from "@/lib/operation-engine";
import {
  buildDividendForecast,
  getPortfolioDividends,
} from "@/lib/dividend-engine";
import {
  getMinimumSearchLength,
  getModeConfig,
  pickBestSearchResult,
} from "@/lib/search";
import {
  createAssetId,
  createEmptyDraft,
  getGpwSymbolKey,
  getPortfolioAssetGroupKey,
  normalizeGpwSymbol,
  normalizeSymbol,
} from "@/lib/ticker";
import { ALL_PORTFOLIOS_ID, getWorkspaceReadHref } from "@/lib/portfolio-selection";
import {
  getTodayDateInputValue,
  formatCurrency,
  normalizeText,
  round,
  toCurrencyCode,
  toDateInputValue,
} from "@/lib/utils";
import {
  createEmptyTreasuryBondDraft,
  getTreasuryBondDisplayName,
  getTreasuryBondMaturityDate,
  normalizeTreasuryBondCode,
} from "@/lib/treasury-bonds";
import type {
  AssetEntryMode,
  AssetDraft,
  AssetQuote,
  AssetSearchMode,
  AssetSearchResult,
  AssetTableSortMode,
  AuthenticatedUser,
  BondRedemptionQuote,
  BondSwapQuote,
  BrokerCode,
  CurrencyCode,
  EtfListing,
  EtfSearchGroup,
  FxRates,
  InvestmentPortfolio,
  InstrumentIdentity,
  PortfolioAsset,
  PortfolioAccount,
  PortfolioBook,
  PortfolioInstrument,
  PortfolioOperation,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  RealizedAdjustmentDraft,
  TreasuryBondDraft,
  TreasuryBondQuote,
  TreasuryBondSeries,
  UserProfile,
  WealthItem,
} from "@/types/portfolio";
import type { ImportedBrokerOperation } from "@/lib/import-operations";

type PortfolioAppProps = {
  account: AuthenticatedUser;
  isAdmin?: boolean;
  initialAssets: PortfolioAsset[];
  initialSales: PortfolioSale[];
  initialRealizedAdjustments: PortfolioRealizedAdjustment[];
  initialPortfolios?: InvestmentPortfolio[];
  initialActivePortfolioId?: string;
  initialPortfolioRevision: number;
  initialProfile: UserProfile;
  children?: ReactNode;
};

type PortfolioWorkspaceState = {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
};

type PendingPortfolioSave = {
  book: PortfolioBook;
  fingerprint: string;
};

const SAVE_DEBOUNCE_MS = 250;
const ASSET_SORT_MODE_STORAGE_KEY = "portfolio.assetTableSortMode";
const getPortfolioSaveFingerprint = (book: PortfolioBook) =>
  JSON.stringify(book, (key, value) => (key === "updatedAt" ? undefined : value));

const getQuoteSnapshotPayload = (
  portfolios: InvestmentPortfolio[],
  refreshedAssetIds?: ReadonlySet<string>
) =>
  portfolios.flatMap((portfolio) =>
    portfolio.assets
      .filter(
        (asset) =>
          (!refreshedAssetIds || refreshedAssetIds.has(asset.id)) &&
          typeof asset.latestPrice === "number" &&
          Number.isFinite(asset.latestPrice) &&
          asset.latestPrice > 0
      )
      .map((asset) => ({
        portfolioId: portfolio.id,
        assetId: asset.id,
        latestPrice: asset.latestPrice!,
        latestPriceDate: asset.latestPriceDate,
        latestPriceMarketTimestamp: asset.latestPriceMarketTimestamp,
        latestPriceFetchedAt: asset.latestPriceFetchedAt,
        previousClose: asset.previousClose,
        lastUpdatedAt: asset.lastUpdatedAt,
        marketCurrency: asset.marketCurrency,
        provider: asset.provider,
        providerId: asset.providerId,
        priceScale: asset.priceScale,
      }))
  );

const createDraftFromMode = (mode: AssetSearchMode): AssetDraft => {
  const config = getModeConfig(mode);
  const baseDraft = createEmptyDraft(config.kind);

  return {
    ...baseDraft,
    kind: config.kind,
    purchaseDate: getTodayDateInputValue(),
    provider: config.provider,
    purchaseCurrency: config.purchaseCurrency,
    marketCurrency: config.marketCurrency,
  };
};

const toErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const formatBondUnitPriceInput = (value: number) => String(round(value, 2));
const isGpwMode = (mode: AssetSearchMode) => mode === "stock-gpw";
const normalizeSymbolForMode = (symbol: string, mode: AssetSearchMode) => {
  if (!isGpwMode(mode)) {
    return normalizeSymbol(symbol);
  }

  return normalizeGpwSymbol(symbol);
};
const getComparableSymbolForMode = (symbol: string, mode: AssetSearchMode) => {
  if (!isGpwMode(mode)) {
    return normalizeSymbol(symbol);
  }

  return getGpwSymbolKey(symbol);
};
const getResolvedResultSymbolForMode = (
  currentSymbol: string,
  resultSymbol: string,
  mode: AssetSearchMode
) => {
  const normalizedResultSymbol = normalizeSymbolForMode(resultSymbol, mode);

  if (!isGpwMode(mode)) {
    return normalizedResultSymbol;
  }

  const normalizedCurrentSymbol = normalizeSymbolForMode(currentSymbol, mode);

  if (
    normalizedCurrentSymbol &&
    getComparableSymbolForMode(normalizedCurrentSymbol, mode) ===
      getComparableSymbolForMode(normalizedResultSymbol, mode)
  ) {
    return normalizedCurrentSymbol;
  }

  return normalizedResultSymbol;
};
const shouldRetryQuoteRequest = (mode: AssetSearchMode) => !isGpwMode(mode);
const doesQuoteProviderRequireProviderId = (kind: AssetDraft["kind"]) => kind === "etf";

/**
 * ETF discovery and quote resolution are deliberately independent. A selected
 * listing may be safe to save even when EODHD has no current quote yet, but a
 * hand-entered bare ticker must not be promoted to an ETF identity.
 */
const hasStableEtfListingIdentity = (
  identity: InstrumentIdentity | undefined,
  marketCurrencyConfirmed: boolean | undefined
) => {
  if (!identity?.ticker || !identity.name || identity.instrumentType !== "ETF") {
    return false;
  }

  if (identity.figi) {
    return true;
  }

  const hasVenue = Boolean(identity.exchangeCode || identity.exchange || identity.mic);
  return hasVenue && Boolean(identity.currency || marketCurrencyConfirmed);
};

const getDraftQuotePreviewRequest = (draft: AssetDraft, mode: AssetSearchMode) => {
  const normalizedSymbol = normalizeSymbolForMode(draft.symbol, mode);
  const trimmedName = draft.name.trim();

  if (!normalizedSymbol || !trimmedName || !draft.provider) {
    return null;
  }

  if (doesQuoteProviderRequireProviderId(draft.kind) && !draft.providerId) {
    return null;
  }

  return {
    symbol: normalizedSymbol,
    kind: draft.kind,
    marketCurrency: draft.marketCurrency,
    provider: draft.provider,
    providerId: draft.providerId,
    priceScale: draft.priceScale,
    requestKey: [
      normalizedSymbol,
      draft.kind,
      draft.marketCurrency,
      draft.provider,
      draft.providerId ?? "",
      draft.priceScale ?? "",
    ].join("|"),
  };
};
const isAssetTableSortMode = (value: string | null): value is AssetTableSortMode =>
  value === "manual" ||
  value === "value-desc" ||
  value === "value-asc" ||
  value === "profit-desc" ||
  value === "loss-asc" ||
  value === "profit-percent-desc" ||
  value === "profit-percent-asc" ||
  value === "daily-gain-desc" ||
  value === "daily-loss-asc";

const getTrackedCurrencies = (
  assets: PortfolioAsset[],
  portfolios: InvestmentPortfolio[],
  draft: AssetDraft,
  realizedAdjustmentDraft: RealizedAdjustmentDraft,
  wealthItems: WealthItem[]
) =>
  Array.from(
    new Set(
      [
        "PLN",
        draft.purchaseCurrency,
        draft.marketCurrency,
        realizedAdjustmentDraft.currency,
        ...assets.flatMap((asset) => [
          asset.purchaseCurrency,
          asset.purchasePriceCurrency,
          asset.marketCurrency,
        ]),
        ...portfolios.flatMap((portfolio) =>
          portfolio.assets.flatMap((asset) => [
            asset.purchaseCurrency,
            asset.purchasePriceCurrency,
            asset.marketCurrency,
          ])
        ),
        ...portfolios.flatMap((portfolio) => [
          portfolio.baseCurrency,
          ...(portfolio.accounts ?? []).map((account) => account.currency),
          ...(portfolio.operations ?? []).flatMap((operation) => [
            operation.currency,
            typeof operation.metadata.targetCurrency === "string"
              ? operation.metadata.targetCurrency
              : undefined,
          ]),
        ]),
        ...portfolios.flatMap((portfolio) =>
          portfolio.realizedAdjustments.map((adjustment) => adjustment.currency)
        ),
        ...wealthItems.map((item) => item.currency),
      ]
        .map((code) => toCurrencyCode(code))
        .filter(Boolean)
    )
  ).sort();

const getFxRateToPlnSnapshot = (
  currency: CurrencyCode,
  rates: FxRates
): number | undefined => {
  const normalizedCurrency = toCurrencyCode(currency, "PLN");

  if (normalizedCurrency === "PLN") {
    return 1;
  }

  const fallbackRates: FxRates = FALLBACK_FX_RATES;
  const rate = rates[normalizedCurrency] ?? fallbackRates[normalizedCurrency];

  return typeof rate === "number" && Number.isFinite(rate) && rate > 0
    ? rate
    : undefined;
};

const fetchHistoricalFxRates = async (
  codes: Array<string | undefined>,
  date: string,
  currentRates: FxRates
) => {
  const normalizedCodes = Array.from(
    new Set(codes.map((code) => toCurrencyCode(code, "PLN")).filter(Boolean))
  );

  try {
    const response = await fetchFxRates(normalizedCodes, date);

    return {
      ...FALLBACK_FX_RATES,
      ...currentRates,
      ...response.rates,
    };
  } catch {
    return {
      ...FALLBACK_FX_RATES,
      ...currentRates,
    };
  }
};

const canUseProFeatures = (account: AuthenticatedUser) =>
  account.subscriptionPlan === "pro" &&
  (account.subscriptionStatus === "active" || account.subscriptionStatus === "trialing");

const getImportedOperationType = (
  operation: ImportedBrokerOperation
): PortfolioOperation["operationType"] =>
  operation.operationType ?? (operation.side === "buy" ? "BUY" : operation.side === "sell" ? "SELL" : "CUSTOM");

const sanitizeImportIdPart = (value: string) =>
  normalizeSymbol(value).replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);

const getStableImportKeyHash = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
};

const getImportedOperationId = (
  portfolioId: string,
  operation: ImportedBrokerOperation
) => {
  const key =
    operation.importKey ||
    operation.brokerOperationId ||
    [
      operation.rawTime,
      operation.rawType,
      operation.accountNumber,
      operation.symbol,
      operation.amount,
      operation.rowNumber,
    ]
      .filter(Boolean)
      .join(":");

  const sourceKey = key || String(operation.rowNumber);
  const readableKey = sanitizeImportIdPart(sourceKey).slice(0, 48) || "row";

  return `${portfolioId}:operation:import:${readableKey}-${getStableImportKeyHash(sourceKey)}`;
};

const normalizeImportedBroker = (broker: string | undefined): BrokerCode => {
  const normalizedBroker = normalizeSymbol(broker ?? "").replace(/[^A-Z0-9]/g, "");

  if (normalizedBroker === "XTB") return "XTB";
  if (normalizedBroker === "IBKR" || normalizedBroker === "INTERACTIVEBROKERS") return "IBKR";
  if (normalizedBroker === "DEGIRO") return "DEGIRO";
  if (normalizedBroker === "TRADING212") return "TRADING212";
  if (normalizedBroker === "REVOLUT") return "REVOLUT";
  if (normalizedBroker === "MBANK") return "MBANK";
  if (normalizedBroker === "BOS" || normalizedBroker === "BOSSA") return "BOS";
  if (normalizedBroker === "SANTANDER") return "SANTANDER";
  if (normalizedBroker === "BINANCE") return "BINANCE";
  if (normalizedBroker === "BYBIT") return "BYBIT";
  if (normalizedBroker === "KRAKEN") return "KRAKEN";

  return "OTHER";
};

const getImportedBrokerLabel = (broker: BrokerCode) =>
  broker === "OTHER" ? "Broker" : broker;

const getImportedAccountId = (
  portfolioId: string,
  broker: BrokerCode,
  accountNumber: string | undefined,
  currency: string | undefined
) => {
  const normalizedCurrency = toCurrencyCode(currency, "PLN");
  const normalizedAccountNumber = accountNumber?.trim() || normalizedCurrency;

  return `${portfolioId}:account:${broker.toLowerCase()}:${sanitizeImportIdPart(normalizedAccountNumber)}:${normalizedCurrency}`;
};

const createImportedAccount = ({
  portfolioId,
  broker,
  accountNumber,
  currency,
  now,
}: {
  portfolioId: string;
  broker: BrokerCode;
  accountNumber?: string;
  currency: string;
  now: string;
}): PortfolioAccount => {
  const normalizedCurrency = toCurrencyCode(currency, "PLN");
  const normalizedAccountNumber = accountNumber?.trim();

  return {
    id: getImportedAccountId(
      portfolioId,
      broker,
      normalizedAccountNumber,
      normalizedCurrency
    ),
    portfolioId,
    name: normalizedAccountNumber
      ? `${getImportedBrokerLabel(broker)} ${normalizedCurrency} ${normalizedAccountNumber}`
      : `${getImportedBrokerLabel(broker)} ${normalizedCurrency}`,
    kind: "cash",
    broker,
    currency: normalizedCurrency,
    isDefault: false,
    metadata: {
      broker,
      accountNumber: normalizedAccountNumber,
      imported: true,
    },
    createdAt: now,
    updatedAt: now,
  };
};

const upsertImportedAccount = (
  accounts: PortfolioAccount[],
  portfolioId: string,
  broker: BrokerCode,
  accountNumber: string | undefined,
  currency: string | undefined,
  now: string
) => {
  const normalizedCurrency = toCurrencyCode(currency, "PLN");
  const id = getImportedAccountId(portfolioId, broker, accountNumber, normalizedCurrency);

  if (accounts.some((account) => account.id === id)) {
    return accounts;
  }

  return [
    ...accounts,
    createImportedAccount({
      portfolioId,
      broker,
      accountNumber,
      currency: normalizedCurrency,
      now,
    }),
  ];
};

const isImportedOperationDuplicate = (
  operation: ImportedBrokerOperation,
  operationId: string,
  existingOperationIds: Set<string>,
  existingImportKeys: Set<string>
) => {
  if (existingOperationIds.has(operationId)) {
    return true;
  }

  return [operation.importKey, ...(operation.legacyImportKeys ?? [])]
    .filter((key): key is string => Boolean(key?.trim()))
    .some((key) => existingImportKeys.has(key));
};

const upsertImportedInstrument = (
  instruments: PortfolioInstrument[],
  portfolioId: string,
  operation: ImportedBrokerOperation,
  now: string
) => {
  const marketCurrency = toCurrencyCode(operation.marketCurrency ?? operation.currency, "PLN");

  if (!operation.symbol) {
    return {
      instruments,
      instrumentId: null,
    };
  }

  const instrumentId = getPortfolioInstrumentId(portfolioId, {
    kind: operation.kind,
    symbol: operation.symbol,
  });

  if (instruments.some((instrument) => instrument.id === instrumentId)) {
    return {
      instruments,
      instrumentId,
    };
  }

  return {
    instruments: [
      ...instruments,
      {
        id: instrumentId,
        portfolioId,
        type: getInstrumentTypeForAssetKind(operation.kind),
        assetKind: operation.kind,
        symbol: operation.symbol,
        name: operation.name || operation.symbol,
        marketCurrency,
        provider: operation.provider,
        providerId: operation.providerId,
        isin: operation.isin,
        priceScale: operation.priceScale,
        metadata: {
          imported: true,
          importSource: operation.broker ?? "broker",
          brokerSymbol: operation.rawSymbol,
        },
        createdAt: now,
        updatedAt: now,
      } satisfies PortfolioInstrument,
    ],
    instrumentId,
  };
};

const getImportedOperationMetadata = (
  operation: ImportedBrokerOperation,
  targetAccountId?: string
) => {
  const operationType = getImportedOperationType(operation);
  const isDividend = operationType === "DIVIDEND";

  return {
    kind: isDividend ? "dividend" : "cash",
    cashImpact: true,
    importSource: operation.broker ?? "broker",
    importKey: operation.importKey,
    brokerOperationId: operation.brokerOperationId,
    brokerOperationType: operation.rawType,
    brokerRawTime: operation.rawTime,
    brokerSymbol: operation.rawSymbol,
    marketCurrency: operation.marketCurrency,
    cashCurrency: operation.cashCurrency,
    cashAmount: operation.cashAmount,
    marketAmount: operation.marketAmount,
    declaredCurrency: operation.declaredCurrency,
    autoFxConversion: operation.autoFxConversion,
    brokerFxSpreadRate: operation.brokerFxSpreadRate,
    accountNumber: operation.accountNumber,
    sourceAccountNumber: operation.sourceAccountNumber,
    targetAccountNumber: operation.targetAccountNumber,
    sourceCurrency: operation.sourceCurrency,
    targetCurrency: operation.targetCurrency,
    targetAmount: operation.targetAmount,
    targetAccountId,
    grossAmount: operation.grossAmount,
    netAmount: operation.netAmount ?? operation.amount,
    dividendPerShare: operation.dividendPerShare,
    withholdingTax: isDividend ? operation.tax ?? 0 : undefined,
    domesticTax: 0,
    exDividendDate: isDividend ? operation.date : undefined,
    recordDate: isDividend ? operation.date : undefined,
    paymentDate: isDividend ? operation.date : undefined,
    country: isDividend ? (operation.cashCurrency === "PLN" ? "PL" : "Nie ustawiono") : undefined,
    legacyImportKeys: operation.legacyImportKeys,
  };
};

const buildImportedPortfolioOperation = ({
  portfolioId,
  accountId,
  targetAccountId,
  instrumentId,
  operation,
  now,
}: {
  portfolioId: string;
  accountId: string;
  targetAccountId?: string;
  instrumentId: string | null;
  operation: ImportedBrokerOperation;
  now: string;
}): PortfolioOperation => {
  const operationType = getImportedOperationType(operation);
  const isTrade = operationType === "BUY" || operationType === "SELL";
  const marketCurrency = toCurrencyCode(operation.marketCurrency ?? operation.currency, "PLN");
  const cashCurrency = toCurrencyCode(
    operation.cashCurrency ?? operation.accountCurrency ?? operation.currency,
    "PLN"
  );
  const marketAmount =
    operation.marketAmount ??
    (operation.quantity > 0 && operation.price > 0 ? operation.quantity * operation.price : 0);
  const cashAmount = operation.cashAmount ?? operation.amount ?? operation.transactionValue ?? 0;
  const hasAutomaticBrokerConversion =
    isTrade &&
    operation.autoFxConversion === true &&
    marketCurrency !== cashCurrency &&
    marketAmount > 0 &&
    cashAmount > 0;
  const operationCurrency = toCurrencyCode(
    hasAutomaticBrokerConversion
      ? marketCurrency
      : isTrade || operationType === "DIVIDEND"
        ? operation.cashCurrency ?? operation.accountCurrency ?? operation.currency
      : operation.currency,
    "PLN"
  );
  const amount =
    operationType === "DIVIDEND"
      ? operation.grossAmount ?? operation.amount ?? 0
      : hasAutomaticBrokerConversion
        ? marketAmount
        : isTrade
          ? cashAmount
      : operation.amount ?? operation.transactionValue ?? 0;
  const createdAt = new Date(
    Date.parse(now) + Math.max(0, operation.rowNumber) * 10
  ).toISOString();

  return {
    id: getImportedOperationId(portfolioId, operation),
    portfolioId,
    accountId,
    assetId: instrumentId,
    operationType,
    quantity: operation.quantity > 0 ? operation.quantity : null,
    price: operation.price > 0 ? operation.price : null,
    currency: operationCurrency,
    exchangeRate:
      typeof operation.exchangeRate === "number" && Number.isFinite(operation.exchangeRate)
        ? operation.exchangeRate
        : null,
    fee: operation.fee ?? 0,
    tax: operation.tax ?? 0,
    amount: round(amount, 6),
    date: toDateInputValue(operation.date),
    notes: operation.rawType
      ? `Import ${getImportedBrokerLabel(normalizeImportedBroker(operation.broker))}: ${operation.rawType}`
      : "Import brokera",
    metadata: {
      ...getImportedOperationMetadata(operation, targetAccountId),
      autoFxTradeNormalized: hasAutomaticBrokerConversion,
    },
    createdAt,
    updatedAt: createdAt,
  };
};

const buildAutomaticBrokerConversionOperation = (
  tradeOperation: PortfolioOperation,
  sourceOperation: ImportedBrokerOperation
): PortfolioOperation | null => {
  if (
    (tradeOperation.operationType !== "BUY" && tradeOperation.operationType !== "SELL") ||
    sourceOperation.autoFxConversion !== true
  ) {
    return null;
  }

  const marketCurrency = toCurrencyCode(
    sourceOperation.marketCurrency ?? sourceOperation.currency,
    "PLN"
  );
  const cashCurrency = toCurrencyCode(
    sourceOperation.cashCurrency ?? sourceOperation.accountCurrency ?? sourceOperation.currency,
    "PLN"
  );
  const marketAmount =
    sourceOperation.marketAmount ??
    (sourceOperation.quantity > 0 && sourceOperation.price > 0
      ? sourceOperation.quantity * sourceOperation.price
      : 0);
  const cashAmount =
    sourceOperation.cashAmount ?? sourceOperation.amount ?? sourceOperation.transactionValue ?? 0;

  if (marketCurrency === cashCurrency || marketAmount <= 0 || cashAmount <= 0) {
    return null;
  }

  const isBuy = tradeOperation.operationType === "BUY";
  const sourceCurrency = isBuy ? cashCurrency : marketCurrency;
  const sourceAmount = isBuy ? cashAmount : marketAmount;
  const targetCurrency = isBuy ? marketCurrency : cashCurrency;
  const targetAmount = isBuy ? marketAmount : cashAmount;
  const createdAt = new Date(
    Date.parse(tradeOperation.createdAt) + (isBuy ? -1 : 1)
  ).toISOString();

  return {
    id: `${tradeOperation.id}:auto-fx`,
    portfolioId: tradeOperation.portfolioId,
    accountId: tradeOperation.accountId,
    assetId: null,
    operationType: "CONVERSION",
    quantity: null,
    price: null,
    currency: sourceCurrency,
    exchangeRate: null,
    fee: 0,
    tax: 0,
    amount: round(sourceAmount, 6),
    date: tradeOperation.date,
    notes: "Automatyczne przewalutowanie brokera",
    metadata: {
      kind: "cash",
      cashImpact: true,
      importSource: sourceOperation.broker ?? "broker",
      autoFxConversion: true,
      autoFxForOperationId: tradeOperation.id,
      brokerFxSpreadRate: sourceOperation.brokerFxSpreadRate,
      targetAccountId: tradeOperation.accountId,
      targetCurrency,
      targetAmount: round(targetAmount, 6),
      accountNumber: sourceOperation.accountNumber,
    },
    createdAt,
    updatedAt: createdAt,
  };
};

const applyBrokerRealizedResult = (
  sale: PortfolioSale,
  operation: ImportedBrokerOperation
): PortfolioSale => {
  if (typeof operation.realizedProfitLoss !== "number" || !Number.isFinite(operation.realizedProfitLoss)) {
    return sale;
  }

  const resultCurrency = toCurrencyCode(operation.accountCurrency ?? operation.currency, sale.realizedValueCurrency ?? "PLN");

  return {
    ...sale,
    realizedInvestedValue:
      typeof operation.purchaseValue === "number" && Number.isFinite(operation.purchaseValue)
        ? round(operation.purchaseValue, 6)
        : sale.realizedInvestedValue,
    realizedProceedsValue:
      typeof operation.saleValue === "number" && Number.isFinite(operation.saleValue)
        ? round(operation.saleValue, 6)
        : sale.realizedProceedsValue,
    realizedProfitLossValue: round(operation.realizedProfitLoss, 6),
    realizedValueCurrency: resultCurrency,
    realizedInvestedPln:
      resultCurrency === "PLN" &&
      typeof operation.purchaseValue === "number" &&
      Number.isFinite(operation.purchaseValue)
        ? round(operation.purchaseValue)
        : sale.realizedInvestedPln,
    realizedProceedsPln:
      resultCurrency === "PLN" &&
      typeof operation.saleValue === "number" &&
      Number.isFinite(operation.saleValue)
        ? round(operation.saleValue)
        : sale.realizedProceedsPln,
    realizedProfitLossPln:
      resultCurrency === "PLN" ? round(operation.realizedProfitLoss) : sale.realizedProfitLossPln,
  };
};

const buildInitialPortfolioBook = ({
  initialAssets,
  initialSales,
  initialRealizedAdjustments,
  initialPortfolios,
  initialActivePortfolioId,
}: Pick<
  PortfolioAppProps,
  | "initialAssets"
  | "initialSales"
  | "initialRealizedAdjustments"
  | "initialPortfolios"
  | "initialActivePortfolioId"
>) =>
  normalizePortfolioBook(
    initialPortfolios && initialPortfolios.length > 0
      ? {
          portfolios: initialPortfolios,
          activePortfolioId: initialActivePortfolioId,
        }
      : {
          assets: initialAssets,
          sales: initialSales,
          realizedAdjustments: initialRealizedAdjustments,
        }
  );

export default function PortfolioApp({
  account,
  isAdmin = false,
  initialAssets,
  initialSales,
  initialRealizedAdjustments,
  initialPortfolios,
  initialActivePortfolioId,
  initialPortfolioRevision,
  initialProfile,
  children,
}: PortfolioAppProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialPortfolioBook = useMemo(
    () =>
      buildInitialPortfolioBook({
        initialAssets,
        initialSales,
        initialRealizedAdjustments,
        initialPortfolios,
        initialActivePortfolioId,
      }),
    [
      initialActivePortfolioId,
      initialAssets,
      initialPortfolios,
      initialRealizedAdjustments,
      initialSales,
    ]
  );
  const initialActivePortfolio =
    initialPortfolioBook.portfolios.find(
      (portfolio) => portfolio.id === initialPortfolioBook.activePortfolioId
    ) ?? initialPortfolioBook.portfolios[0];
  const portfoliosRef = useRef<InvestmentPortfolio[]>(initialPortfolioBook.portfolios);
  const activePortfolioIdRef = useRef(initialPortfolioBook.activePortfolioId);
  const portfolioRevisionRef = useRef(initialPortfolioRevision);
  const lastPersistedPortfolioBookRef = useRef<PortfolioBook>(initialPortfolioBook);
  const lastPersistedPortfolioRevisionRef = useRef(initialPortfolioRevision);
  const fxRatesRef = useRef<FxRates>(FALLBACK_FX_RATES);
  const workspaceRef = useRef<PortfolioWorkspaceState>({
    assets: normalizeStoredPortfolioAssets(initialActivePortfolio.assets),
    sales: getSortedPortfolioSales(initialActivePortfolio.sales),
    realizedAdjustments: getSortedPortfolioRealizedAdjustments(
      initialActivePortfolio.realizedAdjustments
    ),
  });
  const isSwitchingPortfolioRef = useRef(false);
  const portfolioSaveTimerRef = useRef<number | null>(null);
  const pendingPortfolioSaveRef = useRef<PendingPortfolioSave | null>(null);
  const portfolioSavePromiseRef = useRef<Promise<void> | null>(null);
  const inFlightPortfolioSaveFingerprintRef = useRef<string | null>(null);
  // The server-rendered book is already durable. Without this initial
  // fingerprint, the first client mount schedules a needless full PUT of the
  // complete portfolio even when the user has changed nothing.
  const lastSavedPortfolioFingerprintRef = useRef<string | null>(
    getPortfolioSaveFingerprint(initialPortfolioBook)
  );
  const ignoredPortfolioSaveFingerprintRef = useRef<string | null>(null);
  const quoteOnlyPortfolioFingerprintRef = useRef<string | null>(null);
  const initialWorkspaceFingerprintRef = useRef<string | null>(null);
  const hasCommittedInitialWorkspaceRef = useRef(false);
  const hasInitializedPortfolioPersistenceRef = useRef(false);
  const hasSavedProfileRef = useRef(false);
  const quoteRefreshSeqRef = useRef({ all: 0, crypto: 0 });
  const quoteRefreshPendingRef = useRef(0);
  const quoteRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const quoteRequestSeqRef = useRef(0);
  const lastPreviewRequestKeyRef = useRef("");
  const isManualSymbolRef = useRef(false);
  const lastAutoBondPriceRef = useRef(100);
  const [portfolios, setPortfolios] = useState<InvestmentPortfolio[]>(
    () => initialPortfolioBook.portfolios
  );
  const [profile, setProfile] = useState<UserProfile>(() => initialProfile);
  const [activePortfolioId, setActivePortfolioId] = useState(
    initialPortfolioBook.activePortfolioId
  );
  const [assets, setAssets] = useState<PortfolioAsset[]>(() =>
    normalizeStoredPortfolioAssets(initialActivePortfolio.assets)
  );
  const [sales, setSales] = useState<PortfolioSale[]>(() =>
    getSortedPortfolioSales(initialActivePortfolio.sales)
  );
  const [entryMode, setEntryMode] = useState<AssetEntryMode>("stock-global");
  const [searchMode, setSearchMode] = useState<AssetSearchMode>("stock-global");
  const [draft, setDraft] = useState<AssetDraft>(() => createDraftFromMode("stock-global"));
  const [bondDraft, setBondDraft] = useState<TreasuryBondDraft>(() =>
    createEmptyTreasuryBondDraft()
  );
  const [bondSeries, setBondSeries] = useState<TreasuryBondSeries | null>(null);
  const [bondQuote, setBondQuote] = useState<TreasuryBondQuote | null>(null);
  const [bondRedemptionPreview, setBondRedemptionPreview] =
    useState<BondRedemptionQuote | null>(null);
  const [bondSwapPreview, setBondSwapPreview] = useState<BondSwapQuote | null>(null);
  const [results, setResults] = useState<AssetSearchResult[]>([]);
  const [etfResultGroups, setEtfResultGroups] = useState<EtfSearchGroup[]>([]);
  const [lastAddedResult, setLastAddedResult] = useState<AssetSearchResult | null>(null);
  const [filter, setFilter] = useState("");
  const [assetSortMode, setAssetSortMode] = useState<AssetTableSortMode>("manual");
  const [hasLoadedSortMode, setHasLoadedSortMode] = useState(false);
  const [fxRates, setFxRates] = useState<FxRates>(FALLBACK_FX_RATES);
  const [isSearching, setIsSearching] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingPortfolio, setIsSavingPortfolio] = useState(false);
  const [isPortfolioMutationPending, setIsPortfolioMutationPending] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const [isBondLoading, setIsBondLoading] = useState(false);
  const [isBondRedemptionLoading, setIsBondRedemptionLoading] = useState(false);
  const [isBondSwapLoading, setIsBondSwapLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [bondError, setBondError] = useState<string | null>(null);
  const [bondRedemptionError, setBondRedemptionError] = useState<string | null>(null);
  const [bondSwapError, setBondSwapError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [fxError, setFxError] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationPreviewUrl, setVerificationPreviewUrl] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [fxUpdatedAt, setFxUpdatedAt] = useState<string>();
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [realizedAdjustments, setRealizedAdjustments] = useState<PortfolioRealizedAdjustment[]>(
    () => getSortedPortfolioRealizedAdjustments(initialActivePortfolio.realizedAdjustments)
  );
  const [realizedAdjustmentDraft, setRealizedAdjustmentDraft] =
    useState<RealizedAdjustmentDraft>(() => createEmptyRealizedAdjustmentDraft());
  const [realizedAdjustmentError, setRealizedAdjustmentError] = useState<string | null>(null);
  const activePortfolio =
    portfolios.find((portfolio) => portfolio.id === activePortfolioId) ?? portfolios[0];
  // `portfolio=all` is URL state only.  It is deliberately never copied into
  // activePortfolioId or into a saved portfolio book.
  const isAllPortfoliosSelected = searchParams.get("portfolio") === "all";
  const activePortfolioBaseCurrency = toCurrencyCode(activePortfolio?.baseCurrency, "PLN");
  const activeBaseCurrency = isAllPortfoliosSelected
    ? toCurrencyCode(searchParams.get("currency") ?? undefined, activePortfolioBaseCurrency)
    : activePortfolioBaseCurrency;
  const selectedPortfolioId = isAllPortfoliosSelected
    ? ALL_PORTFOLIOS_ID
    : activePortfolioId;
  const replacePortfolioContextQuery = useCallback(
    (nextSelection: "all" | "single", nextCurrency = activeBaseCurrency) => {
      const nextParams = new URLSearchParams(searchParams.toString());

      if (nextSelection === "all") {
        nextParams.set("portfolio", "all");
        nextParams.set("currency", toCurrencyCode(nextCurrency, activePortfolioBaseCurrency));
      } else {
        nextParams.delete("portfolio");
        nextParams.delete("currency");
      }

      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [activeBaseCurrency, activePortfolioBaseCurrency, pathname, router, searchParams]
  );
  const allPortfolioAssets = useMemo(
    () => portfolios.flatMap((portfolio) => portfolio.assets),
    [portfolios]
  );
  const allPortfolioSales = useMemo(
    () => portfolios.flatMap((portfolio) => portfolio.sales),
    [portfolios]
  );
  const allPortfolioRealizedAdjustments = useMemo(
    () => portfolios.flatMap((portfolio) => portfolio.realizedAdjustments),
    [portfolios]
  );
  const displayedAssets = isAllPortfoliosSelected ? allPortfolioAssets : assets;
  const displayedSales = isAllPortfoliosSelected ? allPortfolioSales : sales;
  const displayedRealizedAdjustments = isAllPortfoliosSelected
    ? allPortfolioRealizedAdjustments
    : realizedAdjustments;
  const trackedCurrencies = useMemo(
    () =>
      getTrackedCurrencies(
        assets,
        portfolios,
        draft,
        realizedAdjustmentDraft,
        profile.wealthItems
      ),
    [assets, draft, portfolios, profile.wealthItems, realizedAdjustmentDraft]
  );
  const trackedCurrenciesKey = trackedCurrencies.join("|");
  const trackedCurrenciesForRefresh = useMemo(
    () => (trackedCurrenciesKey ? trackedCurrenciesKey.split("|") : []),
    [trackedCurrenciesKey]
  );
  const draftQuotePreviewRequest = useMemo(
    () => getDraftQuotePreviewRequest(draft, searchMode),
    [draft, searchMode]
  );
  const groupedAssets = useMemo(() => {
    if (!isAllPortfoliosSelected) {
      return getGroupedPortfolioAssets(assets, fxRates, activeBaseCurrency);
    }

    // Deliberately group each portfolio independently. A bare ticker is not a
    // global identity and a shared ticker must stay attributable to its owner.
    return getAllPortfolioScopedGroups(portfolios, fxRates, activeBaseCurrency);
  }, [activeBaseCurrency, assets, fxRates, isAllPortfoliosSelected, portfolios]);
  const effectiveRealizedAdjustments = useMemo(
    () =>
      getSortedPortfolioRealizedAdjustments([
        ...displayedRealizedAdjustments,
        ...buildAutomaticBondCouponAdjustments(displayedAssets, displayedSales),
      ]),
    [displayedAssets, displayedRealizedAdjustments, displayedSales]
  );
  const hasProFeatures = canUseProFeatures(account);
  const getFreePlanAssetLimitError = (
    nextAssetGroups = new Set(assets.map(getPortfolioAssetGroupKey)).size + 1
  ) =>
    !hasProFeatures && nextAssetGroups > FREE_PLAN_ASSET_LIMIT
      ? `Plan Free pozwala miec do ${FREE_PLAN_ASSET_LIMIT} pozycji w jednym portfelu. Przejdz na Pro, aby dodawac kolejne.`
      : null;
  const activePortfolioForEngine = useMemo(
    () =>
      activePortfolio
        ? ensurePortfolioCoreModel({
            ...activePortfolio,
            assets,
            sales,
            realizedAdjustments,
          })
        : null,
    [activePortfolio, assets, realizedAdjustments, sales]
  );
  const activePortfolioDividends = useMemo(
    () => {
      if (isAllPortfoliosSelected) {
        return portfolios.flatMap((portfolio) =>
          getPortfolioDividends(ensurePortfolioCoreModel(portfolio), fxRates)
        );
      }

      return activePortfolioForEngine
        ? getPortfolioDividends(activePortfolioForEngine, fxRates)
        : [];
    },
    [activePortfolioForEngine, fxRates, isAllPortfoliosSelected, portfolios]
  );
  const activeDividendForecast = useMemo(
    () => buildDividendForecast(activePortfolioDividends),
    [activePortfolioDividends]
  );
  const activeDividendYtd = useMemo(() => {
    const year = getTodayDateInputValue().slice(0, 4);

    return convertFromPln(
      activePortfolioDividends
        .filter((dividend) => dividend.paymentDate.slice(0, 4) === year)
        .reduce((total, dividend) => total + dividend.netAmountPln, 0),
      activeBaseCurrency,
      fxRates
    );
  }, [activeBaseCurrency, activePortfolioDividends, fxRates]);
  const activeDividendMonth = useMemo(() => {
    const month = getTodayDateInputValue().slice(0, 7);

    return convertFromPln(
      activePortfolioDividends
        .filter((dividend) => dividend.paymentDate.slice(0, 7) === month)
        .reduce((total, dividend) => total + dividend.netAmountPln, 0),
      activeBaseCurrency,
      fxRates
    );
  }, [activeBaseCurrency, activePortfolioDividends, fxRates]);
  const activeDividendAnnualIncome = useMemo(
    () =>
      convertFromPln(
        activeDividendForecast.annualIncomePln,
        activeBaseCurrency,
        fxRates
      ),
    [activeBaseCurrency, activeDividendForecast.annualIncomePln, fxRates]
  );

  const requireConcretePortfolioSelection = useCallback(() => {
    if (!isAllPortfoliosSelected) {
      return true;
    }

    setSyncError("Wybierz konkretny portfel przed dodaniem lub zmianą danych.");
    return false;
  }, [isAllPortfoliosSelected]);

  const handleActivePortfolioCoreModelChange = useCallback(
    (nextPortfolio: InvestmentPortfolio) => {
      if (!requireConcretePortfolioSelection()) {
        return;
      }
      const now = new Date().toISOString();
      setSyncError(null);
      const nextPortfolios = portfoliosRef.current.map((portfolio) =>
          portfolio.id === activePortfolioIdRef.current
            ? {
                ...portfolio,
                accounts: nextPortfolio.accounts,
                instruments: nextPortfolio.instruments,
                operations: nextPortfolio.operations,
                updatedAt: now,
            }
            : portfolio
      );
      portfoliosRef.current = nextPortfolios;
      setPortfolios(nextPortfolios);
    },
    [requireConcretePortfolioSelection]
  );

  const applyPortfolioBook = useCallback(
    (nextPortfolios: InvestmentPortfolio[], nextActivePortfolioId: string) => {
      portfoliosRef.current = nextPortfolios;
      activePortfolioIdRef.current = nextActivePortfolioId;
      setPortfolios(nextPortfolios);
      setActivePortfolioId(nextActivePortfolioId);
    },
    []
  );

  const replaceWorkspace = useCallback((nextWorkspace: PortfolioWorkspaceState) => {
    const normalizedWorkspace: PortfolioWorkspaceState = {
      assets: normalizeStoredPortfolioAssets(nextWorkspace.assets),
      sales: getSortedPortfolioSales(nextWorkspace.sales),
      realizedAdjustments: getSortedPortfolioRealizedAdjustments(
        nextWorkspace.realizedAdjustments
      ),
    };

    // Persistence and background refreshes read this ref before React commits state.
    workspaceRef.current = normalizedWorkspace;
    setAssets(normalizedWorkspace.assets);
    setSales(normalizedWorkspace.sales);
    setRealizedAdjustments(normalizedWorkspace.realizedAdjustments);

    return normalizedWorkspace;
  }, []);

  const updateWorkspaceAssets = useCallback(
    (updater: (currentAssets: PortfolioAsset[]) => PortfolioAsset[]) =>
      replaceWorkspace({
        ...workspaceRef.current,
        assets: updater(workspaceRef.current.assets),
      }),
    [replaceWorkspace]
  );

  const updateWorkspaceSales = useCallback(
    (updater: (currentSales: PortfolioSale[]) => PortfolioSale[]) =>
      replaceWorkspace({
        ...workspaceRef.current,
        sales: updater(workspaceRef.current.sales),
      }),
    [replaceWorkspace]
  );

  const updateWorkspaceRealizedAdjustments = useCallback(
    (updater: (
      currentAdjustments: PortfolioRealizedAdjustment[]
    ) => PortfolioRealizedAdjustment[]) =>
      replaceWorkspace({
        ...workspaceRef.current,
        realizedAdjustments: updater(workspaceRef.current.realizedAdjustments),
      }),
    [replaceWorkspace]
  );

  const applyPersistedPortfolioBook = useCallback(
    (portfolioBook: PortfolioBook, portfolioRevision: number) => {
      const normalizedBook = normalizePortfolioBook(portfolioBook);
      const nextActivePortfolio =
        normalizedBook.portfolios.find(
          (portfolio) => portfolio.id === normalizedBook.activePortfolioId
        ) ?? normalizedBook.portfolios[0];
      const nextWorkspace = {
        assets: normalizeStoredPortfolioAssets(nextActivePortfolio.assets),
        sales: getSortedPortfolioSales(nextActivePortfolio.sales),
        realizedAdjustments: getSortedPortfolioRealizedAdjustments(
          nextActivePortfolio.realizedAdjustments
        ),
      };

      portfolioRevisionRef.current = portfolioRevision;
      lastPersistedPortfolioBookRef.current = normalizedBook;
      lastPersistedPortfolioRevisionRef.current = portfolioRevision;
      applyPortfolioBook(normalizedBook.portfolios, normalizedBook.activePortfolioId);
      replaceWorkspace(nextWorkspace);
    },
    [applyPortfolioBook, replaceWorkspace]
  );

  const commitActivePortfolioSnapshot = useCallback(
    (portfolioList: InvestmentPortfolio[]) => {
      const now = new Date().toISOString();
      const workspace = workspaceRef.current;
      return portfolioList.map((portfolio) =>
        portfolio.id === activePortfolioIdRef.current
          ? {
              ...portfolio,
              assets: normalizeStoredPortfolioAssets(workspace.assets),
              sales: getSortedPortfolioSales(workspace.sales),
              realizedAdjustments: getSortedPortfolioRealizedAdjustments(
                workspace.realizedAdjustments
              ),
              updatedAt: now,
            }
          : portfolio
      );
    },
    []
  );

  const portfolioSummaries = useMemo(
    () =>
      portfolios.map((portfolio) => {
        const corePortfolio = ensurePortfolioCoreModel(portfolio);
        const portfolioEffectiveAdjustments = getSortedPortfolioRealizedAdjustments([
          ...corePortfolio.realizedAdjustments,
          ...buildAutomaticBondCouponAdjustments(corePortfolio.assets, corePortfolio.sales),
        ]);
        return {
          portfolio,
          summary: getPortfolioSummary(
            corePortfolio.assets,
            corePortfolio.sales,
            portfolioEffectiveAdjustments,
            fxRates,
            toCurrencyCode(corePortfolio.baseCurrency, "PLN")
          ),
        };
      }),
    [fxRates, portfolios]
  );

  const flushPortfolioSave = useCallback(async () => {
    if (portfolioSavePromiseRef.current) {
      return portfolioSavePromiseRef.current;
    }

    const savePromise = (async () => {
      setIsSavingPortfolio(true);

      try {
        while (pendingPortfolioSaveRef.current) {
          const nextSave = pendingPortfolioSaveRef.current;
          pendingPortfolioSaveRef.current = null;
          inFlightPortfolioSaveFingerprintRef.current = nextSave.fingerprint;

          try {
            const savedPortfolio = await savePortfolioState({
              portfolios: nextSave.book.portfolios,
              activePortfolioId: nextSave.book.activePortfolioId,
              portfolioRevision: portfolioRevisionRef.current,
            });
            const savedBook: PortfolioBook = {
              schemaVersion: 2,
              portfolios: savedPortfolio.portfolios,
              activePortfolioId: savedPortfolio.activePortfolioId,
            };
            portfolioRevisionRef.current = savedPortfolio.portfolioRevision;
            lastPersistedPortfolioBookRef.current = normalizePortfolioBook(savedBook);
            lastPersistedPortfolioRevisionRef.current = savedPortfolio.portfolioRevision;
            lastSavedPortfolioFingerprintRef.current = nextSave.fingerprint;
          } catch (error) {
            let restoredFromConflict = false;

            if (error instanceof ApiError && error.status === 409) {
              const payload = error.payload;

              if (
                payload &&
                typeof payload === "object" &&
                Array.isArray((payload as { portfolios?: unknown }).portfolios) &&
                typeof (payload as { activePortfolioId?: unknown }).activePortfolioId === "string" &&
                typeof (payload as { portfolioRevision?: unknown }).portfolioRevision === "number"
              ) {
                const conflictPayload = payload as {
                  portfolios: InvestmentPortfolio[];
                  activePortfolioId: string;
                  portfolioRevision: number;
                };
                const serverBook: PortfolioBook = {
                  schemaVersion: 2,
                  portfolios: conflictPayload.portfolios,
                  activePortfolioId: conflictPayload.activePortfolioId,
                };

                pendingPortfolioSaveRef.current = null;
                ignoredPortfolioSaveFingerprintRef.current = getPortfolioSaveFingerprint(serverBook);
                lastSavedPortfolioFingerprintRef.current =
                  ignoredPortfolioSaveFingerprintRef.current;
                applyPersistedPortfolioBook(serverBook, conflictPayload.portfolioRevision);
                restoredFromConflict = true;
              }
            }

            if (!restoredFromConflict && !pendingPortfolioSaveRef.current) {
              pendingPortfolioSaveRef.current = nextSave;
            }
            throw error;
          } finally {
            inFlightPortfolioSaveFingerprintRef.current = null;
          }
        }

        setSyncError(null);
      } catch (error) {
        setSyncError(toErrorMessage(error, "Nie udalo sie zapisac portfela."));
        throw error;
      } finally {
        setIsSavingPortfolio(false);
        portfolioSavePromiseRef.current = null;
      }
    })();

    portfolioSavePromiseRef.current = savePromise;
    return savePromise;
  }, [applyPersistedPortfolioBook]);

  const queuePortfolioSave = useCallback(
    (nextBook: PortfolioBook, immediate = false) => {
      const fingerprint = getPortfolioSaveFingerprint(nextBook);
      const ignoredFingerprint = ignoredPortfolioSaveFingerprintRef.current;

      if (ignoredFingerprint === fingerprint) {
        return Promise.resolve();
      }

      if (ignoredFingerprint) {
        ignoredPortfolioSaveFingerprintRef.current = null;
      }

      const pendingSave = pendingPortfolioSaveRef.current;
      const isSamePendingSave = pendingSave?.fingerprint === fingerprint;
      const isSameInFlightSave =
        inFlightPortfolioSaveFingerprintRef.current === fingerprint;
      const canReuseLastSavedState =
        lastSavedPortfolioFingerprintRef.current === fingerprint &&
        !pendingSave &&
        !portfolioSavePromiseRef.current;

      if (portfolioSaveTimerRef.current !== null) {
        window.clearTimeout(portfolioSaveTimerRef.current);
        portfolioSaveTimerRef.current = null;
      }

      if (canReuseLastSavedState || isSameInFlightSave) {
        return immediate ? portfolioSavePromiseRef.current ?? Promise.resolve() : Promise.resolve();
      }

      if (!isSamePendingSave) {
        pendingPortfolioSaveRef.current = {
          book: nextBook,
          fingerprint,
        };
      }

      if (immediate) {
        return flushPortfolioSave();
      }

      portfolioSaveTimerRef.current = window.setTimeout(() => {
        portfolioSaveTimerRef.current = null;
        void flushPortfolioSave().catch(() => undefined);
      }, SAVE_DEBOUNCE_MS);

      return Promise.resolve();
    },
    [flushPortfolioSave]
  );

  const restoreLastPersistedPortfolioBook = useCallback(() => {
    applyPersistedPortfolioBook(
      lastPersistedPortfolioBookRef.current,
      lastPersistedPortfolioRevisionRef.current
    );
  }, [applyPersistedPortfolioBook]);

  const handleBaseCurrencyChange = async (value: string) => {
    if (isPortfolioMutationPending) {
      return;
    }

    const nextBaseCurrency = toCurrencyCode(value, activeBaseCurrency);

    if (nextBaseCurrency === activeBaseCurrency) {
      return;
    }

    // Aggregate currency is a temporary display preference in the URL. It
    // must not rewrite any concrete portfolio's persisted base currency.
    if (isAllPortfoliosSelected) {
      replacePortfolioContextQuery("all", nextBaseCurrency);
      return;
    }

    if (!requireConcretePortfolioSelection() || !activePortfolio) {
      return;
    }

    const now = new Date().toISOString();
    const workspace = workspaceRef.current;
    const nextPortfolios = portfoliosRef.current.map((portfolio) =>
      portfolio.id === activePortfolioIdRef.current
        ? {
            ...portfolio,
            baseCurrency: nextBaseCurrency,
            assets: normalizeStoredPortfolioAssets(workspace.assets),
            sales: getSortedPortfolioSales(workspace.sales),
            realizedAdjustments: getSortedPortfolioRealizedAdjustments(
              workspace.realizedAdjustments
            ),
            updatedAt: now,
          }
        : portfolio
    );

    setIsPortfolioMutationPending(true);
    applyPortfolioBook(nextPortfolios, activePortfolioIdRef.current);

    try {
      await queuePortfolioSave(
        {
          schemaVersion: 2,
          portfolios: nextPortfolios,
          activePortfolioId: activePortfolioIdRef.current,
        },
        true
      );
    } catch {
      restoreLastPersistedPortfolioBook();
    } finally {
      setIsPortfolioMutationPending(false);
    }
  };

  useEffect(() => {
    if (isSwitchingPortfolioRef.current) {
      return;
    }

    const commit = (currentPortfolios: InvestmentPortfolio[]) =>
      commitActivePortfolioSnapshot(currentPortfolios);

    if (!hasCommittedInitialWorkspaceRef.current) {
      hasCommittedInitialWorkspaceRef.current = true;
      initialWorkspaceFingerprintRef.current = getPortfolioSaveFingerprint({
        schemaVersion: 2,
        portfolios: commit(portfoliosRef.current),
        activePortfolioId: activePortfolioIdRef.current,
      });
    }

    setPortfolios((currentPortfolios) => commit(currentPortfolios));
  }, [assets, commitActivePortfolioSnapshot, realizedAdjustments, sales]);

  useEffect(() => {
    portfoliosRef.current = portfolios;
  }, [portfolios]);

  useEffect(() => {
    activePortfolioIdRef.current = activePortfolioId;
  }, [activePortfolioId]);

  useEffect(() => {
    workspaceRef.current = {
      assets,
      sales,
      realizedAdjustments,
    };
  }, [assets, realizedAdjustments, sales]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedSortMode = window.localStorage.getItem(ASSET_SORT_MODE_STORAGE_KEY);

    if (isAssetTableSortMode(storedSortMode)) {
      setAssetSortMode(storedSortMode);
    }

    setHasLoadedSortMode(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !hasLoadedSortMode) {
      return;
    }

    window.localStorage.setItem(ASSET_SORT_MODE_STORAGE_KEY, assetSortMode);
  }, [assetSortMode, hasLoadedSortMode]);

  useEffect(() => {
    const normalizedCode = normalizeTreasuryBondCode(bondDraft.code);

    setBondRedemptionPreview(null);
    setBondRedemptionError(null);

    if (!normalizedCode) {
      setBondSeries(null);
      setBondQuote(null);
      setBondError(null);
      setIsBondLoading(false);
      return;
    }

    if (normalizedCode.length < 7) {
      setBondSeries(null);
      setBondQuote(null);
      setBondError(null);
      setIsBondLoading(false);
      return;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsBondLoading(true);
      setBondError(null);

      try {
        const response = await fetchTreasuryBondSeries({
          code: normalizedCode,
          purchaseDate: bondDraft.purchaseDate,
        });

        if (isCancelled) {
          return;
        }

        setBondSeries(response.series);
        setBondQuote(response.quote);
        setBondError(null);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setBondSeries(null);
        setBondQuote(null);
        setBondError(toErrorMessage(error, "Nie udalo sie pobrac danych obligacji."));
      } finally {
        if (!isCancelled) {
          setIsBondLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [bondDraft.code, bondDraft.purchaseDate]);

  useEffect(() => {
    const nextPurchasePrice = round(bondSeries?.salePrice ?? 100, 2);
    const nextPurchasePriceInput = formatBondUnitPriceInput(nextPurchasePrice);

    setBondDraft((currentDraft) => {
      const shouldAutofillPrice =
        !currentDraft.purchasePriceInput.trim() ||
        currentDraft.purchasePrice <= 0 ||
        currentDraft.purchasePrice === lastAutoBondPriceRef.current;

      if (!shouldAutofillPrice) {
        return currentDraft;
      }

      if (
        currentDraft.purchasePrice === nextPurchasePrice &&
        currentDraft.purchasePriceInput === nextPurchasePriceInput
      ) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        purchasePrice: nextPurchasePrice,
        purchasePriceInput: nextPurchasePriceInput,
      };
    });
    lastAutoBondPriceRef.current = nextPurchasePrice;
  }, [bondSeries?.code, bondSeries?.salePrice]);

  useEffect(() => {
    const trimmedQuery = draft.query.trim();
    const minimumSearchLength = getMinimumSearchLength(searchMode);

    if (trimmedQuery.length < minimumSearchLength) {
      setResults([]);
      setEtfResultGroups([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);

      try {
        if (searchMode === "etf") {
          const groups = await searchEtfInstruments({
            query: trimmedQuery,
            signal: controller.signal,
          });

          if (!isCancelled) {
            setEtfResultGroups(groups);
            setResults([]);
          }
          return;
        }

        const nextResults = await searchAssets({
          query: trimmedQuery,
          kind: draft.kind,
          mode: searchMode,
          signal: controller.signal,
        });

        if (!isCancelled) {
          setResults(nextResults);
          setEtfResultGroups([]);

          if (!isManualSymbolRef.current) {
            const autoResult = pickBestSearchResult(trimmedQuery, nextResults, {
              allowFirstItemFallback: true,
              mode: searchMode,
            });

            if (autoResult) {
              setDraft((currentDraft) => {
                if (normalizeText(currentDraft.query) !== normalizeText(trimmedQuery)) {
                  return currentDraft;
                }

                const normalizedCurrentSymbol = normalizeSymbolForMode(
                  currentDraft.symbol,
                  searchMode
                );
                const normalizedAutoSymbol = normalizeSymbolForMode(
                  autoResult.symbol,
                  searchMode
                );
                const hasSameAutoValues =
                  getComparableSymbolForMode(normalizedCurrentSymbol, searchMode) ===
                    getComparableSymbolForMode(normalizedAutoSymbol, searchMode) &&
                  currentDraft.provider === autoResult.provider &&
                  currentDraft.providerId === autoResult.providerId &&
                  currentDraft.marketCurrency === autoResult.marketCurrency &&
                  currentDraft.priceScale === autoResult.priceScale;

                if (hasSameAutoValues) {
                  return currentDraft;
                }

                return {
                  ...currentDraft,
                  name: autoResult.name,
                  symbol: getResolvedResultSymbolForMode(
                    currentDraft.symbol,
                    autoResult.symbol,
                    searchMode
                  ),
                  marketCurrency: autoResult.marketCurrency,
                  provider: autoResult.provider,
                  providerId: autoResult.providerId,
                  priceScale: autoResult.priceScale,
                  latestPrice: undefined,
                  latestPriceDate: undefined,
                  previousClose: undefined,
                };
              });
            }
          }
        }
      } catch (error) {
        if (isCancelled) return;

        setSearchError(toErrorMessage(error, "Nie udalo sie pobrac wynikow."));
        setResults([]);
        setEtfResultGroups([]);
      } finally {
        if (!isCancelled) {
          setIsSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [draft.kind, draft.query, searchMode]);

  useEffect(() => {
    const trimmedSymbol = draft.symbol.trim();
    const minimumSearchLength = getMinimumSearchLength(searchMode);

    if (!isManualSymbolRef.current || trimmedSymbol.length < minimumSearchLength) {
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);

      try {
        if (searchMode === "etf") {
          const groups = await searchEtfInstruments({
            query: trimmedSymbol,
            signal: controller.signal,
          });

          if (!isCancelled) {
            setEtfResultGroups(groups);
            setResults([]);
          }
          return;
        }

        const nextResults = await searchAssets({
          query: trimmedSymbol,
          kind: draft.kind,
          mode: searchMode,
          signal: controller.signal,
        });

        if (isCancelled) {
          return;
        }

        const autoResult = pickBestSearchResult(trimmedSymbol, nextResults, {
          mode: searchMode,
          preferSymbol: true,
        });

        setDraft((currentDraft) => {
          if (
            !isManualSymbolRef.current ||
            getComparableSymbolForMode(currentDraft.symbol, searchMode) !==
              getComparableSymbolForMode(trimmedSymbol, searchMode)
          ) {
            return currentDraft;
          }

          if (!autoResult) {
            return {
              ...currentDraft,
              query: "",
              name: "",
              providerId: undefined,
              priceScale: undefined,
              latestPrice: undefined,
              latestPriceDate: undefined,
              previousClose: undefined,
            };
          }

          const hasSameResolvedValues =
            getComparableSymbolForMode(currentDraft.symbol, searchMode) ===
              getComparableSymbolForMode(autoResult.symbol, searchMode) &&
            normalizeText(currentDraft.query) === normalizeText(autoResult.name) &&
            normalizeText(currentDraft.name) === normalizeText(autoResult.name) &&
            currentDraft.provider === autoResult.provider &&
            currentDraft.providerId === autoResult.providerId &&
            currentDraft.marketCurrency === autoResult.marketCurrency &&
            currentDraft.priceScale === autoResult.priceScale;

          if (hasSameResolvedValues) {
            return currentDraft;
          }

          return {
            ...currentDraft,
            symbol: getResolvedResultSymbolForMode(
              currentDraft.symbol,
              autoResult.symbol,
              searchMode
            ),
            query: autoResult.name,
            name: autoResult.name,
            marketCurrency: autoResult.marketCurrency,
            provider: autoResult.provider,
            providerId: autoResult.providerId,
            priceScale: autoResult.priceScale,
            latestPrice: undefined,
            latestPriceDate: undefined,
            previousClose: undefined,
          };
        });
      } catch (error) {
        if (!isCancelled) {
          setSearchError(toErrorMessage(error, "Nie udalo sie pobrac wynikow."));
          setEtfResultGroups([]);
        }
      } finally {
        if (!isCancelled) {
          setIsSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [draft.kind, draft.symbol, searchMode]);

  useEffect(() => {
    if (!hasInitializedPortfolioPersistenceRef.current) {
      hasInitializedPortfolioPersistenceRef.current = true;
      return;
    }

    if (isPortfolioMutationPending) {
      return;
    }

    const currentBook: PortfolioBook = {
      schemaVersion: 2,
      portfolios,
      activePortfolioId,
    };
    const fingerprint = getPortfolioSaveFingerprint(currentBook);

    // A background quote refresh persists only compact derived snapshots. Do
    // not turn it back into a complete portfolio_json/core-table rewrite.
    if (quoteOnlyPortfolioFingerprintRef.current === fingerprint) {
      return;
    }

    if (initialWorkspaceFingerprintRef.current === fingerprint) {
      initialWorkspaceFingerprintRef.current = null;
      lastSavedPortfolioFingerprintRef.current = fingerprint;
      return;
    }

    quoteOnlyPortfolioFingerprintRef.current = null;
    void queuePortfolioSave(currentBook, false);
  }, [activePortfolioId, isPortfolioMutationPending, portfolios, queuePortfolioSave]);

  useEffect(
    () => () => {
      if (portfolioSaveTimerRef.current !== null) {
        window.clearTimeout(portfolioSaveTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!hasSavedProfileRef.current) {
      hasSavedProfileRef.current = true;
      return;
    }

    let isCancelled = false;

    const timeoutId = window.setTimeout(async () => {
      try {
        await saveUserProfile(profile);

        if (!isCancelled) {
          setSyncError(null);
        }
      } catch (error) {
        if (!isCancelled) {
          setSyncError(toErrorMessage(error, "Nie udalo sie zapisac profilu."));
        }
      }
    }, SAVE_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [profile]);

  const syncFxRates = useCallback(async (codes: string[]) => {
    let nextRates: FxRates;

    try {
      const response = await fetchFxRates(codes);
      nextRates = {
        ...FALLBACK_FX_RATES,
        ...fxRatesRef.current,
        ...response.rates,
      };
      fxRatesRef.current = nextRates;
      setFxRates(nextRates);
      setFxUpdatedAt(response.fetchedAt);
    } catch {
      nextRates = {
        ...FALLBACK_FX_RATES,
        ...fxRatesRef.current,
      };
      fxRatesRef.current = nextRates;
      setFxRates(nextRates);
    }

    const missingCurrencies = Array.from(
      new Set(codes.map((code) => toCurrencyCode(code, "PLN")))
    ).filter((currency) => !getFxRateToPlnSnapshot(currency, nextRates));

    setFxError(
      missingCurrencies.length > 0
        ? `Brakuje kursu FX dla: ${missingCurrencies.join(", ")}. Wycena tych pozycji jest wstrzymana.`
        : null
    );

    return nextRates;
  }, []);

  const syncQuotes = useCallback(async (
    scope: "all" | "crypto" = "all",
    options: { excludeCrypto?: boolean; background?: boolean } = {}
  ) => {
    // Timers must not start a second refresh while provider calls from the
    // previous cycle are still pending. A manual refresh waits for it, then
    // performs its own complete pass; a scheduled refresh simply skips this
    // tick and keeps the existing last-known-good prices visible.
    const inFlightRefresh = quoteRefreshInFlightRef.current;
    if (inFlightRefresh) {
      if (options.background) {
        return;
      }

      await inFlightRefresh;
    }

    const refresh = (async () => {
      const now = new Date().toISOString();
      const activeWorkspace = workspaceRef.current;
      const activePortfolioId = activePortfolioIdRef.current;
      const currentPortfolios = portfoliosRef.current.map((portfolio) =>
        portfolio.id === activePortfolioId
          ? {
              ...portfolio,
              assets: activeWorkspace.assets,
              sales: activeWorkspace.sales,
              realizedAdjustments: activeWorkspace.realizedAdjustments,
            }
          : portfolio
      );
      // The background task updates only the currently visible portfolio.
      // Other portfolios keep their persisted last-known-good snapshots until
      // the user opens them. The virtual all-portfolios read model is the one
      // intentional exception, because it displays every position together.
      const visiblePortfolios = isAllPortfoliosSelected
        ? currentPortfolios
        : currentPortfolios.filter((portfolio) => portfolio.id === activePortfolioId);
      const visibleAssets = visiblePortfolios.flatMap((portfolio) => portfolio.assets);
      const assetsToRefresh =
        scope === "crypto"
          ? visibleAssets.filter((asset) => asset.kind === "crypto")
          : options.excludeCrypto
            ? visibleAssets.filter((asset) => asset.kind !== "crypto")
            : visibleAssets;

      if (assetsToRefresh.length === 0) return;

      const refreshSeq = ++quoteRefreshSeqRef.current[scope];
      quoteRefreshPendingRef.current += 1;
      setIsRefreshing(true);

      try {
        const quoteRefresh = await refreshPortfolioQuotesWithProgress(assetsToRefresh);
        const refreshedAssets = quoteRefresh.assets;

        if (refreshSeq !== quoteRefreshSeqRef.current[scope]) {
          return;
        }

        const refreshedById = new Map(refreshedAssets.map((asset) => [asset.id, asset]));
        const changedAssetIds = new Set<string>();
        const applyRefreshedAssets = (portfolioAssets: PortfolioAsset[]) => {
          let hasChanges = false;
          const nextAssets = portfolioAssets.map((asset) => {
            const refreshed = refreshedById.get(asset.id);
            if (!refreshed) return asset;

            const nextAsset = applyRefreshedPortfolioAssetSnapshot(asset, refreshed);
            if (nextAsset !== asset) {
              hasChanges = true;
              changedAssetIds.add(asset.id);
            }

            return nextAsset;
          });

          return hasChanges ? nextAssets : portfolioAssets;
        };

        const latestWorkspace = workspaceRef.current;
        const latestActivePortfolioId = activePortfolioIdRef.current;
        const latestPortfolios = portfoliosRef.current.map((portfolio) =>
          portfolio.id === latestActivePortfolioId
            ? {
                ...portfolio,
                assets: latestWorkspace.assets,
                sales: latestWorkspace.sales,
                realizedAdjustments: latestWorkspace.realizedAdjustments,
              }
            : portfolio
        );
        let hasQuoteChanges = false;
        const nextPortfolios = latestPortfolios.map((portfolio) => {
          const nextAssets = applyRefreshedAssets(portfolio.assets);
          if (nextAssets === portfolio.assets) {
            return portfolio;
          }

          hasQuoteChanges = true;
          return {
            ...portfolio,
            assets: nextAssets,
            updatedAt: now,
          };
        });

        if (hasQuoteChanges) {
          const refreshedActiveAssets =
            nextPortfolios.find((portfolio) => portfolio.id === latestActivePortfolioId)
              ?.assets ?? latestWorkspace.assets;
          const refreshedBook: PortfolioBook = {
            schemaVersion: 2,
            portfolios: nextPortfolios,
            activePortfolioId: latestActivePortfolioId,
          };
          portfoliosRef.current = nextPortfolios;
          replaceWorkspace({
            ...latestWorkspace,
            assets: refreshedActiveAssets,
          });
          setPortfolios(nextPortfolios);
          quoteOnlyPortfolioFingerprintRef.current = getPortfolioSaveFingerprint(refreshedBook);
          // Persist only market snapshots whose market quote actually changed.
          // This avoids a database write and a full React tree update for a
          // provider response that repeats the last valid quote.
          void savePortfolioQuoteSnapshots(
            getQuoteSnapshotPayload(nextPortfolios, changedAssetIds)
          ).catch(() => undefined);
        }

        if (refreshSeq === quoteRefreshSeqRef.current[scope]) {
          setLastSyncAt(new Date().toISOString());
          setSyncError(
            quoteRefresh.missing > 0
              ? `Nie udalo sie odswiezyc kursu dla ${quoteRefresh.missing} pozycji. Pokazujemy ostatni poprawny kurs.`
              : null
          );
        }
      } catch (error) {
        if (refreshSeq === quoteRefreshSeqRef.current[scope]) {
          setSyncError(toErrorMessage(error, "Nie udalo sie odswiezyc cen aktywow."));
        }
      } finally {
        quoteRefreshPendingRef.current = Math.max(0, quoteRefreshPendingRef.current - 1);
        if (quoteRefreshPendingRef.current === 0) {
          setIsRefreshing(false);
        }
      }
    })();

    quoteRefreshInFlightRef.current = refresh;
    try {
      await refresh;
    } finally {
      if (quoteRefreshInFlightRef.current === refresh) {
        quoteRefreshInFlightRef.current = null;
      }
    }
  }, [isAllPortfoliosSelected, replaceWorkspace]);

  const handleRefreshPortfolioData = async () => {
    setIsRefreshing(true);

    try {
      await syncFxRates(trackedCurrencies);
      await syncQuotes();
      setLastSyncAt(new Date().toISOString());
      setRefreshRevision((currentRevision) => currentRevision + 1);
      setSyncError(null);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void syncFxRates(trackedCurrenciesForRefresh);
  }, [syncFxRates, trackedCurrenciesForRefresh]);

  useEffect(() => {
    fxRatesRef.current = fxRates;
  }, [fxRates]);

  useEffect(() => {
    if (assets.length === 0) return;

    // Crypto has its own, shorter refresh cadence below. Keeping scheduled
    // refreshes disjoint avoids fetching and persisting the same crypto quote
    // twice every 30 seconds while preserving a full manual refresh.
    void syncQuotes("all", { excludeCrypto: true, background: true });

    const intervalId = window.setInterval(() => {
      void syncQuotes("all", { excludeCrypto: true, background: true });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [activePortfolioId, assets.length, syncQuotes]);

  const hasCryptoAssets = useMemo(
    () =>
      (isAllPortfoliosSelected
        ? portfolios
        : portfolios.filter((portfolio) => portfolio.id === activePortfolioId)
      ).some((portfolio) => portfolio.assets.some((asset) => asset.kind === "crypto")),
    [activePortfolioId, isAllPortfoliosSelected, portfolios]
  );

  useEffect(() => {
    if (!hasCryptoAssets) return;

    const intervalId = window.setInterval(() => {
      void syncQuotes("crypto", { background: true });
    }, CRYPTO_AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [hasCryptoAssets, syncQuotes]);

  const applyQuoteToDraftIfCurrent = (
    targetSymbol: string,
    quote: AssetQuote | null,
    defaultMessage: string
  ) => {
    if (!quote) {
      setQuoteError(defaultMessage);
      return;
    }

    setDraft((currentDraft) => {
      if (
        getComparableSymbolForMode(currentDraft.symbol, searchMode) !==
        getComparableSymbolForMode(targetSymbol, searchMode)
      ) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        latestPrice: quote.price,
        latestPriceDate: quote.priceDate,
        latestPriceMarketTimestamp: quote.marketTimestamp,
        latestPriceFetchedAt: quote.fetchedAt,
        previousClose: quote.previousClose ?? currentDraft.previousClose,
        marketCurrency: quote.marketCurrency,
        provider: quote.provider,
        providerId: quote.providerId ?? currentDraft.providerId,
        priceScale: quote.priceScale ?? currentDraft.priceScale,
      };
    });
    setQuoteError(null);
  };

  const handleSearchModeChange = (mode: AssetSearchMode) => {
    quoteRequestSeqRef.current += 1;
    lastPreviewRequestKeyRef.current = "";
    isManualSymbolRef.current = false;
    setIsSearching(false);
    setIsQuoteLoading(false);
    setQuoteError(null);
    setSearchMode(mode);
    setDraft(createDraftFromMode(mode));
    setLastAddedResult(null);
    setResults([]);
    setEtfResultGroups([]);
    setSearchError(null);
  };

  const resetBondInteractionState = () => {
    setBondRedemptionPreview(null);
    setBondSwapPreview(null);
    setBondRedemptionError(null);
    setBondSwapError(null);
  };

  const clearBondDraftSelection = () => {
    setBondDraft(createEmptyTreasuryBondDraft());
    setBondSeries(null);
    setBondQuote(null);
  };

  const handleEntryModeChange = (mode: AssetEntryMode) => {
    resetBondInteractionState();
    setEntryMode(mode);

    if (mode === "bond") {
      setBondError(null);
      return;
    }

    handleSearchModeChange(mode);
  };

  const getBondGroup = (code: string) => {
    const normalizedCode = normalizeTreasuryBondCode(code);
    const groupKey = getPortfolioAssetGroupKey({
      kind: "bond",
      symbol: normalizedCode,
    });

    return groupedAssets.find((group) => group.key === groupKey);
  };

  const buildBondRedemptionPreview = async ({
    code,
    quantity,
    requestDate,
  }: {
    code: string;
    quantity: number;
    requestDate: string;
  }) => {
    const targetGroup = getBondGroup(code);

    if (!targetGroup) {
      throw new Error("Nie masz otwartej pozycji dla tej obligacji.");
    }

    if (quantity <= 0) {
      throw new Error("Podaj ilosc obligacji do wykupu.");
    }

    if (quantity > targetGroup.quantity) {
      throw new Error("Nie mozna wykupic wiecej obligacji niz posiadasz.");
    }

    const sortedLots = [...targetGroup.lots].sort(
      (left, right) =>
        new Date(left.purchaseDate || left.createdAt).getTime() -
          new Date(right.purchaseDate || right.createdAt).getTime() ||
        left.createdAt.localeCompare(right.createdAt)
    );
    const lotRequests: Array<{
      lot: PortfolioAsset;
      quantity: number;
    }> = [];
    let remainingQuantity = quantity;

    for (const lot of sortedLots) {
      if (remainingQuantity <= 0) {
        break;
      }

      const allocatedQuantity = Math.min(remainingQuantity, lot.quantity);

      if (allocatedQuantity <= 0) {
        continue;
      }

      lotRequests.push({
        lot,
        quantity: allocatedQuantity,
      });
      remainingQuantity = Math.max(0, round(remainingQuantity - allocatedQuantity, 6));
    }

    if (remainingQuantity > 0) {
      throw new Error("Brakuje wystarczajacej ilosci do wykupu.");
    }

    const redemptions = await Promise.all(
      lotRequests.map(async (request) => {
        const response = await fetchTreasuryBondRedemption({
          code: request.lot.symbol,
          purchaseDate: request.lot.purchaseDate,
          requestDate,
          quantity: request.quantity,
        });

        return response.redemption;
      })
    );

    const grossValueTotal = round(
      redemptions.reduce((total, item) => total + item.grossValueTotal, 0)
    );
    const grossInterestTotal = round(
      redemptions.reduce((total, item) => total + item.grossInterestTotal, 0)
    );
    const feeTotal = round(redemptions.reduce((total, item) => total + item.feeTotal, 0));
    const taxableInterestTotal = round(
      redemptions.reduce((total, item) => total + item.taxableInterestTotal, 0)
    );
    const taxTotal = round(redemptions.reduce((total, item) => total + item.taxTotal, 0));
    const netValueTotal = round(
      redemptions.reduce((total, item) => total + item.netValueTotal, 0)
    );
    const settlementDate = [...redemptions]
      .map((item) => item.settlementDate)
      .sort()
      .at(-1) ?? requestDate;
    const maturityDate = [...redemptions]
      .map((item) => item.maturityDate)
      .sort()
      .at(-1) ?? requestDate;

    return {
      code: normalizeTreasuryBondCode(code),
      quantity: round(quantity, 6),
      requestDate,
      settlementDate,
      maturityDate,
      grossValuePerUnit: round(grossValueTotal / quantity, 6),
      grossValueTotal,
      grossInterestPerUnit: round(grossInterestTotal / quantity, 6),
      grossInterestTotal,
      annualRate: round(
        redemptions.reduce((total, item) => total + item.annualRate * item.quantity, 0) /
          quantity,
        4
      ),
      feePerUnit: round(feeTotal / quantity, 6),
      feeTotal,
      taxableInterestPerUnit: round(taxableInterestTotal / quantity, 6),
      taxableInterestTotal,
      taxPerUnit: round(taxTotal / quantity, 6),
      taxTotal,
      netValuePerUnit: round(netValueTotal / quantity, 6),
      netValueTotal,
      marketCurrency: "PLN",
      transactionKind: "bond-redemption" as const,
    } satisfies BondRedemptionQuote;
  };

  const buildBondSwapPreview = async ({
    code,
    quantity,
    requestDate,
    targetCode,
    targetQuantity,
  }: {
    code: string;
    quantity: number;
    requestDate: string;
    targetCode: string;
    targetQuantity: number;
  }) => {
    const sourceRedemption = await buildBondRedemptionPreview({
      code,
      quantity,
      requestDate,
    });
    const response = await fetchTreasuryBondSwap({
      sourceRedemption,
      targetCode,
      targetQuantity,
    });

    return response.swap;
  };

  const fetchDraftQuoteWithRetry = async (
    request: {
      symbol: string;
      kind: AssetDraft["kind"];
      marketCurrency: AssetDraft["marketCurrency"];
      provider: AssetDraft["provider"];
      providerId?: string;
      priceScale?: number;
    },
    options?: {
      allowRetry?: boolean;
    }
  ) => {
    const firstTry = await fetchQuotePreview(request);
    if (firstTry || options?.allowRetry === false) return firstTry;

    await wait(220);
    return fetchQuotePreview(request);
  };

  useEffect(() => {
    if (!draftQuotePreviewRequest) {
      lastPreviewRequestKeyRef.current = "";
      return;
    }

    if (lastPreviewRequestKeyRef.current === draftQuotePreviewRequest.requestKey) {
      return;
    }

    let isCancelled = false;
    const requestSeq = ++quoteRequestSeqRef.current;

    lastPreviewRequestKeyRef.current = draftQuotePreviewRequest.requestKey;
    setIsQuoteLoading(true);
    setQuoteError(null);

    void (async () => {
      try {
        const quote = await fetchDraftQuoteWithRetry(
          {
            symbol: draftQuotePreviewRequest.symbol,
            kind: draftQuotePreviewRequest.kind,
            marketCurrency: draftQuotePreviewRequest.marketCurrency,
            provider: draftQuotePreviewRequest.provider,
            providerId: draftQuotePreviewRequest.providerId,
            priceScale: draftQuotePreviewRequest.priceScale,
          },
          { allowRetry: shouldRetryQuoteRequest(searchMode) }
        );

        if (isCancelled || requestSeq !== quoteRequestSeqRef.current) {
          return;
        }

        if (!quote) {
          setQuoteError(
            draftQuotePreviewRequest.kind === "etf"
              ? "Brak aktualnego kursu dla wybranego listingu. Mozesz dodac ETF z cena transakcji."
              : "Brak kursu dla wybranego aktywa. Wybierz inny wynik."
          );
          return;
        }

        setDraft((currentDraft) => {
          if (
            getComparableSymbolForMode(currentDraft.symbol, searchMode) !==
            getComparableSymbolForMode(draftQuotePreviewRequest.symbol, searchMode)
          ) {
            return currentDraft;
          }

          return {
            ...currentDraft,
            latestPrice: quote.price,
            latestPriceDate: quote.priceDate,
            latestPriceMarketTimestamp: quote.marketTimestamp,
            latestPriceFetchedAt: quote.fetchedAt,
            previousClose: quote.previousClose ?? currentDraft.previousClose,
            marketCurrency: quote.marketCurrency,
            provider: quote.provider,
            providerId: quote.providerId ?? currentDraft.providerId,
            priceScale: quote.priceScale ?? currentDraft.priceScale,
          };
        });
        setQuoteError(null);
      } catch {
        if (
          !isCancelled &&
          requestSeq === quoteRequestSeqRef.current &&
          draftQuotePreviewRequest.kind === "etf"
        ) {
          setQuoteError(
            "Nie udalo sie pobrac aktualnego kursu. Mozesz dodac ETF z cena transakcji."
          );
        }
      } finally {
        if (!isCancelled && requestSeq === quoteRequestSeqRef.current) {
          setIsQuoteLoading(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [
    draft.latestPrice,
    draftQuotePreviewRequest,
    searchMode,
  ]);

  const handlePickResult = async (result: AssetSearchResult) => {
    const selectedEtf = result.kind === "etf" && "instrumentIdentity" in result
      ? (result as EtfListing)
      : null;
    const normalizedResultSymbol = normalizeSymbolForMode(result.symbol, searchMode);

    quoteRequestSeqRef.current += 1;
    lastPreviewRequestKeyRef.current = "";
    isManualSymbolRef.current = false;
    setIsSearching(false);
    setSearchError(null);
    setQuoteError(null);
    setIsQuoteLoading(Boolean(selectedEtf));
    setDraft((currentDraft) => ({
      ...currentDraft,
      query: result.name,
      name: result.name,
      symbol: normalizedResultSymbol,
      marketCurrency: result.marketCurrency,
      provider: result.provider,
      providerId: result.providerId,
      priceScale: result.priceScale,
      issuerCountry: result.issuerCountry,
      instrumentIdentity: selectedEtf?.instrumentIdentity,
      marketCurrencyConfirmed: Boolean(selectedEtf?.instrumentIdentity.currency),
      latestPrice: undefined,
      latestPriceDate: undefined,
      previousClose: undefined,
    }));
    setResults([]);
    setEtfResultGroups([]);

    if (!selectedEtf) {
      return;
    }

    try {
      const resolvedListing = await resolveEtfListingPrice(selectedEtf);

      setDraft((currentDraft) => {
        if (
          currentDraft.kind !== "etf" ||
          normalizeSymbol(currentDraft.symbol) !== normalizedResultSymbol
        ) {
          return currentDraft;
        }

        return {
          ...currentDraft,
          marketCurrency: resolvedListing.marketCurrency,
          provider: resolvedListing.provider,
          providerId: resolvedListing.providerId,
          priceScale: resolvedListing.priceScale,
          instrumentIdentity: resolvedListing.instrumentIdentity,
          marketCurrencyConfirmed: Boolean(resolvedListing.instrumentIdentity.currency),
        };
      });
      setQuoteError(
        resolvedListing.priceStatus === "unavailable"
          ? "Brak aktualnego kursu dla wybranego listingu. Mozesz dodac ETF z cena transakcji."
          : null
      );
    } catch {
      setQuoteError(
        "Nie udalo sie sprawdzic aktualnego kursu. Mozesz dodac ETF z cena transakcji."
      );
    } finally {
      setIsQuoteLoading(false);
    }
  };

  const resolveDraftQuote = async (
    normalizedSymbol: string,
    options?: {
      allowRetry?: boolean;
    }
  ): Promise<AssetQuote | null> => {
    if (draft.latestPrice && draft.latestPrice > 0) {
      return {
        symbol: normalizedSymbol,
        price: draft.latestPrice,
        priceDate: draft.latestPriceDate,
        previousClose: draft.previousClose,
        marketCurrency: draft.marketCurrency,
        provider: draft.provider,
        providerId: draft.providerId,
        priceScale: draft.priceScale,
        fetchedAt: new Date().toISOString(),
      };
    }

    if (draft.kind === "etf" && !draft.providerId) {
      setQuoteError(
        "Brak aktualnego kursu dla wybranego listingu. Mozesz dodac ETF z cena transakcji."
      );
      return null;
    }

    const requestSeq = ++quoteRequestSeqRef.current;
    setIsQuoteLoading(true);
    setQuoteError(null);

    try {
      const quote = await fetchDraftQuoteWithRetry({
        symbol: normalizedSymbol,
        kind: draft.kind,
        marketCurrency: draft.marketCurrency,
        provider: draft.provider,
        providerId: draft.providerId,
        priceScale: draft.priceScale,
      }, options);

      if (requestSeq !== quoteRequestSeqRef.current) {
        return null;
      }

      applyQuoteToDraftIfCurrent(
        normalizedSymbol,
        quote,
        draft.kind === "etf"
          ? "Brak aktualnego kursu dla wybranego listingu. Mozesz dodac ETF z cena transakcji."
          : "Brak kursu dla tego tickera. Sprawdz symbol i sprobuj ponownie."
      );

      return quote;
    } catch (error) {
      // A verified ETF listing remains a valid historical transaction even
      // when its optional live-quote provider is temporarily unavailable.
      // Other asset kinds retain their existing strict quote failure path.
      if (draft.kind === "etf") {
        setQuoteError(
          "Nie udalo sie pobrac aktualnego kursu. Mozesz dodac ETF z cena transakcji."
        );
        return null;
      }

      throw error;
    } finally {
      if (requestSeq === quoteRequestSeqRef.current) {
        setIsQuoteLoading(false);
      }
    }
  };

  const buildBondSettlementSale = ({
    baseSale,
    representativeLot,
    preview,
    transactionKind,
    extra,
  }: {
    baseSale: PortfolioSale;
    representativeLot?: PortfolioAsset;
    preview: BondRedemptionQuote;
    transactionKind: "bond-redemption" | "bond-swap";
    extra?: Partial<PortfolioSale>;
  }): PortfolioSale => {
    const grossProfitLossPln = round(
      preview.grossValueTotal - baseSale.realizedInvestedPln
    );

    return {
      ...baseSale,
      transactionKind,
      settlementDate: preview.settlementDate,
      bondMeta: representativeLot?.bondMeta ?? baseSale.bondMeta,
      grossProceedsPln: preview.grossValueTotal,
      grossProfitLossPln,
      grossProceedsValue: preview.grossValueTotal,
      grossProfitLossValue: grossProfitLossPln,
      taxTotalPln: preview.taxTotal,
      redemptionFeeTotalPln: preview.feeTotal,
      ...extra,
    };
  };

  const handleAddBondAsset = async () => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    const normalizedCode = normalizeTreasuryBondCode(bondDraft.code);
    const purchaseDate = toDateInputValue(bondDraft.purchaseDate);

    resetBondInteractionState();
    setBondError(null);
    setSyncError(null);

    if (!normalizedCode || bondDraft.quantity <= 0 || bondDraft.purchasePrice <= 0) {
      setBondError("Podaj kod obligacji, ilosc, date operacji i cene zakupu.");
      return;
    }

    const planLimitError = getFreePlanAssetLimitError();

    if (planLimitError) {
      setBondError(planLimitError);
      return;
    }

    try {
      const response =
        bondSeries &&
        bondQuote &&
        bondSeries.code === normalizedCode &&
        bondQuote.maturityDate ===
          getTreasuryBondMaturityDate(purchaseDate, bondSeries.yearsToMaturity)
          ? { series: bondSeries, quote: bondQuote }
          : await fetchTreasuryBondSeries({
              code: normalizedCode,
              purchaseDate,
            });
      const nextAssetGroupKey = getPortfolioAssetGroupKey({
        kind: "bond",
        symbol: normalizedCode,
      });
      const existingGroupOrder = assets.find(
        (asset) => getPortfolioAssetGroupKey(asset) === nextAssetGroupKey
      )?.groupOrder;
      const nextAsset: PortfolioAsset = {
        id: createAssetId(),
        name: getTreasuryBondDisplayName(response.series),
        symbol: normalizedCode,
        kind: "bond",
        purchaseDate,
        quantity: bondDraft.quantity,
        purchasePrice: round(bondDraft.purchasePrice, 2),
        purchaseCurrency: "PLN",
        purchasePriceCurrency: "PLN",
        purchaseFxRateToPln: 1,
        purchaseSettlementFxRateToPln: 1,
        feePln: 0,
        marketCurrency: "PLN",
        provider: "obligacjeskarbowe",
        latestPrice: response.quote.grossValue,
        previousClose: response.quote.previousClose,
        latestPriceFetchedAt: response.quote.fetchedAt,
        lastUpdatedAt: response.quote.fetchedAt,
        bondMeta: response.series,
        groupOrder: existingGroupOrder ?? getNextGroupOrder(assets),
        createdAt: new Date().toISOString(),
      };

      updateWorkspaceAssets((currentAssets) =>
        normalizeStoredPortfolioAssets([nextAsset, ...currentAssets])
      );
      setBondDraft(createEmptyTreasuryBondDraft());
      setBondSeries(null);
      setBondQuote(null);
      setBondError(null);
    } catch (error) {
      setBondError(toErrorMessage(error, "Nie udalo sie dodac obligacji."));
    }
  };

  const handleSellBondAsset = async () => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    const normalizedCode = normalizeTreasuryBondCode(bondDraft.code);
    const saleDate = toDateInputValue(bondDraft.purchaseDate);

    setBondRedemptionError(null);
    setBondSwapError(null);
    setBondError(null);
    setSyncError(null);

    if (!normalizedCode || bondDraft.quantity <= 0 || bondDraft.purchasePrice <= 0) {
      setBondError("Podaj kod obligacji, ilosc, date sprzedazy i cene sprzedazy.");
      return;
    }

    try {
      const targetGroup = getBondGroup(normalizedCode);

      if (!targetGroup) {
        throw new Error("Nie znaleziono pozycji do sprzedazy.");
      }

      const representativeLot = targetGroup.lots[0];
      const result = applySaleToPortfolio({
        assets,
        group: targetGroup,
        draft: {
          groupKey: targetGroup.key,
          name: targetGroup.name,
          symbol: normalizedCode,
          kind: "bond",
          purchaseCurrency: "PLN",
          marketCurrency: "PLN",
          provider: representativeLot?.provider ?? "obligacjeskarbowe",
          providerId: representativeLot?.providerId,
          priceScale: representativeLot?.priceScale,
          maxQuantity: targetGroup.quantity,
          quantity: bondDraft.quantity,
          quantityInput: bondDraft.quantityInput,
          salePrice: bondDraft.purchasePrice,
          salePriceInput: bondDraft.purchasePriceInput,
          saleDate,
          feePln: 0,
        },
        fxRates,
      });

      updateWorkspaceAssets(() => result.assets);
      updateWorkspaceSales((currentSales) =>
        getSortedPortfolioSales([result.sale, ...currentSales])
      );
      setBondRedemptionPreview(null);
      setBondSwapPreview(null);
      clearBondDraftSelection();
      setBondError(null);
    } catch (error) {
      setBondError(toErrorMessage(error, "Nie udalo sie zapisac sprzedazy obligacji."));
    }
  };

  const handleRedeemBondAsset = async () => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    const normalizedCode = normalizeTreasuryBondCode(bondDraft.code);
    const requestDate = toDateInputValue(bondDraft.purchaseDate);

    setBondRedemptionError(null);
    setBondSwapError(null);
    setBondError(null);
    setSyncError(null);

    if (!normalizedCode || bondDraft.quantity <= 0) {
      setBondRedemptionError("Podaj kod obligacji, ilosc i date dyspozycji wykupu.");
      return;
    }

    setIsBondRedemptionLoading(true);

    try {
      const preview = await buildBondRedemptionPreview({
        code: normalizedCode,
        quantity: bondDraft.quantity,
        requestDate,
      });
      const targetGroup = getBondGroup(normalizedCode);

      if (!targetGroup) {
        throw new Error("Nie znaleziono pozycji do wykupu.");
      }

      const representativeLot = targetGroup.lots[0];
      const result = applySaleToPortfolio({
        assets,
        group: targetGroup,
        draft: {
          groupKey: targetGroup.key,
          name: targetGroup.name,
          symbol: normalizedCode,
          kind: "bond",
          purchaseCurrency: "PLN",
          marketCurrency: "PLN",
          provider: representativeLot?.provider ?? "obligacjeskarbowe",
          providerId: representativeLot?.providerId,
          priceScale: representativeLot?.priceScale,
          maxQuantity: targetGroup.quantity,
          quantity: bondDraft.quantity,
          quantityInput: bondDraft.quantityInput,
          salePrice: preview.grossValuePerUnit,
          salePriceInput: String(preview.grossValuePerUnit),
          saleDate: requestDate,
          feePln: round(preview.feeTotal + preview.taxTotal, 2),
        },
        fxRates,
      });

      updateWorkspaceAssets(() => result.assets);
      updateWorkspaceSales((currentSales) =>
        getSortedPortfolioSales([
          buildBondSettlementSale({
            baseSale: result.sale,
            representativeLot,
            preview,
            transactionKind: "bond-redemption",
          }),
          ...currentSales,
        ])
      );
      setBondRedemptionPreview(preview);
      setBondSwapPreview(null);
      clearBondDraftSelection();
    } catch (error) {
      setBondRedemptionError(toErrorMessage(error, "Nie udalo sie zapisac wykupu."));
    } finally {
      setIsBondRedemptionLoading(false);
    }
  };

  const handleSwapBondAsset = async () => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    const normalizedSourceCode = normalizeTreasuryBondCode(bondDraft.code);
    const normalizedTargetCode = normalizeTreasuryBondCode(bondDraft.swapTargetCode);
    const requestDate = toDateInputValue(bondDraft.purchaseDate);

    setBondSwapError(null);
    setBondRedemptionError(null);
    setBondError(null);
    setSyncError(null);

    if (!normalizedSourceCode || bondDraft.quantity <= 0) {
      setBondSwapError("Podaj kod zrodlowej obligacji, ilosc i date dyspozycji zamiany.");
      return;
    }

    if (!normalizedTargetCode || bondDraft.swapTargetQuantity <= 0) {
      setBondSwapError("Podaj kod docelowej serii oraz ilosc obligacji po zamianie.");
      return;
    }

    setIsBondSwapLoading(true);

    try {
      const preview = await buildBondSwapPreview({
        code: normalizedSourceCode,
        quantity: bondDraft.quantity,
        requestDate,
        targetCode: normalizedTargetCode,
        targetQuantity: bondDraft.swapTargetQuantity,
      });
      const targetGroup = getBondGroup(normalizedSourceCode);

      if (!targetGroup) {
        throw new Error("Nie znaleziono pozycji do zamiany.");
      }

      const representativeLot = targetGroup.lots[0];
      const result = applySaleToPortfolio({
        assets,
        group: targetGroup,
        draft: {
          groupKey: targetGroup.key,
          name: targetGroup.name,
          symbol: normalizedSourceCode,
          kind: "bond",
          purchaseCurrency: "PLN",
          marketCurrency: "PLN",
          provider: representativeLot?.provider ?? "obligacjeskarbowe",
          providerId: representativeLot?.providerId,
          priceScale: representativeLot?.priceScale,
          maxQuantity: targetGroup.quantity,
          quantity: bondDraft.quantity,
          quantityInput: bondDraft.quantityInput,
          salePrice: preview.sourceRedemption.grossValuePerUnit,
          salePriceInput: String(preview.sourceRedemption.grossValuePerUnit),
          saleDate: requestDate,
          feePln: round(
            preview.sourceRedemption.feeTotal + preview.sourceRedemption.taxTotal,
            2
          ),
        },
        fxRates,
      });
      const nextTargetGroupKey = getPortfolioAssetGroupKey({
        kind: "bond",
        symbol: preview.targetSeries.code,
      });
      const existingTargetGroupOrder = result.assets.find(
        (asset) => getPortfolioAssetGroupKey(asset) === nextTargetGroupKey
      )?.groupOrder;
      const swapTargetAssetId = createAssetId();
      const targetAsset: PortfolioAsset = {
        id: swapTargetAssetId,
        name: getTreasuryBondDisplayName(preview.targetSeries),
        symbol: preview.targetSeries.code,
        kind: "bond",
        purchaseDate: preview.settlementDate,
        quantity: preview.targetQuantity,
        purchasePrice: round(preview.swapPricePerUnit, 2),
        purchaseCurrency: "PLN",
        purchasePriceCurrency: "PLN",
        purchaseFxRateToPln: 1,
        purchaseSettlementFxRateToPln: 1,
        feePln: 0,
        marketCurrency: "PLN",
        provider: "obligacjeskarbowe",
        latestPrice: preview.targetQuote.grossValue,
        previousClose: preview.targetQuote.previousClose,
        latestPriceFetchedAt: preview.targetQuote.fetchedAt,
        lastUpdatedAt: preview.targetQuote.fetchedAt,
        bondMeta: preview.targetSeries,
        groupOrder: existingTargetGroupOrder ?? getNextGroupOrder(result.assets),
        createdAt: new Date().toISOString(),
      };

      updateWorkspaceAssets(() =>
        normalizeStoredPortfolioAssets([targetAsset, ...result.assets])
      );
      updateWorkspaceSales((currentSales) =>
        getSortedPortfolioSales([
          buildBondSettlementSale({
            baseSale: result.sale,
            representativeLot,
            preview: preview.sourceRedemption,
            transactionKind: "bond-swap",
            extra: {
              swapTargetCode: preview.targetCode,
              swapTargetQuantity: preview.targetQuantity,
              swapPricePerUnit: preview.swapPricePerUnit,
              swapResidualCashPln: preview.residualCashPln,
              swapTargetAssetId,
            },
          }),
          ...currentSales,
        ])
      );
      setBondSwapPreview(preview);
      setBondRedemptionPreview(null);
      clearBondDraftSelection();
    } catch (error) {
      setBondSwapError(toErrorMessage(error, "Nie udalo sie zapisac zamiany."));
    } finally {
      setIsBondSwapLoading(false);
    }
  };

  const handleAddAsset = async () => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    const name = draft.name.trim() || draft.query.trim();
    const symbol = normalizeSymbolForMode(draft.symbol, searchMode);
    const purchaseDate = toDateInputValue(draft.purchaseDate);

    setSearchError(null);
    setQuoteError(null);

    if (
      !name ||
      !symbol ||
      !purchaseDate ||
      draft.quantity <= 0 ||
      draft.purchasePrice <= 0
    ) {
      setSearchError("Uzupelnij nazwe, ticker, date transakcji, ilosc i cene.");
      return;
    }

    if (
      draft.kind === "etf" &&
      !hasStableEtfListingIdentity(draft.instrumentIdentity, draft.marketCurrencyConfirmed)
    ) {
      setSearchError(
        "Wybierz konkretny, zweryfikowany listing ETF z wynikow wyszukiwania."
      );
      return;
    }

    if (isQuoteLoading && draft.kind !== "etf") {
      setQuoteError("Poczekaj na pobranie kursu przed dodaniem pozycji.");
      return;
    }

    const planLimitError = getFreePlanAssetLimitError();

    if (planLimitError) {
      setSearchError(planLimitError);
      return;
    }

    if (symbol !== normalizeSymbolForMode(draft.symbol, searchMode)) {
      setDraft((currentDraft) => ({
        ...currentDraft,
        symbol,
      }));
    }

    const quote = await resolveDraftQuote(symbol, {
      allowRetry: shouldRetryQuoteRequest(searchMode),
    });

    if (!quote && draft.kind !== "etf") {
      return;
    }

    const storedSymbol = normalizeSymbolForMode(quote?.symbol ?? symbol, searchMode);
    const storedName = quote?.name?.trim() || name;
    const purchaseCurrency = toCurrencyCode(draft.purchaseCurrency, "PLN");
    const marketCurrency = quote?.marketCurrency ?? draft.marketCurrency;
    const purchasePriceCurrency = toCurrencyCode(marketCurrency, draft.marketCurrency);
    const purchaseFxRates = await fetchHistoricalFxRates(
      [purchaseCurrency, purchasePriceCurrency],
      purchaseDate,
      fxRates
    );
    const purchaseFxRateToPln = getFxRateToPlnSnapshot(
      purchasePriceCurrency,
      purchaseFxRates
    );
    const purchaseSettlementFxRateToPln = getFxRateToPlnSnapshot(
      purchaseCurrency,
      purchaseFxRates
    );

    if (!purchaseFxRateToPln || !purchaseSettlementFxRateToPln) {
      setSearchError(
        "Brakuje kursu FX z dnia transakcji. Nie zapisano pozycji z niepewna wycena."
      );
      return;
    }
    const nextAssetGroupKey = getPortfolioAssetGroupKey({
      kind: draft.kind,
      symbol: storedSymbol,
      instrumentIdentity: draft.instrumentIdentity,
    });
    const existingGroupOrder = assets.find(
      (asset) => getPortfolioAssetGroupKey(asset) === nextAssetGroupKey
    )?.groupOrder;

    const nextAsset: PortfolioAsset = {
      id: createAssetId(),
      name: storedName,
      symbol: storedSymbol,
      kind: draft.kind,
      purchaseDate,
      quantity: draft.quantity,
      purchasePrice: draft.purchasePrice,
      purchaseCurrency,
      purchasePriceCurrency,
      purchaseFxRateToPln,
      purchaseSettlementFxRateToPln,
      feePln: draft.feePln,
      marketCurrency,
      provider: quote?.provider ?? draft.provider,
      providerId: quote?.providerId ?? draft.providerId,
      priceScale: quote?.priceScale ?? draft.priceScale,
      issuerCountry: draft.issuerCountry,
      instrumentIdentity: draft.instrumentIdentity,
      latestPrice: quote?.price,
      latestPriceDate: quote?.priceDate,
      latestPriceMarketTimestamp: quote?.marketTimestamp,
      latestPriceFetchedAt: quote?.fetchedAt,
      previousClose: quote?.previousClose ?? draft.previousClose,
      lastUpdatedAt: quote?.fetchedAt,
      groupOrder: existingGroupOrder ?? getNextGroupOrder(assets),
      createdAt: new Date().toISOString(),
    };

    isManualSymbolRef.current = false;
    updateWorkspaceAssets((currentAssets) =>
      normalizeStoredPortfolioAssets([nextAsset, ...currentAssets])
    );
    setLastAddedResult({
      symbol: storedSymbol,
      name: storedName,
      kind: draft.kind,
      marketCurrency,
      provider: quote?.provider ?? draft.provider,
      providerId: quote?.providerId ?? draft.providerId,
      priceScale: quote?.priceScale ?? draft.priceScale,
      issuerCountry: draft.issuerCountry,
      instrumentIdentity: draft.instrumentIdentity,
      source: "catalog",
    });
    setDraft(createDraftFromMode(searchMode));
    setResults([]);
    setEtfResultGroups([]);
    setSearchError(null);
    setQuoteError(null);
  };

  const handleSellAsset = async () => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    const name = draft.name.trim() || draft.query.trim();
    const symbol = normalizeSymbolForMode(draft.symbol, searchMode);
    const saleDate = toDateInputValue(draft.purchaseDate);

    setSearchError(null);
    setQuoteError(null);

    if (!symbol || !saleDate || draft.quantity <= 0 || draft.purchasePrice <= 0) {
      setSearchError("Uzupelnij ticker, date transakcji, ilosc i cene sprzedazy.");
      return;
    }

    const groupKey = getPortfolioAssetGroupKey({
      kind: draft.kind,
      symbol,
      instrumentIdentity: draft.instrumentIdentity,
    });
    const targetGroup = groupedAssets.find((group) => group.key === groupKey);

    if (!targetGroup) {
      setSearchError("Nie masz otwartej pozycji dla tego aktywa.");
      return;
    }

    try {
      const representativeLot = targetGroup.lots[0];
      const saleCurrency = toCurrencyCode(draft.marketCurrency, targetGroup.marketCurrency);
      const settlementCurrency = toCurrencyCode(
        draft.purchaseCurrency,
        representativeLot?.purchaseCurrency ?? "PLN"
      );
      const historicalFxCodes = Array.from(
        new Set(
          [
            settlementCurrency,
            saleCurrency,
            ...targetGroup.lots.flatMap((lot) => [
              lot.purchaseCurrency,
              lot.purchasePriceCurrency,
              lot.marketCurrency,
            ]),
          ]
            .map((code) => toCurrencyCode(code))
            .filter(Boolean)
        )
      );
      let saleFxRates = fxRates;

      try {
        const response = await fetchFxRates(historicalFxCodes, saleDate);
        saleFxRates = {
          ...FALLBACK_FX_RATES,
          ...saleFxRates,
          ...response.rates,
        };
      } catch {
        saleFxRates = {
          ...FALLBACK_FX_RATES,
          ...saleFxRates,
        };
      }

      if (
        !getFxRateToPlnSnapshot(saleCurrency, saleFxRates) ||
        !getFxRateToPlnSnapshot(settlementCurrency, saleFxRates)
      ) {
        setSearchError(
          "Brakuje kursu FX z dnia transakcji. Nie zapisano sprzedazy z niepewnym wynikiem."
        );
        return;
      }

      const result = applySaleToPortfolio({
        assets,
        group: targetGroup,
        draft: {
          groupKey,
          name: name || targetGroup.name,
          symbol,
          kind: draft.kind,
          purchaseCurrency: settlementCurrency,
          marketCurrency: saleCurrency,
          provider: representativeLot?.provider ?? draft.provider,
          providerId: representativeLot?.providerId ?? draft.providerId,
          priceScale: representativeLot?.priceScale ?? draft.priceScale,
          maxQuantity: targetGroup.quantity,
          quantity: draft.quantity,
          quantityInput: draft.quantityInput,
          salePrice: draft.purchasePrice,
          salePriceInput: draft.purchasePriceInput,
          saleDate,
          feePln: draft.feePln,
        },
        fxRates: saleFxRates,
      });

      isManualSymbolRef.current = false;
      updateWorkspaceAssets(() => result.assets);
      updateWorkspaceSales((currentSales) =>
        getSortedPortfolioSales([result.sale, ...currentSales])
      );
      setDraft(createDraftFromMode(searchMode));
      setResults([]);
      setSearchError(null);
      setQuoteError(null);
      setSyncError(null);
    } catch (error) {
      setSearchError(toErrorMessage(error, "Nie udalo sie zapisac sprzedazy."));
    }
  };

  const handleImportBrokerOperations = async (
    operations: ImportedBrokerOperation[],
    onQuoteProgress: (progress: { completed: number; total: number }) => void
  ) => {
    if (!requireConcretePortfolioSelection()) {
      throw new Error("Wybierz konkretny portfel docelowy przed importem.");
    }
    if (!activePortfolio) {
      throw new Error("Brakuje aktywnego portfela do importu.");
    }

    const now = new Date().toISOString();
    const portfolioForImport =
      activePortfolioForEngine ??
      ensurePortfolioCoreModel({
        ...activePortfolio,
        assets,
        sales,
        realizedAdjustments,
      });
    const portfolioId = portfolioForImport.id;
    const importCurrencies = Array.from(
      new Set(
        operations
          .flatMap((operation) => [
            operation.currency,
            operation.marketCurrency,
            operation.cashCurrency,
            operation.accountCurrency,
            operation.sourceCurrency,
            operation.targetCurrency,
          ])
          .map((currency) => toCurrencyCode(currency, "PLN"))
      )
    );
    let importFxRates = fxRatesRef.current;

    try {
      const response = await fetchFxRates(importCurrencies);
      importFxRates = {
        ...FALLBACK_FX_RATES,
        ...fxRatesRef.current,
        ...response.rates,
      };
      fxRatesRef.current = importFxRates;
      setFxRates(importFxRates);
      setFxUpdatedAt(response.fetchedAt);
    } catch {
      importFxRates = {
        ...FALLBACK_FX_RATES,
        ...fxRatesRef.current,
      };
    }

    let nextAssets: PortfolioAsset[] = normalizeStoredPortfolioAssets(assets);
    let nextSales = getSortedPortfolioSales(sales);
    let nextAccounts = portfolioForImport.accounts ?? [];
    let nextInstruments = portfolioForImport.instruments ?? [];
    let nextOperations = (portfolioForImport.operations ?? []).filter(
      (operation) => typeof operation.metadata.legacySource !== "string"
    );
    const existingOperationIds = new Set(nextOperations.map((operation) => operation.id));
    const existingImportKeys = new Set(
      nextOperations
        .flatMap((operation) => {
          const primaryKey =
            typeof operation.metadata.importKey === "string" ? operation.metadata.importKey : "";
          const legacyKeys = Array.isArray(operation.metadata.legacyImportKeys)
            ? operation.metadata.legacyImportKeys.filter(
                (key): key is string => typeof key === "string"
              )
            : [];

          return [primaryKey, ...legacyKeys];
        })
        .filter(Boolean)
    );
    let importedBuys = 0;
    let importedSells = 0;
    let importedDividends = 0;
    let importedCashOperations = 0;
    let skippedSells = 0;
    let skippedInvalid = 0;
    let skippedDuplicates = 0;
    let skippedPlanLimit = 0;

    const appendCoreOperation = (operation: ImportedBrokerOperation, targetAccountId?: string) => {
      const broker = normalizeImportedBroker(operation.broker);
      const sourceCurrency = toCurrencyCode(
        operation.sourceCurrency ?? operation.accountCurrency ?? operation.currency,
        "PLN"
      );
      const sourceAccountNumber = operation.sourceAccountNumber ?? operation.accountNumber;

      nextAccounts = upsertImportedAccount(
        nextAccounts,
        portfolioId,
        broker,
        sourceAccountNumber,
        sourceCurrency,
        now
      );

      const accountId = getImportedAccountId(
        portfolioId,
        broker,
        sourceAccountNumber,
        sourceCurrency
      );
      let resolvedTargetAccountId = targetAccountId;

      if (!resolvedTargetAccountId && (operation.targetAccountNumber || operation.targetCurrency)) {
        const targetCurrency = toCurrencyCode(
          operation.targetCurrency ?? operation.currency,
          sourceCurrency
        );

        nextAccounts = upsertImportedAccount(
          nextAccounts,
          portfolioId,
          broker,
          operation.targetAccountNumber,
          targetCurrency,
          now
        );
        resolvedTargetAccountId = getImportedAccountId(
          portfolioId,
          broker,
          operation.targetAccountNumber,
          targetCurrency
        );
      }

      const instrumentResult = upsertImportedInstrument(
        nextInstruments,
        portfolioId,
        operation,
        now
      );
      nextInstruments = instrumentResult.instruments;

      const nextOperation = buildImportedPortfolioOperation({
        portfolioId,
        accountId,
        targetAccountId: resolvedTargetAccountId,
        instrumentId: instrumentResult.instrumentId,
        operation,
        now,
      });

      if (
        isImportedOperationDuplicate(
          operation,
          nextOperation.id,
          existingOperationIds,
          existingImportKeys
        )
      ) {
        skippedDuplicates += 1;
        return false;
      }

      const automaticConversion = buildAutomaticBrokerConversionOperation(
        nextOperation,
        operation
      );

      if (automaticConversion && !existingOperationIds.has(automaticConversion.id)) {
        nextOperations = [...nextOperations, automaticConversion];
        existingOperationIds.add(automaticConversion.id);
      }

      nextOperations = [...nextOperations, nextOperation];
      existingOperationIds.add(nextOperation.id);

      if (operation.importKey) {
        existingImportKeys.add(operation.importKey);
      }

      (operation.legacyImportKeys ?? []).forEach((key) => {
        if (key.trim()) {
          existingImportKeys.add(key);
        }
      });

      return true;
    };

    const orderedOperations = [...operations].sort(
      (left, right) =>
        left.date.localeCompare(right.date) || left.rowNumber - right.rowNumber
    );

    for (const [operationIndex, operation] of orderedOperations.entries()) {
      if (operationIndex > 0 && operationIndex % 32 === 0) {
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => resolve());
        });
      }

      const operationType = getImportedOperationType(operation);
      const operationId = getImportedOperationId(portfolioId, operation);

      if (
        isImportedOperationDuplicate(
          operation,
          operationId,
          existingOperationIds,
          existingImportKeys
        )
      ) {
        skippedDuplicates += 1;
        continue;
      }

      if (operationType !== "BUY" && operationType !== "SELL") {
        if (appendCoreOperation(operation)) {
          if (operationType === "DIVIDEND") {
            importedDividends += 1;
          } else {
            importedCashOperations += 1;
          }
        }

        continue;
      }

      if (!operation.symbol || operation.quantity <= 0 || operation.price <= 0) {
        console.warn("[broker-import] Pomieto nieprawidlowa transakcje.", {
          rowNumber: operation.rowNumber,
          importKey: operation.importKey,
          operationType,
          symbol: operation.symbol,
          quantity: operation.quantity,
          price: operation.price,
        });
        skippedInvalid += 1;
        if (operationType === "SELL") {
          skippedSells += 1;
        }

        continue;
      }

      const groupKey = getPortfolioAssetGroupKey({
        kind: operation.kind,
        symbol: operation.symbol,
      });
      const importedMarketCurrency = toCurrencyCode(
        operation.marketCurrency ?? operation.currency,
        "PLN"
      );
      const importedCashCurrency = toCurrencyCode(
        operation.cashCurrency ?? operation.accountCurrency ?? operation.currency,
        "PLN"
      );
      const importedSettlementUnitPrice =
        operation.cashAmount && operation.quantity > 0
          ? round(operation.cashAmount / operation.quantity, 6)
          : operation.price;
      const hasImportedMarketUnitPrice =
        typeof operation.price === "number" &&
        Number.isFinite(operation.price) &&
        operation.price > 0;
      const importedUnitPrice = hasImportedMarketUnitPrice
        ? operation.price
        : importedSettlementUnitPrice;
      const importedPriceCurrency = hasImportedMarketUnitPrice
        ? importedMarketCurrency
        : importedCashCurrency;
      const importedPurchaseFxRateToPln =
        importedPriceCurrency === "PLN"
          ? 1
          : importedCashCurrency === "PLN" &&
              typeof operation.exchangeRate === "number" &&
              Number.isFinite(operation.exchangeRate) &&
              operation.exchangeRate > 0
            ? operation.exchangeRate
            : getFxRateToPlnSnapshot(importedPriceCurrency, importFxRates);
      const importedSettlementFxRateToPln = getFxRateToPlnSnapshot(
        importedCashCurrency,
        importFxRates
      );

      if (!importedPurchaseFxRateToPln || !importedSettlementFxRateToPln) {
        console.warn("[broker-import] Pomieto transakcje bez kursu FX.", {
          rowNumber: operation.rowNumber,
          importKey: operation.importKey,
          symbol: operation.symbol,
          priceCurrency: importedPriceCurrency,
          settlementCurrency: importedCashCurrency,
        });
        skippedInvalid += 1;
        if (operationType === "SELL") {
          skippedSells += 1;
        }
        continue;
      }

      if (operationType === "BUY") {
        const nextAssetGroups = new Set([
          ...nextAssets.map(getPortfolioAssetGroupKey),
          groupKey,
        ]).size;
        const planLimitError = getFreePlanAssetLimitError(nextAssetGroups);

        if (planLimitError) {
          skippedPlanLimit += 1;
          continue;
        }

        const existingGroupOrder = nextAssets.find(
          (asset) => getPortfolioAssetGroupKey(asset) === groupKey
        )?.groupOrder;
        const nextAsset: PortfolioAsset = {
          id: createAssetId(),
          name: operation.name,
          symbol: operation.symbol,
          kind: operation.kind,
          purchaseDate: operation.date,
          quantity: operation.quantity,
          purchasePrice: importedUnitPrice,
          purchaseCurrency: importedCashCurrency,
          purchasePriceCurrency: importedPriceCurrency,
          purchaseFxRateToPln: importedPurchaseFxRateToPln,
          purchaseSettlementFxRateToPln: importedSettlementFxRateToPln,
          feePln: operation.feePln,
          marketCurrency: importedMarketCurrency,
          provider: operation.provider,
          providerId: operation.providerId,
          groupOrder: existingGroupOrder ?? getNextGroupOrder(nextAssets),
          createdAt: new Date(`${operation.date}T00:00:00.000Z`).toISOString(),
        };

        if (appendCoreOperation(operation)) {
          nextAssets = [nextAsset, ...nextAssets];
          importedBuys += 1;
        }
        continue;
      }

      const targetGroup = getGroupedPortfolioAssets(nextAssets, importFxRates).find(
        (group) => group.key === groupKey
      );

      if (!targetGroup) {
        console.warn("[broker-import] Pomieto sprzedaz bez pasujacej otwartej pozycji.", {
          rowNumber: operation.rowNumber,
          importKey: operation.importKey,
          symbol: operation.symbol,
        });
        skippedSells += 1;
        continue;
      }

      try {
        const representativeLot = targetGroup.lots[0];
        const importedSaleCurrency = hasImportedMarketUnitPrice
          ? importedMarketCurrency
          : importedCashCurrency;
        const importedSaleFxRateToPln =
          importedSaleCurrency === "PLN"
            ? 1
            : importedCashCurrency === "PLN" &&
              typeof operation.exchangeRate === "number" &&
              Number.isFinite(operation.exchangeRate) &&
              operation.exchangeRate > 0
              ? operation.exchangeRate
              : getFxRateToPlnSnapshot(importedSaleCurrency, importFxRates);

        if (!importedSaleFxRateToPln) {
          console.warn("[broker-import] Pomieto sprzedaz bez kursu FX.", {
            rowNumber: operation.rowNumber,
            importKey: operation.importKey,
            symbol: operation.symbol,
            saleCurrency: importedSaleCurrency,
          });
          skippedInvalid += 1;
          skippedSells += 1;
          continue;
        }

        const result = applySaleToPortfolio({
          assets: nextAssets,
          group: targetGroup,
          draft: {
            groupKey,
            name: operation.name || targetGroup.name,
            symbol: operation.symbol,
            kind: operation.kind,
            purchaseCurrency: importedCashCurrency,
            marketCurrency: importedSaleCurrency,
            provider: representativeLot?.provider ?? operation.provider,
            providerId: representativeLot?.providerId ?? operation.providerId,
            priceScale: representativeLot?.priceScale,
            maxQuantity: targetGroup.quantity,
            quantity: operation.quantity,
            quantityInput: String(operation.quantity),
            salePrice: importedUnitPrice,
            salePriceInput: String(importedUnitPrice),
            saleDate: operation.date,
            feePln: operation.feePln,
          },
          fxRates: {
            ...importFxRates,
            [importedSaleCurrency]: importedSaleFxRateToPln,
          },
        });

        if (appendCoreOperation(operation)) {
          nextAssets = result.assets;
          nextSales = getSortedPortfolioSales([
            applyBrokerRealizedResult(result.sale, operation),
            ...nextSales,
          ]);
          importedSells += 1;
        }
      } catch (error) {
        console.warn("[broker-import] Pomieto sprzedaz z powodu niezgodnej historii.", {
          importKey: operation.importKey,
          symbol: operation.symbol,
          error,
        });
        skippedSells += 1;
      }
    }

    const importedTotal =
      importedBuys + importedSells + importedDividends + importedCashOperations;

    if (importedTotal === 0) {
      return {
        importedBuys,
        importedSells,
        importedDividends,
        importedCashOperations,
        skippedSells,
        skippedInvalid,
        skippedDuplicates,
        skippedPlanLimit,
      };
    }

    const nextPortfolio = ensurePortfolioCoreModel({
      ...portfolioForImport,
      assets: nextAssets,
      sales: nextSales,
      realizedAdjustments,
      accounts: nextAccounts,
      instruments: nextInstruments,
      operations: nextOperations,
      updatedAt: now,
    });

    const nextPortfolios = portfoliosRef.current.map((portfolio) =>
      portfolio.id === portfolioId
        ? {
            ...portfolio,
            ...nextPortfolio,
            assets: nextAssets,
            sales: nextSales,
            realizedAdjustments,
            updatedAt: now,
          }
        : portfolio
    );
    setIsPortfolioMutationPending(true);
    try {
      await queuePortfolioSave(
        {
          schemaVersion: 2,
          portfolios: nextPortfolios,
          activePortfolioId: activePortfolioIdRef.current,
        },
        true
      );

      let quoteRefresh: Awaited<ReturnType<typeof refreshPortfolioQuotesWithProgress>>;

      try {
        quoteRefresh = await refreshPortfolioQuotesWithProgress(
          nextPortfolios.flatMap((portfolio) => portfolio.assets),
          onQuoteProgress
        );
      } catch (error) {
        // A historical transaction has already been persisted. A transient
        // quote-provider failure must not undo that transaction (in
        // particular for crypto, whose live quote is independent of import).
        console.warn("[broker-import] Import zapisany bez odswiezenia kursow.", {
          error,
        });
        setLastSyncAt(new Date().toISOString());
        setSyncError(null);

        return {
          importedBuys,
          importedSells,
          importedDividends,
          importedCashOperations,
          skippedSells,
          skippedInvalid,
          skippedDuplicates,
          skippedPlanLimit,
          quoteTotal: 0,
          missingQuotes: nextPortfolios
            .flatMap((portfolio) => portfolio.assets)
            .filter((asset) => !hasAssetLivePrice(asset)).length,
        };
      }
      const refreshedById = new Map(
        quoteRefresh.assets.map((asset) => [asset.id, asset])
      );
      const refreshedPortfolios = nextPortfolios.map((portfolio) => ({
        ...portfolio,
        assets: normalizeStoredPortfolioAssets(
          portfolio.assets.map((asset) => {
            const refreshed = refreshedById.get(asset.id);

            if (!refreshed) {
              return asset;
            }

            return applyRefreshedPortfolioAssetSnapshot(asset, refreshed);
          })
        ),
        updatedAt: new Date().toISOString(),
      }));
      const refreshedActivePortfolio =
        refreshedPortfolios.find(
          (portfolio) => portfolio.id === activePortfolioIdRef.current
        ) ?? refreshedPortfolios[0];
      const refreshedWorkspace = {
        assets: refreshedActivePortfolio.assets,
        sales: refreshedActivePortfolio.sales,
        realizedAdjustments: refreshedActivePortfolio.realizedAdjustments,
      };
      const refreshedBook = {
        schemaVersion: 2 as const,
        portfolios: refreshedPortfolios,
        activePortfolioId: activePortfolioIdRef.current,
      };

      quoteRefreshSeqRef.current.all += 1;
      quoteRefreshSeqRef.current.crypto += 1;
      applyPortfolioBook(refreshedPortfolios, activePortfolioIdRef.current);
      replaceWorkspace(refreshedWorkspace);
      quoteOnlyPortfolioFingerprintRef.current = getPortfolioSaveFingerprint(refreshedBook);
      void savePortfolioQuoteSnapshots(
        getQuoteSnapshotPayload(
          refreshedPortfolios,
          new Set(quoteRefresh.assets.map((asset) => asset.id))
        )
      ).catch(() => undefined);
      setLastSyncAt(new Date().toISOString());
      setRefreshRevision((currentRevision) => currentRevision + 1);
      setSyncError(null);

      return {
        importedBuys,
        importedSells,
        importedDividends,
        importedCashOperations,
        skippedSells,
        skippedInvalid,
        skippedDuplicates,
        skippedPlanLimit,
        quoteTotal: quoteRefresh.total,
        missingQuotes: quoteRefresh.missing,
      };
    } catch (error) {
      restoreLastPersistedPortfolioBook();
      throw error;
    } finally {
      setIsPortfolioMutationPending(false);
    }
  };

  const handleAddRealizedAdjustment = async () => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    const amount = realizedAdjustmentDraft.amount;
    const currency = toCurrencyCode(realizedAdjustmentDraft.currency, "PLN");
    const date = toDateInputValue(realizedAdjustmentDraft.date);
    const note = realizedAdjustmentDraft.note.trim();

    setRealizedAdjustmentError(null);
    setSyncError(null);

    if (!date || amount === 0) {
      setRealizedAdjustmentError("Podaj kwote rozna od zera oraz date.");
      return;
    }

    let nextRates = fxRates;
    let amountPlnSnapshot: number;

    if (currency === "PLN") {
      amountPlnSnapshot = amount;
    } else {
      let rate: number | undefined = nextRates[currency];

      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        try {
          const response = await fetchFxRates([currency]);
          nextRates = {
            ...FALLBACK_FX_RATES,
            ...fxRatesRef.current,
            ...response.rates,
          };
          fxRatesRef.current = nextRates;
          setFxRates(nextRates);
          setFxUpdatedAt(response.fetchedAt);
          rate = nextRates[currency];
        } catch {
          rate = undefined;
        }
      }

      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        setRealizedAdjustmentError("Brakuje kursu FX dla wybranej waluty.");
        return;
      }

      amountPlnSnapshot = amount * rate;
    }

    const nextAdjustment = createPortfolioRealizedAdjustment({
      amount,
      currency,
      amountPlnSnapshot,
      date,
      note,
    });

    updateWorkspaceRealizedAdjustments((currentAdjustments) =>
      getSortedPortfolioRealizedAdjustments([nextAdjustment, ...currentAdjustments])
    );
    setRealizedAdjustmentDraft(createEmptyRealizedAdjustmentDraft());
  };

  const handleRemoveRealizedAdjustment = (adjustmentId: string) => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    setSyncError(null);
    updateWorkspaceRealizedAdjustments((currentAdjustments) =>
      getSortedPortfolioRealizedAdjustments(
        currentAdjustments.filter(
          (adjustment) =>
            !(adjustment.id === adjustmentId && adjustment.source === "manual")
        )
      )
    );
  };

  const handleUndoSale = (saleId: string) => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    try {
      const result = undoPortfolioSale({
        assets,
        sales,
        saleId,
      });

      replaceWorkspace({
        ...workspaceRef.current,
        assets: result.assets,
        sales: result.sales,
      });
      setSyncError(null);
    } catch (error) {
      setSyncError(toErrorMessage(error, "Nie udalo sie cofnac sprzedazy."));
    }
  };

  const handleReorderAssetGroups = (nextGroupKeys: string[]) => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    setSyncError(null);
    updateWorkspaceAssets((currentAssets) => {
      const orderedGroupKeys = getManualOrderKeys(currentAssets);

      if (
        nextGroupKeys.length !== orderedGroupKeys.length ||
        orderedGroupKeys.every((key, index) => key === nextGroupKeys[index])
      ) {
        return currentAssets;
      }

      const nextGroupOrderByKey = new Map(
        nextGroupKeys.map((key, index) => [key, index] as const)
      );

      return normalizeStoredPortfolioAssets(
        currentAssets.map((asset) => ({
          ...asset,
          groupOrder:
            nextGroupOrderByKey.get(getPortfolioAssetGroupKey(asset)) ?? asset.groupOrder,
        }))
      );
    });
  };

  const loadPortfolioIntoWorkspace = (portfolio: InvestmentPortfolio) => {
    isSwitchingPortfolioRef.current = true;
    const nextWorkspace = {
      assets: normalizeStoredPortfolioAssets(portfolio.assets),
      sales: getSortedPortfolioSales(portfolio.sales),
      realizedAdjustments: getSortedPortfolioRealizedAdjustments(portfolio.realizedAdjustments),
    };
    replaceWorkspace(nextWorkspace);
    setFilter("");
    setSyncError(null);
    setResults([]);
    setSearchError(null);
    setQuoteError(null);
    window.setTimeout(() => {
      isSwitchingPortfolioRef.current = false;
    }, 0);
  };

  const handleSelectPortfolio = async (portfolioId: string) => {
    if (isPortfolioMutationPending) {
      return;
    }

    if (portfolioId === ALL_PORTFOLIOS_ID) {
      // Commit the currently visible real portfolio into local memory before
      // switching presentation only. Its URL state is never persisted in the
      // portfolio book and retains the current workspace route/query.
      const currentPortfolios = commitActivePortfolioSnapshot(portfoliosRef.current);
      portfoliosRef.current = currentPortfolios;
      setPortfolios(currentPortfolios);
      replacePortfolioContextQuery("all", activePortfolioBaseCurrency);
      setFilter("");
      setSyncError(null);
      return;
    }

    if (portfolioId === activePortfolioId) {
      replacePortfolioContextQuery("single");
      return;
    }

    const currentPortfolios = commitActivePortfolioSnapshot(portfoliosRef.current);
    const nextPortfolio = currentPortfolios.find((portfolio) => portfolio.id === portfolioId);

    if (!nextPortfolio) {
      return;
    }

    setIsPortfolioMutationPending(true);
    applyPortfolioBook(currentPortfolios, nextPortfolio.id);
    loadPortfolioIntoWorkspace(nextPortfolio);

    try {
      await queuePortfolioSave(
        {
          schemaVersion: 2,
          portfolios: currentPortfolios,
          activePortfolioId: nextPortfolio.id,
        },
        true
      );
      replacePortfolioContextQuery("single");
    } catch {
      restoreLastPersistedPortfolioBook();
    } finally {
      setIsPortfolioMutationPending(false);
    }
  };

  const handleCreatePortfolio = async () => {
    if (isPortfolioMutationPending) {
      return;
    }

    const name = window.prompt(
      "Nazwa nowego portfela",
      `Portfel ${portfoliosRef.current.length + 1}`
    );

    if (!name?.trim()) {
      return;
    }

    const currentPortfolios = commitActivePortfolioSnapshot(portfoliosRef.current);
    if (getDuplicatePortfolioName(currentPortfolios, name)) {
      setSyncError("Masz już portfel o tej nazwie. Wybierz inną nazwę.");
      return;
    }
    const nextPortfolio = createInvestmentPortfolio(name.trim());
    const nextPortfolios = [...currentPortfolios, nextPortfolio];

    setIsPortfolioMutationPending(true);
    applyPortfolioBook(nextPortfolios, nextPortfolio.id);
    loadPortfolioIntoWorkspace(nextPortfolio);

    try {
      await queuePortfolioSave(
        {
          schemaVersion: 2,
          portfolios: nextPortfolios,
          activePortfolioId: nextPortfolio.id,
        },
        true
      );
      replacePortfolioContextQuery("single");
    } catch {
      restoreLastPersistedPortfolioBook();
    } finally {
      setIsPortfolioMutationPending(false);
    }
  };

  const handleRenamePortfolio = async () => {
    if (!activePortfolio || isPortfolioMutationPending) {
      return;
    }

    const name = window.prompt("Nowa nazwa portfela", activePortfolio.name);

    if (!name?.trim()) {
      return;
    }

    const currentPortfolios = commitActivePortfolioSnapshot(portfoliosRef.current);
    if (getDuplicatePortfolioName(currentPortfolios, name, activePortfolioId)) {
      setSyncError("Masz już portfel o tej nazwie. Wybierz inną nazwę.");
      return;
    }

    const now = new Date().toISOString();
    const nextPortfolios = currentPortfolios.map((portfolio) =>
      portfolio.id === activePortfolioId
        ? {
            ...portfolio,
            name: name.trim().slice(0, 64),
            updatedAt: now,
          }
        : portfolio
    );
    setIsPortfolioMutationPending(true);
    applyPortfolioBook(nextPortfolios, activePortfolioId);

    try {
      await queuePortfolioSave(
        {
          schemaVersion: 2,
          portfolios: nextPortfolios,
          activePortfolioId,
        },
        true
      );
    } catch {
      restoreLastPersistedPortfolioBook();
    } finally {
      setIsPortfolioMutationPending(false);
    }
  };

  const handleDeletePortfolio = async () => {
    if (!activePortfolio || portfolios.length <= 1) {
      setSyncError("Nie mozna usunac ostatniego portfela.");
      return;
    }

    if (isPortfolioMutationPending) {
      return;
    }

    const confirmed = window.confirm(
      `Usunac portfel "${activePortfolio.name}" razem z jego transakcjami? Tej operacji nie da sie cofnac.`
    );

    if (!confirmed) {
      return;
    }

    const currentPortfolios = commitActivePortfolioSnapshot(portfoliosRef.current);
    const nextPortfolios = currentPortfolios.filter(
      (portfolio) => portfolio.id !== activePortfolioId
    );
    const nextPortfolio = nextPortfolios[0];

    setIsPortfolioMutationPending(true);
    applyPortfolioBook(nextPortfolios, nextPortfolio.id);
    loadPortfolioIntoWorkspace(nextPortfolio);

    try {
      await queuePortfolioSave(
        {
          schemaVersion: 2,
          portfolios: nextPortfolios,
          activePortfolioId: nextPortfolio.id,
        },
        true
      );
      replacePortfolioContextQuery("single");
    } catch {
      restoreLastPersistedPortfolioBook();
    } finally {
      setIsPortfolioMutationPending(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);

    try {
      await logoutUser();
      window.location.href = "/login";
    } catch (error) {
      setSyncError(toErrorMessage(error, "Nie udalo sie wylogowac."));
      setIsLoggingOut(false);
    }
  };

  const handleVerificationRequest = async () => {
    setIsSendingVerification(true);
    setVerificationMessage(null);
    setVerificationError(null);
    setVerificationPreviewUrl(null);

    try {
      const response = await requestEmailVerification();

      if (response.alreadyVerified) {
        setVerificationMessage("Ten adres email jest juz zweryfikowany.");
        return;
      }

      setVerificationMessage("Link weryfikacyjny jest gotowy.");
      setVerificationPreviewUrl(response.previewUrl);
    } catch (error) {
      setVerificationError(
        toErrorMessage(error, "Nie udalo sie przygotowac linku weryfikacyjnego.")
      );
    } finally {
      setIsSendingVerification(false);
    }
  };

  const summary = useMemo(
    () => {
      if (!isAllPortfoliosSelected) {
        return getPortfolioSummary(
          displayedAssets,
          displayedSales,
          effectiveRealizedAdjustments,
          fxRates,
          activeBaseCurrency
        );
      }

      const summaries = portfolios.map((portfolio) => {
        const corePortfolio = ensurePortfolioCoreModel(portfolio);
        const portfolioAdjustments = getSortedPortfolioRealizedAdjustments([
          ...corePortfolio.realizedAdjustments,
          ...buildAutomaticBondCouponAdjustments(corePortfolio.assets, corePortfolio.sales),
        ]);

        return getPortfolioSummary(
          corePortfolio.assets,
          corePortfolio.sales,
          portfolioAdjustments,
          fxRates,
          toCurrencyCode(corePortfolio.baseCurrency, "PLN")
        );
      });

      return aggregatePortfolioSummaries(summaries, fxRates, activeBaseCurrency);
    },
    [
      activeBaseCurrency,
      displayedAssets,
      effectiveRealizedAdjustments,
      displayedSales,
      fxRates,
      isAllPortfoliosSelected,
      portfolios,
    ]
  );
  const displayedSyncError = syncError ?? fxError;

  const summaryPanel = <PortfolioSummary summary={summary} lastSyncAt={lastSyncAt} fxUpdatedAt={fxUpdatedAt} isRefreshing={isRefreshing} isLoggingOut={isLoggingOut} isSendingVerification={isSendingVerification} canVerifyEmail={!account.emailVerifiedAt} syncError={displayedSyncError} verificationMessage={verificationMessage} verificationError={verificationError} verificationPreviewUrl={verificationPreviewUrl} subscriptionPlan={account.subscriptionPlan} onRefresh={() => { void handleRefreshPortfolioData(); }} onRequestVerification={() => { void handleVerificationRequest(); }} />;

  const removeAsset = (assetId: string) => {
    if (!requireConcretePortfolioSelection()) {
      return;
    }
    setSyncError(null);
    updateWorkspaceAssets((currentAssets) => normalizeStoredPortfolioAssets(currentAssets.filter((asset) => asset.id !== assetId)));
  };

  const assetEntryWorkspace = <>
    <section className="panel panel-compact workspace-entry-head"><div><p className="eyebrow">Nowa operacja</p><h2 className="section-title">Dodaj instrument</h2><p className="section-copy">Wybierz klasę aktywa i dodaj zakup lub sprzedaż do aktywnego portfela.</p></div><AssetModeSelector value={entryMode} onChange={handleEntryModeChange} /></section>
    {entryMode === "bond" ? <TreasuryBondForm draft={bondDraft} series={bondSeries} quote={bondQuote} redemptionPreview={bondRedemptionPreview} swapPreview={bondSwapPreview} isLoadingSeries={isBondLoading} isLoadingRedemption={isBondRedemptionLoading} isLoadingSwap={isBondSwapLoading} error={bondError} redemptionError={bondRedemptionError} swapError={bondSwapError} onChange={(nextDraft) => { setBondDraft(nextDraft); resetBondInteractionState(); }} onCodeChange={(code) => { setBondDraft((currentDraft) => ({ ...currentDraft, code: normalizeTreasuryBondCode(code) })); setBondError(null); resetBondInteractionState(); }} onBuySubmit={() => { void handleAddBondAsset(); }} onSellSubmit={() => { void handleSellBondAsset(); }} onRedeemSubmit={() => { void handleRedeemBondAsset(); }} onSwapSubmit={() => { void handleSwapBondAsset(); }} /> : <AddAssetForm showModeSelector={false} searchMode={searchMode} draft={draft} results={results} etfResultGroups={etfResultGroups} lastAddedResult={lastAddedResult} isSearching={isSearching} isQuoteLoading={isQuoteLoading} searchError={searchError} quoteError={quoteError} onDraftChange={setDraft} onSearchModeChange={handleSearchModeChange} onQueryChange={(query) => { const trimmedQuery = query.trim(); const minimumSearchLength = getMinimumSearchLength(searchMode); quoteRequestSeqRef.current += 1; lastPreviewRequestKeyRef.current = ""; isManualSymbolRef.current = false; setIsSearching(trimmedQuery.length >= minimumSearchLength); setIsQuoteLoading(false); setResults([]); setEtfResultGroups([]); setSearchError(null); setQuoteError(null); setDraft((currentDraft) => ({ ...currentDraft, query, name: query, symbol: "", providerId: undefined, priceScale: undefined, issuerCountry: undefined, instrumentIdentity: undefined, marketCurrencyConfirmed: undefined, latestPrice: undefined, latestPriceDate: undefined, previousClose: undefined })); }} onSymbolChange={(symbol) => { quoteRequestSeqRef.current += 1; lastPreviewRequestKeyRef.current = ""; isManualSymbolRef.current = true; setIsSearching(false); setIsQuoteLoading(false); setResults([]); setEtfResultGroups([]); setSearchError(null); setQuoteError(null); setDraft((currentDraft) => ({ ...currentDraft, symbol: symbol.toUpperCase(), query: "", name: "", providerId: undefined, priceScale: undefined, issuerCountry: undefined, instrumentIdentity: undefined, marketCurrencyConfirmed: undefined, latestPrice: undefined, latestPriceDate: undefined, previousClose: undefined })); }} onPickResult={(result) => { void handlePickResult(result); }} onReuseLastAddedResult={(result) => { void handlePickResult(result); }} onBuySubmit={() => { void handleAddAsset(); }} onSellSubmit={() => { void handleSellAsset(); }} />}
  </>;

  const portfolioManagement = <section className="panel portfolio-hub-panel workspace-portfolio-manager" aria-busy={isSavingPortfolio || isPortfolioMutationPending}><div className="portfolio-hub-head"><div><p className="eyebrow">Portfele</p><h2 className="section-title">Zarządzaj przestrzenią inwestycji</h2><p className="section-copy">Portfele są niezależnymi rachunkami. Aktywny wybierzesz także w górnym pasku.</p></div><div className="portfolio-hub-actions"><button className="ghost-button" type="button" onClick={handleRenamePortfolio} disabled={isPortfolioMutationPending}>Zmień nazwę</button><button className="ghost-button admin-danger-button" type="button" onClick={() => { void handleDeletePortfolio(); }} disabled={portfolios.length <= 1 || isPortfolioMutationPending}>{isPortfolioMutationPending ? "Zapisywanie…" : "Usuń portfel"}</button><button className="primary-button" type="button" onClick={() => { void handleCreatePortfolio(); }} disabled={isPortfolioMutationPending}>{isPortfolioMutationPending ? "Zapisywanie…" : "Dodaj portfel"}</button></div></div><div className="portfolio-card-grid mt-5">{portfolioSummaries.map(({ portfolio, summary: portfolioSummary }) => { const isActive = portfolio.id === activePortfolioId; return <button key={portfolio.id} type="button" className={`portfolio-switch-card${isActive ? " is-active" : ""}`} onClick={() => { void handleSelectPortfolio(portfolio.id); }} disabled={isPortfolioMutationPending} aria-pressed={isActive}><span>{isActive ? "Aktywny portfel" : "Przełącz"}</span><strong>{portfolio.name}</strong><div><span>{formatCurrency(portfolioSummary.totalValue, portfolioSummary.currency)}</span><span className={portfolioSummary.combinedProfitLoss >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(portfolioSummary.combinedProfitLoss, portfolioSummary.currency)}</span></div><small>{portfolioSummary.currency} · {portfolioSummary.positionsCount} pozycji / {portfolioSummary.salesCount} sprzedaży</small></button>; })}</div></section>;

  const operationsWorkspace = isAllPortfoliosSelected ? <section className="panel"><p className="eyebrow">Operacje</p><h2 className="section-title">Wybierz konkretny portfel</h2><p className="section-copy">Historia i korekty operacji pozostają rozdzielone według portfela w widoku łącznym.</p></section> : <><SalesHistoryPanel sales={sales} baseCurrency={activeBaseCurrency} fxRates={fxRates} canUndoSale={(saleId) => canUndoPortfolioSale(sales, saleId)} onUndoSale={handleUndoSale} /><RealizedAdjustmentsPanel draft={realizedAdjustmentDraft} adjustments={effectiveRealizedAdjustments} error={realizedAdjustmentError} onChange={(nextDraft) => { setRealizedAdjustmentDraft(nextDraft); setRealizedAdjustmentError(null); }} onSubmit={() => { void handleAddRealizedAdjustment(); }} onRemove={handleRemoveRealizedAdjustment} /></>;
  const incomeWorkspace = activePortfolioForEngine ? <PortfolioIncomeWorkspace portfolio={activePortfolioForEngine} fxRates={fxRates} baseCurrency={activeBaseCurrency} onPortfolioChange={handleActivePortfolioCoreModelChange} /> : null;
  const importWorkspace = <BrokerImportPanel onImport={handleImportBrokerOperations} />;
  const wealthWorkspace = <WealthWorkspace profile={profile} fxRates={fxRates} onChange={setProfile} />;
  const settingsWorkspace = <><UserProfilePanel account={account} profile={profile} positionsCount={groupedAssets.length} assetsCount={displayedAssets.length} isLoggingOut={isLoggingOut} onChange={(patch) => setProfile((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))} onReset={() => setProfile((current) => ({ ...current, displayName: "", country: "", preferredBroker: "", investmentGoal: "", monthlyContributionPln: 0, updatedAt: new Date().toISOString() }))} onLogout={() => { void handleLogout(); }} /><ChangePasswordPanel hasPassword={account.hasPassword} /><section className="panel panel-compact workspace-plan-placeholder"><p className="eyebrow">Plan</p><h2 className="section-title">{account.subscriptionPlan === "pro" ? "Mexo Pro" : "Mexo Free"}</h2><p className="section-copy">Zarządzanie płatnościami pozostaje poza tą wersją aplikacji.</p></section></>;

  const workspaceValue: PortfolioWorkspaceValue = {
    account, isAdmin, portfolios, activePortfolio, activePortfolioId, selectedPortfolioId, isAllPortfoliosSelected, activeBaseCurrency, isPortfolioMutationPending, isLoggingOut,
    onPortfolioChange: (portfolioId) => { void handleSelectPortfolio(portfolioId); },
    onBaseCurrencyChange: (currency) => { void handleBaseCurrencyChange(currency); },
    getReadHref: (href) => getWorkspaceReadHref(href, selectedPortfolioId, activeBaseCurrency),
    onQuickAdd: () => { if (requireConcretePortfolioSelection()) router.push("/portfolio/positions?add=asset"); else router.push("/portfolios"); },
    onLogout: () => { void handleLogout(); },
    displayedSyncError, assets: displayedAssets, sales: displayedSales, realizedAdjustments: displayedRealizedAdjustments, effectiveRealizedAdjustments, fxRates, groupedAssets, filter, assetSortMode, isRefreshing,
    summaryTotalValue: summary.totalValue, summaryCombinedProfitLoss: summary.combinedProfitLoss, refreshRevision,
    activeDividendYtd, activeDividendMonth, activeDividendAnnualIncome, summaryPanel, assetEntryWorkspace, operationsWorkspace, incomeWorkspace, importWorkspace, settingsWorkspace, portfolioManagementWorkspace: portfolioManagement, wealthWorkspace,
    onFilterChange: setFilter, onSortModeChange: setAssetSortMode, onReorderGroups: handleReorderAssetGroups, onRemoveAsset: removeAsset,
  };

  return <PortfolioWorkspaceProvider value={workspaceValue}><AppWorkspaceShell account={account} portfolios={portfolios} activePortfolioId={activePortfolioId} selectedPortfolioId={selectedPortfolioId} activeBaseCurrency={activeBaseCurrency} isPortfolioMutationPending={isPortfolioMutationPending} isLoggingOut={isLoggingOut} isAdmin={isAdmin} onPortfolioChange={workspaceValue.onPortfolioChange} onBaseCurrencyChange={workspaceValue.onBaseCurrencyChange} onQuickAdd={workspaceValue.onQuickAdd} onLogout={workspaceValue.onLogout}>{children}</AppWorkspaceShell></PortfolioWorkspaceProvider>;
}
