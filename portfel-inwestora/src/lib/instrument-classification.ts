import type { AssetKind, InstrumentIdentity, InstrumentType } from "@/types/portfolio";

export type InstrumentClass =
  | "stock"
  | "etf"
  | "bond"
  | "crypto"
  | "cfd"
  | "etc"
  | "etn"
  | "fund"
  | "unverified";

export type InstrumentClassificationInput = {
  kind?: AssetKind | null;
  instrumentType?: InstrumentType | string | null;
  instrumentIdentity?: Partial<InstrumentIdentity> | null;
  isin?: string | null;
  name?: string | null;
};

export const normalizeProviderInstrumentType = (value: unknown): InstrumentType | undefined => {
  const normalized = typeof value === "string"
    ? value.trim().toLocaleUpperCase("en-US").replace(/[ _-]+/g, " ")
    : "";
  if (["ETF", "EXCHANGE TRADED FUND", "EXCHANGE TRADED FUNDS"].includes(normalized)) return "ETF";
  if (["ETC", "EXCHANGE TRADED COMMODITY", "EXCHANGE TRADED COMMODITIES"].includes(normalized)) return "ETC";
  if (["ETN", "EXCHANGE TRADED NOTE", "EXCHANGE TRADED NOTES"].includes(normalized)) return "ETN";
  if (["STOCK", "EQUITY", "SHARE", "COMMON STOCK"].includes(normalized)) return "STOCK";
  if (["BOND", "FIXED INCOME"].includes(normalized)) return "BOND";
  if (["CRYPTO", "CRYPTOCURRENCY", "CRYPTOCURRENCIES"].includes(normalized)) return "CRYPTO";
  if (["FUND", "MUTUAL FUND", "MUTUALFUND", "OPEN END FUND"].includes(normalized)) return "FUND";
  if (["CFD", "CONTRACT FOR DIFFERENCE"].includes(normalized)) return "CFD";
  if (["OTHER", "UNKNOWN", "UNVERIFIED", "ETP"].includes(normalized)) return "OTHER";
  return undefined;
};

const normalizeType = (value: unknown): InstrumentClass | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleUpperCase("en-US").replace(/[ _-]+/g, " ");

  if (["CFD", "CONTRACT FOR DIFFERENCE"].includes(normalized)) return "cfd";
  if (["ETF", "EXCHANGE TRADED FUND", "EXCHANGE TRADED FUNDS"].includes(normalized)) return "etf";
  if (["ETC", "EXCHANGE TRADED COMMODITY", "EXCHANGE TRADED COMMODITIES"].includes(normalized)) return "etc";
  if (["ETN", "EXCHANGE TRADED NOTE", "EXCHANGE TRADED NOTES"].includes(normalized)) return "etn";
  if (["STOCK", "EQUITY", "SHARE"].includes(normalized)) return "stock";
  if (["BOND", "FIXED INCOME", "OBLIGACJA", "OBLIGACJE"].includes(normalized)) return "bond";
  if (["CRYPTO", "CRYPTOCURRENCY", "CRYPTOCURRENCIES"].includes(normalized)) return "crypto";
  if (["FUND", "MUTUAL FUND", "OPEN END FUND"].includes(normalized)) return "fund";
  if (["OTHER", "UNKNOWN", "UNVERIFIED"].includes(normalized)) return "unverified";
  return null;
};

const normalizeSecurityType = (value: unknown): InstrumentClass | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLocaleUpperCase("en-US").replace(/[._-]+/g, " ");

  if (/\b(CFD|CONTRACT FOR DIFFERENCE)\b/.test(normalized)) return "cfd";
  if (/\b(ETC|EXCHANGE TRADED COMMODIT(?:Y|IES))\b/.test(normalized)) return "etc";
  if (/\b(ETN|EXCHANGE TRADED NOTES?)\b/.test(normalized)) return "etn";
  if (/\b(ETF|EXCHANGE TRADED FUNDS?)\b/.test(normalized)) return "etf";
  if (/\b(MUTUAL FUND|OPEN END FUND|FUND)\b/.test(normalized)) return "fund";
  if (/\b(BOND|FIXED INCOME)\b/.test(normalized)) return "bond";
  if (/\b(STOCK|EQUITY|COMMON SHARE|ORDINARY SHARE)\b/.test(normalized)) return "stock";
  return null;
};

const hasStableIdentity = (
  identity: InstrumentClassificationInput["instrumentIdentity"],
  rawIsin?: InstrumentClassificationInput["isin"]
) => {
  const hasVenue = Boolean(
    identity?.exchangeCode?.trim() || identity?.exchange?.trim() || identity?.mic?.trim()
  );
  const isin = rawIsin?.trim().toLocaleUpperCase("en-US") ?? "";
  const hasValidIsin = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin);

  return Boolean(
    identity?.figi?.trim() ||
      identity?.shareClassFigi?.trim() ||
      identity?.compositeFigi?.trim() ||
      (identity?.ticker?.trim() && hasVenue) ||
      (hasValidIsin && hasVenue)
  );
};

/**
 * Resolve the reporting/portfolio class without changing instrument identity.
 * Verified identity metadata wins; conflicting declarations and name-only
 * product hints are deliberately held out of the stock/ETF buckets.
 */
export const classifyInstrument = (input: InstrumentClassificationInput): InstrumentClass => {
  const declared = normalizeType(input.instrumentType);
  const identityType = normalizeType(input.instrumentIdentity?.instrumentType);
  const securityType =
    normalizeSecurityType(input.instrumentIdentity?.securityType2) ??
    normalizeSecurityType(input.instrumentIdentity?.securityType);
  const identityIsVerified = hasStableIdentity(input.instrumentIdentity, input.isin);

  if (declared === "cfd") return "cfd";

  if (identityType && identityIsVerified) {
    // A trusted, venue-aware listing identity outranks a generic legacy type.
    return identityType;
  }

  if (securityType && identityIsVerified) {
    return securityType;
  }

  if (declared && declared !== "stock" && declared !== "unverified") return declared;

  const unresolvedProductIdentity = Boolean(
    !identityIsVerified &&
      (identityType || (securityType && securityType !== "stock"))
  );

  if (unresolvedProductIdentity) return "unverified";

  const hasNameOnlyProductClue = /\b(ETF|ETC|ETN|UCITS|EXCHANGE[- ]TRADED|MUTUAL FUND)\b/i.test(
    input.name?.trim() ?? ""
  );

  if (declared === "stock") {
    // Kind/label disagreement or product-language in a display name indicates
    // a stale/generic tag. Neither signal is enough to call it an ETF.
    return input.kind === "etf" || hasNameOnlyProductClue
      ? "unverified"
      : "stock";
  }

  if (declared === "unverified") return "unverified";

  if (input.kind === "crypto" || input.kind === "bond" || input.kind === "etf") {
    return input.kind;
  }

  // A display name is only a warning that a generic STOCK label may be stale;
  // it is not enough evidence to promote the instrument to ETF.
  if (hasNameOnlyProductClue) return "unverified";

  return input.kind === "stock" ? "stock" : "unverified";
};

export const getInstrumentClassLabel = (instrumentClass: InstrumentClass) => {
  switch (instrumentClass) {
    case "stock": return "Akcje";
    case "etf": return "ETF";
    case "bond": return "Obligacje";
    case "crypto": return "Krypto";
    case "cfd": return "CFD";
    case "etc": return "ETC";
    case "etn": return "ETN";
    case "fund": return "Fundusze";
    case "unverified": return "Niezweryfikowany typ";
  }
};
