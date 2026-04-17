import type {
  AssetCatalogItem,
  AssetDraft,
  AssetKind,
  AssetSearchMode,
  CurrencyCode,
  InvestorExperience,
  QuoteProvider,
} from "@/types/portfolio";

export const APP_NAME = "Portfel inwestora";
export const APP_DESCRIPTION =
  "MVP do sledzenia akcji, ETF-ow i krypto z wycena w PLN.";

export const BASE_CURRENCY: CurrencyCode = "PLN";
export const AUTO_REFRESH_INTERVAL_MS = 30_000;
export const SEARCH_DEBOUNCE_MS = 300;

export const SUPPORTED_CURRENCIES: CurrencyCode[] = [
  "PLN",
  "USD",
  "EUR",
  "GBP",
  "CHF",
  "CAD",
  "JPY",
];

export const INVESTOR_EXPERIENCE_OPTIONS: Array<{
  value: InvestorExperience;
  label: string;
}> = [
  { value: "beginner", label: "Poczatkujacy" },
  { value: "intermediate", label: "Sredniozaawansowany" },
  { value: "advanced", label: "Zaawansowany" },
];

export const KIND_LABELS: Record<AssetKind, string> = {
  stock: "Akcje",
  etf: "ETF",
  crypto: "Krypto",
};

export const SEARCH_MODE_OPTIONS: Array<{
  value: AssetSearchMode;
  label: string;
  kind: AssetKind;
  provider: QuoteProvider;
  purchaseCurrency: CurrencyCode;
  marketCurrency: CurrencyCode;
}> = [
  {
    value: "stock-global",
    label: "Akcje amerykanskie",
    kind: "stock",
    provider: "finnhub",
    purchaseCurrency: "USD",
    marketCurrency: "USD",
  },
  {
    value: "stock-gpw",
    label: "Akcje GPW",
    kind: "stock",
    provider: "stooq",
    purchaseCurrency: "PLN",
    marketCurrency: "PLN",
  },
  {
    value: "etf",
    label: "ETF",
    kind: "etf",
    provider: "eodhd",
    purchaseCurrency: "USD",
    marketCurrency: "USD",
  },
  {
    value: "crypto",
    label: "Krypto",
    kind: "crypto",
    provider: "coingecko",
    purchaseCurrency: "USD",
    marketCurrency: "USD",
  },
];

export const LOCAL_STOCK_CATALOG: AssetCatalogItem[] = [
  {
    symbol: "AAPL",
    name: "Apple",
    kind: "stock",
    marketCurrency: "USD",
    provider: "finnhub",
    searchTerms: ["apple", "aapl", "iphone", "nasdaq"],
    subtitle: "NASDAQ",
  },
  {
    symbol: "MSFT",
    name: "Microsoft",
    kind: "stock",
    marketCurrency: "USD",
    provider: "finnhub",
    searchTerms: ["microsoft", "msft", "azure", "windows"],
    subtitle: "NASDAQ",
  },
  {
    symbol: "NVDA",
    name: "NVIDIA",
    kind: "stock",
    marketCurrency: "USD",
    provider: "finnhub",
    searchTerms: ["nvidia", "nvda", "gpu", "ai"],
    subtitle: "NASDAQ",
  },
  {
    symbol: "PKN.WA",
    name: "Orlen",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["orlen", "pkn", "pkn.wa", "orlen sa", "wse"],
    subtitle: "GPW · PKN",
  },
  {
    symbol: "CDR.WA",
    name: "CD Projekt",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["cd projekt", "cdr", "cyberpunk", "wiedzmin"],
    subtitle: "GPW",
  },
  {
    symbol: "KGH.WA",
    name: "KGHM",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["kghm", "miedz", "kopalnie"],
    subtitle: "GPW",
  },
  {
    symbol: "KRU.WA",
    name: "Kruk",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["kruk", "kru", "kruk sa", "windykacja", "wierzytelnosci"],
    subtitle: "GPW",
  },
  {
    symbol: "XTB.WA",
    name: "XTB",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["xtb", "xtb.wa", "xtb sa", "broker", "trading"],
    subtitle: "GPW",
  },
  {
    symbol: "ALE.WA",
    name: "Allegro",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["allegro", "ale", "ecommerce"],
    subtitle: "GPW",
  },
  {
    symbol: "PZU.WA",
    name: "PZU",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["pzu", "ubezpieczenia"],
    subtitle: "GPW",
  },
  {
    symbol: "DNP.WA",
    name: "Dino Polska",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["dino", "dnp", "dino polska"],
    subtitle: "GPW",
  },
  {
    symbol: "PEO.WA",
    name: "Bank Pekao",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["pekao", "peo", "bank pekao"],
    subtitle: "GPW",
  },
  {
    symbol: "SPL.WA",
    name: "Santander Bank Polska",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["santander", "spl", "bank zachodni"],
    subtitle: "GPW",
  },
  {
    symbol: "MBK.WA",
    name: "mBank",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["mbank", "mbk", "bank"],
    subtitle: "GPW",
  },
  {
    symbol: "PKO.WA",
    name: "PKO BP",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["pko", "pkobp", "bank"],
    subtitle: "GPW",
  },
    {
    symbol: "EEE.PL",
    name: "Ekipa",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    searchTerms: ["ekipa"],
    subtitle: "GPW",
  },
];

export const LOCAL_ETF_CATALOG: AssetCatalogItem[] = [
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    kind: "etf",
    marketCurrency: "USD",
    provider: "finnhub",
    searchTerms: ["spy", "sp500", "s&p 500", "spdr"],
    subtitle: "USA",
  },
  {
    symbol: "VWCE.DE",
    name: "Vanguard FTSE All-World UCITS ETF",
    kind: "etf",
    marketCurrency: "EUR",
    provider: "stooq",
    searchTerms: ["vwce", "all world", "vanguard", "ucits"],
    subtitle: "Xetra",
  },
  {
    symbol: "SXR8.DE",
    name: "iShares Core S&P 500 UCITS ETF",
    kind: "etf",
    marketCurrency: "EUR",
    provider: "stooq",
    searchTerms: ["sxr8", "sp500", "ishares", "ucits"],
    subtitle: "Xetra",
  },
  {
    symbol: "IWDA.AS",
    name: "iShares Core MSCI World UCITS ETF",
    kind: "etf",
    marketCurrency: "EUR",
    provider: "stooq",
    searchTerms: ["iwda", "msci world", "ishares", "ucits"],
    subtitle: "Amsterdam",
  },
  {
    symbol: "QQQ",
    name: "Invesco QQQ Trust",
    kind: "etf",
    marketCurrency: "USD",
    provider: "finnhub",
    searchTerms: ["qqq", "nasdaq 100", "invesco"],
    subtitle: "USA",
  },
];

export const FALLBACK_FX_RATES = {
  PLN: 1,
  USD: 4.0,
  EUR: 4.3,
} satisfies Record<CurrencyCode, number>;

export const DEFAULT_DRAFT_BY_KIND: Record<AssetKind, AssetDraft> = {
  stock: {
    kind: "stock",
    query: "",
    name: "",
    symbol: "",
    purchaseDate: "",
    quantity: 0,
    quantityInput: "",
    purchasePrice: 0,
    purchasePriceInput: "",
    purchaseCurrency: "PLN",
    feePln: 0,
    marketCurrency: "PLN",
    provider: "catalog",
  },
  etf: {
    kind: "etf",
    query: "",
    name: "",
    symbol: "",
    purchaseDate: "",
    quantity: 0,
    quantityInput: "",
    purchasePrice: 0,
    purchasePriceInput: "",
    purchaseCurrency: "USD",
    feePln: 0,
    marketCurrency: "USD",
    provider: "eodhd",
  },
  crypto: {
    kind: "crypto",
    query: "",
    name: "",
    symbol: "",
    purchaseDate: "",
    quantity: 0,
    quantityInput: "",
    purchasePrice: 0,
    purchasePriceInput: "",
    purchaseCurrency: "USD",
    feePln: 0,
    marketCurrency: "USD",
    provider: "coingecko",
  },
};
