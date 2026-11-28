/*
 * Is every report of the exchange lists in Mexo? After each archive walk the lists that were read
 * are compared with the stored reports, and the walk itself is checked: it has to reach the date it
 * set out for. The comparison goes by the lists' own report ids and deliberately does not use the
 * rules that decide which rows are one report, so a fault in those rules shows up here.
 */

export type EspiMissingReason =
  /** The report's page was read but gave nothing: empty at the source, or its layout changed. */
  | "UNREADABLE"
  /** The report's page could not be fetched. */
  | "UNAVAILABLE"
  /** The report was read but saving it failed. */
  | "NOT_SAVED"
  /** Nothing failed, yet the report is not there: the usual sign of a faulty rule. */
  | "UNEXPLAINED";

export type EspiMissingReport = {
  sourceId: string;
  sourceUrl: string;
  issuerName: string;
  publishedAt?: string;
  reportNumber?: string;
  reason: EspiMissingReason;
};

export type EspiMarketCoverage = {
  market: "GPW" | "NEWCONNECT";
  /** Reports the walked list showed since the date the walk set out for. */
  listed: number;
  /** The oldest publication date the walk saw. */
  oldestDate?: string;
  reached: boolean;
};

export type EspiCompletenessCheck = {
  kind: "full" | "recent";
  checkedAt: string;
  from: string;
  /** False when errors of the list itself cut the walk short. */
  walkComplete: boolean;
  markets: EspiMarketCoverage[];
  listed: number;
  missingCount: number;
  /** The first of the missing ones, newest first. */
  missing: EspiMissingReport[];
};

export const ESPI_MISSING_SHOWN = 50;

export const ESPI_MISSING_REASONS: Record<EspiMissingReason, string> = {
  UNREADABLE: "strona raportu nie daje się odczytać (pusta u źródła albo zmieniony układ)",
  UNAVAILABLE: "strony raportu nie udało się pobrać",
  NOT_SAVED: "raportu nie udało się zapisać",
  UNEXPLAINED: "brak bez znanej przyczyny — możliwy błąd w regułach Mexo",
};

const MARKET_LABELS = { GPW: "GPW", NEWCONNECT: "NewConnect" } as const;
const HOUR_MS = 60 * 60 * 1_000;
/** A walk is due daily; with room for retries, this long without a check means the sync stands. */
const CHECK_OVERDUE_MS = 36 * HOUR_MS;
const FULL_CHECK_OVERDUE_MS = 8 * 24 * HOUR_MS;

export const assessEspiCompleteness = (checks: EspiCompletenessCheck[], now = Date.now()) => {
  const findings: string[] = [];
  const latest = [...checks].sort((left, right) => right.checkedAt.localeCompare(left.checkedAt));
  const full = latest.find((check) => check.kind === "full");
  if (latest.length === 0) {
    findings.push("Nie wykonano jeszcze żadnego sprawdzenia. Pierwsze pojawi się po pierwszym przejściu archiwum.");
  } else if (now - Date.parse(latest[0]!.checkedAt) > CHECK_OVERDUE_MS) {
    findings.push("Od ponad 36 godzin nie było sprawdzenia: pobieranie raportów mogło się zatrzymać.");
  }
  if (latest.length > 0 && (!full || now - Date.parse(full.checkedAt) > FULL_CHECK_OVERDUE_MS)) {
    findings.push(full ? "Pełne sprawdzenie 12 miesięcy ma ponad 8 dni." : "Nie wykonano jeszcze pełnego sprawdzenia 12 miesięcy.");
  }
  for (const check of latest) {
    const name = check.kind === "full" ? "pełne sprawdzenie" : "sprawdzenie ostatnich dni";
    if (!check.walkComplete) findings.push(`Błędy listy przerwały przegląd (${name} od ${check.from}). Zostanie powtórzony.`);
    for (const market of check.markets) {
      if (!market.reached) {
        findings.push(`${MARKET_LABELS[market.market]}: przegląd listy ${market.oldestDate ? `skończył się na ${market.oldestDate}` : "nie pokazał żadnego raportu"}, a miał sięgnąć przed ${check.from} (${name}).`);
      }
    }
    if (check.missingCount > 0) {
      const unexplained = check.missing.filter((item) => item.reason === "UNEXPLAINED").length;
      findings.push(`Brakuje raportów z list: ${check.missingCount} z ${check.listed} (${name})${unexplained ? `, w tym bez znanej przyczyny: ${unexplained}${check.missingCount > check.missing.length ? " wśród pokazanych" : ""}` : ""}.`);
    }
  }
  return { level: findings.length === 0 ? ("OK" as const) : ("ATTENTION" as const), findings };
};
