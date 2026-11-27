import { round } from "@/lib/utils";

/**
 * Kondycja portfela: fixed rules about concentration, currencies, cash and data quality. Every
 * message names the rule that raised it. No models, no forecasts and no advice: the score only
 * counts how many rules fired and how heavy they are.
 */

export type HealthHolding = {
  key: string;
  name: string;
  isEtf: boolean;
  /** Value in the presentation currency; 0 when the holding cannot be valued. */
  value: number;
  isValued: boolean;
  /** Today's change in the presentation currency, when known. */
  dailyChange: number | null;
  profitLossPercent: number | null;
  /** The day of the latest quote; `null` for holdings without a market quote (bonds). */
  priceDate: string | null;
};

export type HealthInput = {
  holdings: HealthHolding[];
  /** Cash of all accounts in the presentation currency, one entry per account. */
  cash: Array<{ account: string; value: number }>;
  /** Currency exposure with ETFs looked through, as shares of the total in percent. */
  currencies: Array<{ id: string; label: string; percent: number }>;
  baseCurrency: string;
  today: string;
};

export type HealthSeverity = "important" | "attention" | "note";

export type HealthFinding = {
  id: string;
  severity: HealthSeverity;
  area: string;
  title: string;
  detail: string;
  rule: string;
};

export const HEALTH_WEIGHTS: Record<HealthSeverity, number> = { important: 20, attention: 10, note: 3 };
export const HEALTH_SEVERITY_LABELS: Record<HealthSeverity, string> = { important: "Ważne", attention: "Uwaga", note: "Obserwacja" };

export const HEALTH_LIMITS = {
  topThreePercent: 60,
  singleStockPercent: 25,
  singleEtfPercent: 35,
  foreignCurrencyPercent: 50,
  cashPercent: 20,
  dailyTopTwoPercent: 60,
  dailyMinimumMovePercent: 0.5,
  lossPercent: -20,
  staleDays: 7,
} as const;

const percent = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const share = (value: number) => `${percent.format(value)}%`;
const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000;

const listNames = (names: string[]) => (names.length > 4 ? `${names.slice(0, 4).join(", ")} i ${names.length - 4} więcej` : names.join(", "));

/** The same instrument held in several portfolios counts once. */
const combine = (holdings: HealthHolding[]) => {
  const combined = new Map<string, HealthHolding>();
  for (const holding of holdings) {
    const current = combined.get(holding.key);
    if (!current) {
      combined.set(holding.key, { ...holding });
      continue;
    }
    current.value += holding.value;
    current.isValued = current.isValued && holding.isValued;
    current.dailyChange = current.dailyChange === null || holding.dailyChange === null ? null : current.dailyChange + holding.dailyChange;
    current.profitLossPercent = current.profitLossPercent === null || holding.profitLossPercent === null ? null : Math.min(current.profitLossPercent, holding.profitLossPercent);
  }
  return [...combined.values()];
};

export const assessPortfolioHealth = ({ holdings: rows, cash, currencies, baseCurrency, today }: HealthInput) => {
  const holdings = combine(rows);
  const findings: HealthFinding[] = [];
  const passed: string[] = [];
  const check = (rule: string, finding: Omit<HealthFinding, "rule"> | null) => {
    if (finding) findings.push({ ...finding, rule });
    else passed.push(rule);
  };

  const cashValue = cash.reduce((sum, item) => sum + item.value, 0);
  const positionsValue = holdings.reduce((sum, item) => sum + item.value, 0);
  const total = positionsValue + Math.max(0, cashValue);
  const of = (value: number) => (total > 0 ? (value / total) * 100 : 0);
  const byValue = [...holdings].sort((left, right) => right.value - left.value);

  const negative = cash.filter((item) => item.value < -0.5);
  check("Żadne konto gotówkowe nie jest poniżej zera.", negative.length === 0 ? null : {
    id: "negative-cash", severity: "important", area: "Dane",
    title: "Gotówka na koncie jest poniżej zera.",
    detail: `Dotyczy: ${listNames(negative.map((item) => item.account))}. Zwykle brakuje wpłaty w historii, więc zwroty i wynik mogą być zawyżone lub zaniżone.`,
  });

  const unvalued = holdings.filter((item) => !item.isValued);
  check("Każda pozycja ma kurs i kurs waluty potrzebny do wyceny.", unvalued.length === 0 ? null : {
    id: "unvalued", severity: "attention", area: "Dane",
    title: "Części pozycji nie da się wycenić.",
    detail: `Bez pełnej wyceny: ${listNames(unvalued.map((item) => item.name))}.`,
  });

  const stale = holdings.filter((item) => item.priceDate && daysBetween(item.priceDate, today) > HEALTH_LIMITS.staleDays);
  check(`Kursy nie są starsze niż ${HEALTH_LIMITS.staleDays} dni.`, stale.length === 0 ? null : {
    id: "stale-prices", severity: "attention", area: "Dane",
    title: "Część kursów jest nieaktualna.",
    detail: `Starsze niż ${HEALTH_LIMITS.staleDays} dni: ${listNames(stale.map((item) => item.name))}.`,
  });

  const topThree = byValue.slice(0, 3);
  const topThreeShare = of(topThree.reduce((sum, item) => sum + item.value, 0));
  check(`Trzy największe pozycje to mniej niż ${HEALTH_LIMITS.topThreePercent}% wartości.`, holdings.length >= 4 && topThreeShare >= HEALTH_LIMITS.topThreePercent ? {
    id: "top-three", severity: "attention", area: "Koncentracja",
    title: "Trzy największe pozycje decydują o portfelu.",
    detail: `${topThree.map((item) => item.name).join(", ")} to razem ${share(topThreeShare)} wartości.`,
  } : null);

  const heavyStocks = byValue.filter((item) => !item.isEtf && of(item.value) >= HEALTH_LIMITS.singleStockPercent);
  check(`Żadna pojedyncza spółka, krypto ani obligacja nie ma ${HEALTH_LIMITS.singleStockPercent}% lub więcej.`, heavyStocks.length === 0 ? null : {
    id: "single-holding", severity: "attention", area: "Koncentracja",
    title: "Jedna pozycja ma duży udział.",
    detail: heavyStocks.map((item) => `${item.name}: ${share(of(item.value))}`).join(", ") + ".",
  });

  const heavyEtfs = byValue.filter((item) => item.isEtf && of(item.value) >= HEALTH_LIMITS.singleEtfPercent);
  check(`Żaden pojedynczy ETF nie ma ${HEALTH_LIMITS.singleEtfPercent}% lub więcej.`, heavyEtfs.length === 0 ? null : {
    id: "single-etf", severity: "note", area: "Koncentracja",
    title: "Duża część portfela jest w jednym ETF-ie.",
    detail: `${heavyEtfs.map((item) => `${item.name}: ${share(of(item.value))}`).join(", ")}. To jeden instrument, ale sam ETF może być szeroko rozłożony na wiele spółek.`,
  });

  const foreign = currencies.filter((item) => /^[A-Z]{3}$/.test(item.id) && item.id !== baseCurrency && item.id !== "PLN" && item.percent >= HEALTH_LIMITS.foreignCurrencyPercent);
  check(`Żadna waluta obca nie ma ${HEALTH_LIMITS.foreignCurrencyPercent}% lub więcej (ETF-y liczone po składzie).`, foreign.length === 0 ? null : {
    id: "currency", severity: "note", area: "Waluty",
    title: "Wartość mocno zależy od jednej waluty obcej.",
    detail: foreign.map((item) => `${item.label}: ${share(item.percent)}`).join(", ") + ". Zmiana jej kursu będzie wyraźnie widoczna w wyniku.",
  });

  check(`Gotówka to mniej niż ${HEALTH_LIMITS.cashPercent}% wartości.`, of(Math.max(0, cashValue)) >= HEALTH_LIMITS.cashPercent ? {
    id: "cash", severity: "note", area: "Gotówka",
    title: "Duża część portfela to gotówka.",
    detail: `Gotówka to ${share(of(Math.max(0, cashValue)))} wartości.`,
  } : null);

  const moved = holdings.filter((item) => item.dailyChange !== null);
  const movement = moved.reduce((sum, item) => sum + Math.abs(item.dailyChange!), 0);
  const movers = [...moved].sort((left, right) => Math.abs(right.dailyChange!) - Math.abs(left.dailyChange!)).slice(0, 2);
  const moversShare = movement > 0 ? (movers.reduce((sum, item) => sum + Math.abs(item.dailyChange!), 0) / movement) * 100 : 0;
  check(`Dzisiejszy ruch nie pochodzi w ${HEALTH_LIMITS.dailyTopTwoPercent}% lub więcej z dwóch walorów.`, moved.length >= 4 && of(movement) >= HEALTH_LIMITS.dailyMinimumMovePercent && moversShare >= HEALTH_LIMITS.dailyTopTwoPercent ? {
    id: "daily-movers", severity: "note", area: "Dzisiejszy ruch",
    title: "Dwa walory odpowiadają za większość dzisiejszej zmiany.",
    detail: `${movers.map((item) => item.name).join(" i ")} to ${share(moversShare)} sumy dzisiejszych zmian.`,
  } : null);

  const losers = holdings.filter((item) => item.profitLossPercent !== null && item.profitLossPercent <= HEALTH_LIMITS.lossPercent);
  check(`Żadna pozycja nie traci ${Math.abs(HEALTH_LIMITS.lossPercent)}% lub więcej od ceny zakupu.`, losers.length === 0 ? null : {
    id: "losses", severity: "note", area: "Wynik pozycji",
    title: losers.length === 1 ? "Jedna pozycja traci dużo od ceny zakupu." : "Kilka pozycji traci dużo od ceny zakupu.",
    detail: `${listNames(losers.map((item) => `${item.name} (${share(item.profitLossPercent!)})`))}.`,
  });

  const order: HealthSeverity[] = ["important", "attention", "note"];
  findings.sort((left, right) => order.indexOf(left.severity) - order.indexOf(right.severity));
  const score = Math.max(0, 100 - findings.reduce((sum, finding) => sum + HEALTH_WEIGHTS[finding.severity], 0));
  const counts = Object.fromEntries(order.map((severity) => [severity, findings.filter((finding) => finding.severity === severity).length])) as Record<HealthSeverity, number>;

  return { score: total > 0 ? score : null, findings: total > 0 ? findings : [], passed: total > 0 ? passed : [], counts, total: round(total, 2) };
};
