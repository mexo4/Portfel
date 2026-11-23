import type { AssetCatalogItem } from "@/types/portfolio";

/**
 * Coins that can be added to a portfolio: each one has a Binance spot pair
 * (USDT) for its price and a CoinGecko id for its history.
 *
 * Why a list and not free CoinGecko search: adding a crypto position needs a
 * live price (like a stock), and a price needs a source that is known to be
 * this very coin. A ticker is not an identity (`ARB`, `PEPE` and `BTC` each
 * exist several times on CoinGecko), so the Binance pair is tied to the
 * CoinGecko id, never to the bare symbol. Anything outside this list is still
 * found through CoinGecko search, but only gets a price when CoinGecko or the
 * Yahoo backup can supply one.
 *
 * Built on 2026-11-23 from Binance spot USDT pairs in TRADING status and the
 * CoinGecko top 200 by market cap. A coin is listed only when its Binance
 * price was within 3% of CoinGecko's, which is what confirms the pair is the
 * same asset. Stablecoins, commodity-backed and tokenised-stock tokens are left
 * out on purpose. `scripts/generate-crypto-catalog.mjs` rebuilds the list.
 */
export type CryptoCatalogEntry = {
  symbol: string;
  name: string;
  coingeckoId: string;
  binancePair: string;
  /** Former names and other spellings people search for. */
  searchTerms?: string[];
};

export const CRYPTO_CATALOG: readonly CryptoCatalogEntry[] = [
  { symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin", binancePair: "BTCUSDT" },
  { symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", binancePair: "ETHUSDT" },
  { symbol: "BNB", name: "BNB", coingeckoId: "binancecoin", binancePair: "BNBUSDT" },
  { symbol: "XRP", name: "XRP", coingeckoId: "ripple", binancePair: "XRPUSDT" },
  { symbol: "SOL", name: "Solana", coingeckoId: "solana", binancePair: "SOLUSDT" },
  { symbol: "TRX", name: "TRON", coingeckoId: "tron", binancePair: "TRXUSDT" },
  { symbol: "HYPE", name: "Hyperliquid", coingeckoId: "hyperliquid", binancePair: "HYPEUSDT" },
  { symbol: "ZEC", name: "Zcash", coingeckoId: "zcash", binancePair: "ZECUSDT" },
  { symbol: "DOGE", name: "Dogecoin", coingeckoId: "dogecoin", binancePair: "DOGEUSDT" },
  { symbol: "LINK", name: "Chainlink", coingeckoId: "chainlink", binancePair: "LINKUSDT" },
  { symbol: "ADA", name: "Cardano", coingeckoId: "cardano", binancePair: "ADAUSDT" },
  { symbol: "XLM", name: "Stellar", coingeckoId: "stellar", binancePair: "XLMUSDT" },
  { symbol: "BCH", name: "Bitcoin Cash", coingeckoId: "bitcoin-cash", binancePair: "BCHUSDT" },
  { symbol: "NEAR", name: "NEAR Protocol", coingeckoId: "near", binancePair: "NEARUSDT" },
  { symbol: "LTC", name: "Litecoin", coingeckoId: "litecoin", binancePair: "LTCUSDT" },
  { symbol: "AVAX", name: "Avalanche", coingeckoId: "avalanche-2", binancePair: "AVAXUSDT" },
  { symbol: "UNI", name: "Uniswap", coingeckoId: "uniswap", binancePair: "UNIUSDT" },
  { symbol: "SUI", name: "Sui", coingeckoId: "sui", binancePair: "SUIUSDT" },
  { symbol: "GRAM", name: "Toncoin", coingeckoId: "the-open-network", binancePair: "GRAMUSDT", searchTerms: ["ton","toncoin","the open network"] },
  { symbol: "HBAR", name: "Hedera", coingeckoId: "hedera-hashgraph", binancePair: "HBARUSDT" },
  { symbol: "QNT", name: "Quant", coingeckoId: "quant-network", binancePair: "QNTUSDT" },
  { symbol: "TAO", name: "Bittensor", coingeckoId: "bittensor", binancePair: "TAOUSDT" },
  { symbol: "SHIB", name: "Shiba Inu", coingeckoId: "shiba-inu", binancePair: "SHIBUSDT" },
  { symbol: "AAVE", name: "Aave", coingeckoId: "aave", binancePair: "AAVEUSDT" },
  { symbol: "PEPE", name: "Pepe", coingeckoId: "pepe", binancePair: "PEPEUSDT" },
  { symbol: "ONDO", name: "Ondo", coingeckoId: "ondo-finance", binancePair: "ONDOUSDT" },
  { symbol: "ENA", name: "Ethena", coingeckoId: "ethena", binancePair: "ENAUSDT" },
  { symbol: "WLFI", name: "World Liberty Financial", coingeckoId: "world-liberty-financial", binancePair: "WLFIUSDT" },
  { symbol: "ASTER", name: "Aster", coingeckoId: "aster-2", binancePair: "ASTERUSDT" },
  { symbol: "DOT", name: "Polkadot", coingeckoId: "polkadot", binancePair: "DOTUSDT" },
  { symbol: "JST", name: "JUST", coingeckoId: "just", binancePair: "JSTUSDT" },
  { symbol: "ICP", name: "Internet Computer", coingeckoId: "internet-computer", binancePair: "ICPUSDT" },
  { symbol: "MORPHO", name: "Morpho", coingeckoId: "morpho", binancePair: "MORPHOUSDT" },
  { symbol: "SKY", name: "Sky", coingeckoId: "sky", binancePair: "SKYUSDT" },
  { symbol: "ETC", name: "Ethereum Classic", coingeckoId: "ethereum-classic", binancePair: "ETCUSDT" },
  { symbol: "WLD", name: "Worldcoin", coingeckoId: "worldcoin-wld", binancePair: "WLDUSDT" },
  { symbol: "PUMP", name: "Pump.fun", coingeckoId: "pump-fun", binancePair: "PUMPUSDT" },
  { symbol: "POL", name: "POL (ex-MATIC)", coingeckoId: "polygon-ecosystem-token", binancePair: "POLUSDT", searchTerms: ["matic","polygon"] },
  { symbol: "JUP", name: "Jupiter", coingeckoId: "jupiter-exchange-solana", binancePair: "JUPUSDT" },
  { symbol: "NIGHT", name: "Midnight", coingeckoId: "midnight-3", binancePair: "NIGHTUSDT" },
  { symbol: "ARB", name: "Arbitrum", coingeckoId: "arbitrum", binancePair: "ARBUSDT" },
  { symbol: "ALGO", name: "Algorand", coingeckoId: "algorand", binancePair: "ALGOUSDT" },
  { symbol: "RENDER", name: "Render", coingeckoId: "render-token", binancePair: "RENDERUSDT", searchTerms: ["rndr"] },
  { symbol: "ATOM", name: "Cosmos Hub", coingeckoId: "cosmos", binancePair: "ATOMUSDT" },
  { symbol: "INJ", name: "Injective", coingeckoId: "injective-protocol", binancePair: "INJUSDT" },
  { symbol: "NEXO", name: "NEXO", coingeckoId: "nexo", binancePair: "NEXOUSDT" },
  { symbol: "ETHFI", name: "Ether.fi", coingeckoId: "ether-fi", binancePair: "ETHFIUSDT" },
  { symbol: "CAKE", name: "PancakeSwap", coingeckoId: "pancakeswap-token", binancePair: "CAKEUSDT" },
  { symbol: "STX", name: "Stacks", coingeckoId: "blockstack", binancePair: "STXUSDT", searchTerms: ["stacks"] },
  { symbol: "ZRO", name: "LayerZero", coingeckoId: "layerzero", binancePair: "ZROUSDT" },
  { symbol: "FIL", name: "Filecoin", coingeckoId: "filecoin", binancePair: "FILUSDT" },
  { symbol: "DASH", name: "Dash", coingeckoId: "dash", binancePair: "DASHUSDT" },
  { symbol: "VET", name: "VeChain", coingeckoId: "vechain", binancePair: "VETUSDT" },
  { symbol: "PYTH", name: "Pyth Network", coingeckoId: "pyth-network", binancePair: "PYTHUSDT" },
  { symbol: "RAY", name: "Raydium", coingeckoId: "raydium", binancePair: "RAYUSDT" },
  { symbol: "FF", name: "Falcon Finance", coingeckoId: "falcon-finance-ff", binancePair: "FFUSDT" },
  { symbol: "APT", name: "Aptos", coingeckoId: "aptos", binancePair: "APTUSDT" },
  { symbol: "TIA", name: "Celestia", coingeckoId: "celestia", binancePair: "TIAUSDT" },
  { symbol: "KITE", name: "Kite", coingeckoId: "kite-2", binancePair: "KITEUSDT" },
  { symbol: "AERO", name: "Aero", coingeckoId: "aero", binancePair: "AEROUSDT" },
  { symbol: "CRV", name: "Curve DAO", coingeckoId: "curve-dao-token", binancePair: "CRVUSDT" },
  { symbol: "PENGU", name: "Pudgy Penguins", coingeckoId: "pudgy-penguins", binancePair: "PENGUUSDT" },
  { symbol: "SUN", name: "Sun Token", coingeckoId: "sun-token", binancePair: "SUNUSDT" },
  { symbol: "FET", name: "Artificial Superintelligence Alliance", coingeckoId: "fetch-ai", binancePair: "FETUSDT", searchTerms: ["asi","fetch"] },
  { symbol: "VIRTUAL", name: "Virtuals Protocol", coingeckoId: "virtual-protocol", binancePair: "VIRTUALUSDT" },
  { symbol: "TRUMP", name: "Official Trump", coingeckoId: "official-trump", binancePair: "TRUMPUSDT" },
  { symbol: "STRK", name: "Starknet", coingeckoId: "starknet", binancePair: "STRKUSDT" },
  { symbol: "GNO", name: "Gnosis", coingeckoId: "gnosis", binancePair: "GNOUSDT" },
  { symbol: "SEI", name: "Sei", coingeckoId: "sei-network", binancePair: "SEIUSDT" },
  { symbol: "XTZ", name: "Tezos", coingeckoId: "tezos", binancePair: "XTZUSDT" },
  { symbol: "PENDLE", name: "Pendle", coingeckoId: "pendle", binancePair: "PENDLEUSDT" },
  { symbol: "LUNC", name: "Terra Luna Classic", coingeckoId: "terra-luna", binancePair: "LUNCUSDT", searchTerms: ["luna classic"] },
  { symbol: "XPL", name: "Plasma", coingeckoId: "plasma", binancePair: "XPLUSDT" },
  { symbol: "LDO", name: "Lido DAO", coingeckoId: "lido-dao", binancePair: "LDOUSDT" },
  { symbol: "BONK", name: "Bonk", coingeckoId: "bonk", binancePair: "BONKUSDT" },
  { symbol: "KAIA", name: "Kaia", coingeckoId: "kaia", binancePair: "KAIAUSDT" },
  { symbol: "GRT", name: "The Graph", coingeckoId: "the-graph", binancePair: "GRTUSDT" },
  { symbol: "DCR", name: "Decred", coingeckoId: "decred", binancePair: "DCRUSDT" },
  { symbol: "COMP", name: "Compound", coingeckoId: "compound-governance-token", binancePair: "COMPUSDT" },
  { symbol: "CFX", name: "Conflux", coingeckoId: "conflux-token", binancePair: "CFXUSDT" },
  { symbol: "RUNE", name: "THORChain", coingeckoId: "thorchain", binancePair: "RUNEUSDT" },
  { symbol: "OP", name: "Optimism", coingeckoId: "optimism", binancePair: "OPUSDT" },
  { symbol: "FLOKI", name: "FLOKI", coingeckoId: "floki", binancePair: "FLOKIUSDT" },
  { symbol: "AR", name: "Arweave", coingeckoId: "arweave", binancePair: "ARUSDT" },
  { symbol: "JASMY", name: "JasmyCoin", coingeckoId: "jasmycoin", binancePair: "JASMYUSDT" },
  { symbol: "ZAMA", name: "Zama", coingeckoId: "zama", binancePair: "ZAMAUSDT" },
  { symbol: "ENS", name: "Ethereum Name Service", coingeckoId: "ethereum-name-service", binancePair: "ENSUSDT" },
  { symbol: "IOTA", name: "IOTA", coingeckoId: "iota", binancePair: "IOTAUSDT", searchTerms: ["miota"] },
  { symbol: "KMNO", name: "Kamino", coingeckoId: "kamino", binancePair: "KMNOUSDT" },
  { symbol: "SENT", name: "Sentient", coingeckoId: "sentient", binancePair: "SENTUSDT" },
  { symbol: "JTO", name: "Jito", coingeckoId: "jito-governance-token", binancePair: "JTOUSDT" },
  { symbol: "TWT", name: "Trust Wallet", coingeckoId: "trust-wallet-token", binancePair: "TWTUSDT" },
  { symbol: "THETA", name: "Theta Network", coingeckoId: "theta-token", binancePair: "THETAUSDT" },
];

/** `BTC` -> `bitcoin`. Symbols are unique within the catalogue. */
export const CRYPTO_COINGECKO_ID_BY_SYMBOL: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(CRYPTO_CATALOG.map((entry) => [entry.symbol, entry.coingeckoId]))
);

/** `bitcoin` -> `BTCUSDT`. The pair is looked up by coin id, not by ticker. */
export const CRYPTO_BINANCE_PAIR_BY_COINGECKO_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(CRYPTO_CATALOG.map((entry) => [entry.coingeckoId, entry.binancePair]))
);

/** The catalogue in the shape the add-asset search uses for local results. */
export const CRYPTO_ASSET_CATALOG: AssetCatalogItem[] = CRYPTO_CATALOG.map((entry) => ({
  symbol: entry.symbol,
  name: entry.name,
  kind: "crypto" as const,
  marketCurrency: "USD" as const,
  provider: "coingecko" as const,
  providerId: entry.coingeckoId,
  subtitle: "Binance · CoinGecko",
  searchTerms: [entry.coingeckoId, ...(entry.searchTerms ?? [])],
}));
