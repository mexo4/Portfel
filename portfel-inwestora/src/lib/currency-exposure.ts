import { round } from "@/lib/utils";
import type { EtfCurrencyProfile, EtfCurrencyWeight } from "@/types/portfolio";

/**
 * Currency exposure with look-through for ETFs. A share or bond counts in its quote currency and
 * cash in its own. An ETF counts by what it holds: the split the user saved from the fund's
 * factsheet, or, where the index in its name trades in a single currency by definition, that
 * currency. No other split is guessed; an ETF without one is shown as such.
 */

type Preset = { weights: EtfCurrencyWeight[]; source: string };

/** Indices whose every constituent is quoted in one currency. */
const SINGLE_CURRENCY_INDICES: Array<{ pattern: RegExp; currency: string; index: string }> = [
  { pattern: /s\s*&\s*p\s*500\b|\bsp\s?500\b/i, currency: "USD", index: "S&P 500" },
  { pattern: /nasdaq[\s-]*100\b/i, currency: "USD", index: "Nasdaq-100" },
  { pattern: /dow\s*jones\s*industrial/i, currency: "USD", index: "Dow Jones Industrial Average" },
  { pattern: /russell\s*(1000|2000|3000)\b/i, currency: "USD", index: "Russell" },
  { pattern: /msci\s*usa\b/i, currency: "USD", index: "MSCI USA" },
  { pattern: /\b[ms]?wig(20|40|80)?(tr)?\b|etfbw20|etfbm40|etfbs80/i, currency: "PLN", index: "indeksy GPW" },
  { pattern: /\bm?dax\b|euro\s*stoxx/i, currency: "EUR", index: "indeks strefy euro" },
  { pattern: /ftse\s*(100|250)\b/i, currency: "GBP", index: "FTSE 100 / 250" },
  { pattern: /nikkei|\btopix\b|msci\s*japan\b/i, currency: "JPY", index: "indeksy japońskie" },
  { pattern: /\bsmi\b/i, currency: "CHF", index: "SMI" },
];

const HEDGED = /\bhedged\b|\bhdg\b|\bhgd\b/i;
const HEDGED_TO = /\b(PLN|EUR|USD|GBP|CHF)[\s-]*(?:hedged|hdg|hgd)\b|\b(?:hedged|hdg)[\s-]*(?:to\s*)?(PLN|EUR|USD|GBP|CHF)\b/i;
/** Bond funds follow bond indices, whatever other index their name mentions. */
const BOND_FUND = /\b(bond|treasury|gilt|bund|credit|obligacj\w*)\b/i;

export const detectEtfCurrencyPreset = (name: string): Preset | null => {
  const hedged = name.match(HEDGED_TO);
  if (hedged) {
    const currency = (hedged[1] ?? hedged[2])!.toUpperCase();
    return { weights: [{ currency, percent: 100 }], source: `fundusz zabezpieczony walutowo do ${currency} (z nazwy)` };
  }
  // Hedged to an unnamed currency, or a bond fund: nothing to take from the name.
  if (HEDGED.test(name) || BOND_FUND.test(name)) return null;
  const match = SINGLE_CURRENCY_INDICES.find((item) => item.pattern.test(name));
  return match ? { weights: [{ currency: match.currency, percent: 100 }], source: `${match.index}: wszystkie spółki w ${match.currency}` } : null;
};

export type ExposureHolding = { key: string; name: string; instrumentClass: string; currency: string; value: number };

export type ExposureBucket = { id: string; label: string; value: number; percent: number };

export type ExposureEtf = {
  key: string;
  name: string;
  value: number;
  weights: EtfCurrencyWeight[] | null;
  origin: "saved" | "preset" | "missing";
  source: string;
};

export const ETF_WITHOUT_SPLIT = "etf-unknown";

export const buildCurrencyExposure = ({
  holdings,
  cash,
  profiles,
}: {
  holdings: ExposureHolding[];
  cash: Array<{ currency: string; value: number }>;
  profiles: EtfCurrencyProfile[];
}) => {
  const buckets = new Map<string, { label: string; value: number }>();
  const add = (id: string, label: string, value: number) => {
    const current = buckets.get(id);
    buckets.set(id, { label, value: (current?.value ?? 0) + value });
  };
  const etfs = new Map<string, ExposureEtf>();
  const saved = new Map(profiles.map((profile) => [profile.key, profile]));

  for (const holding of holdings) {
    if (!(holding.value > 0)) continue;
    if (holding.instrumentClass === "crypto") {
      add("crypto", "Kryptowaluty", holding.value);
      continue;
    }
    if (holding.instrumentClass !== "etf") {
      add(holding.currency, holding.currency, holding.value);
      continue;
    }
    const profile = saved.get(holding.key);
    const preset = profile ? null : detectEtfCurrencyPreset(holding.name);
    const weights = profile?.weights ?? preset?.weights ?? null;
    const existing = etfs.get(holding.key);
    etfs.set(holding.key, {
      key: holding.key,
      name: holding.name,
      value: (existing?.value ?? 0) + holding.value,
      weights,
      origin: profile ? "saved" : preset ? "preset" : "missing",
      source: profile ? "skład zapisany przez Ciebie" : preset?.source ?? `notowany w ${holding.currency}; składu nie znamy`,
    });
    if (!weights) {
      add(ETF_WITHOUT_SPLIT, "ETF bez podanego składu", holding.value);
      continue;
    }
    let covered = 0;
    for (const weight of weights) {
      add(weight.currency, weight.currency, (holding.value * weight.percent) / 100);
      covered += weight.percent;
    }
    if (covered < 99.5) add("other", "Inne waluty", (holding.value * (100 - covered)) / 100);
  }

  let negativeCash = 0;
  for (const item of cash) {
    if (item.value > 0) add(item.currency, item.currency, item.value);
    else negativeCash += item.value;
  }

  const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.value, 0);
  const trailing = ["other", "crypto", ETF_WITHOUT_SPLIT];
  const rows: ExposureBucket[] = [...buckets.entries()]
    .map(([id, bucket]) => ({ id, label: bucket.label, value: round(bucket.value, 2), percent: total > 0 ? round((bucket.value / total) * 100, 2) : 0 }))
    .filter((bucket) => bucket.value >= 0.005)
    .sort((left, right) => trailing.indexOf(left.id) - trailing.indexOf(right.id) || right.value - left.value);

  return {
    buckets: rows,
    etfs: [...etfs.values()].sort((left, right) => right.value - left.value),
    total: round(total, 2),
    negativeCash: round(negativeCash, 2),
  };
};
