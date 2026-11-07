/** A second, deliberately smaller interpretation lane for official GPW report
 * schedules. It never calls the calendar parser or authorizes a data repair. */

const monthNumbers = new Map(Object.entries({
  stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6,
  lipca: 7, sierpnia: 8, września: 9, pazdziernika: 10, października: 10,
  listopada: 11, grudnia: 12,
}));
const datePattern = /\b(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})\b|\b(\d{1,2})\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|pazdziernika|listopada|grudnia)\s+(20\d{2})\b/giu;
const normalize = (value) => value.replace(/ł/gu, "l").replace(/Ł/gu, "L")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();
const decode = (value) => value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&(?:nbsp|amp|lt|gt|quot|apos|oacute|aogon|cacute|eogon|lstrok|nacute|sacute|zacute|zdot);/gi,
    (entity) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
      "&apos;": "'", "&oacute;": "ó", "&aogon;": "ą", "&cacute;": "ć", "&eogon;": "ę",
      "&lstrok;": "ł", "&nacute;": "ń", "&sacute;": "ś", "&zacute;": "ź", "&zdot;": "ż" })[entity.toLowerCase()] ?? entity);

export function extractOfficialGpwReport(html) {
  const marker = html.search(/Treść raportu\s*:/iu);
  if (marker < 0 || !/Raporty Spółek ESPI\/EBI/iu.test(html)) return null;
  const tail = html.slice(marker);
  const nextSheet = tail.search(/<h4\b[^>]*>\s*Nazwa arkusza\s*:/iu);
  const bodyHtml = tail.slice(0, nextSheet < 0 ? 50_000 : nextSheet);
  const body = decode(bodyHtml.replace(/\s*\r?\n\s*/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<\/?(?:tr|p|div|br|li)\b[^>]*>/giu, "\n")
    .replace(/<[^>]*>/g, " ")).split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean).join("\n").slice(0, 25_000);
  const header = decode(html.slice(0, marker).replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
  const isin = header.match(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/u)?.[0] ?? null;
  const reportNumber = header.match(/Raport bieżący nr\s*(\d+\s*\/\s*20\d{2})/iu)?.[1]?.replace(/\s+/g, "") ?? null;
  const publication = header.match(/\b(\d{2})-(\d{2})-(20\d{2})\s+(\d{2}:\d{2}:\d{2})\s*\|/u);
  return { isin, reportNumber, sourcePublishedAt: publication
    ? `${publication[3]}-${publication[2]}-${publication[1]} ${publication[4]} Europe/Warsaw` : null,
  body };
}

function isoDate(match) {
  const day = Number(match[1] ?? match[4]);
  const month = match[2] ? Number(match[2]) : monthNumbers.get(match[5]?.toLowerCase());
  const year = Number(match[3] ?? match[6]);
  if (!month) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}

/** Role names describe evidence in the surrounding source clause, not a guess
 * based on where the date falls relative to today's date. */
export function inspectSourceDates(body) {
  const mentions = [];
  for (const line of body.split(/\n+/)) {
    for (const match of line.matchAll(datePattern)) {
      const date = isoDate(match);
      if (!date) continue;
      const before = normalize(line.slice(Math.max(0, match.index - 180), match.index));
      const after = normalize(line.slice(match.index + match[0].length, match.index + match[0].length + 100));
      let role = "CONTEXT_UNKNOWN";
      if (/(?:rozporzadzeni|ustaw|dyrektyw|dz\.? u\.?|podstawa prawna).{0,140}\b(?:z dnia|dnia)\s*$/u.test(before)) role = "LEGAL_ACT";
      else if (/(?:rok obrotow|rok finansow|okres sprawozdawcz|trwajac|obejmujac).{0,150}\b(?:do|konczac sie|zakonczon)\s*$/u.test(before) ||
        /\bod\s+\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2}\s*[-–—]\s*$/u.test(before)) role = "FISCAL_PERIOD_END";
      else if (/\b(?:zamiast|poprzedni termin|pierwotny termin|termin.{0,150}wyznaczony.{0,100}na dzien)\s*$/u.test(before)) role = "REPLACED_PUBLICATION";
      else if (/(?:zostanie opublikowan|zostanie przekazan|termin (?:publikacji|przekazania)|publikacj|przekazani)[^.!?]{0,100}(?:w dniu|dnia|na dzien|-)\s*$/u.test(before) ||
        /(?:^|[;:])\s*$/u.test(before) && /\b(?:raport|sprawozdani)\b/u.test(after)) role = "REPORT_PUBLICATION";
      else if ((/\b(?:raport|sprawozdani)\b.{0,250}\s[-–—]\s*(?:w dniu|dnia)?\s*$/u.test(before) ||
        /^[-–—]?\s*za\s+(?:[ivx1-4]+\.?\s+)?(?:kw\.|kwart|polroc|rok)/u.test(normalize(line)) &&
          /\s[-–—]\s*(?:w dniu|dnia)?\s*$/u.test(before) ||
        /\bza\s+(?:[ivx1-4]+\.?\s+)?(?:kw\.|kwart|polroc|rok).{0,160}\s[-–—]\s*(?:w dniu|dnia)?\s*$/u.test(before) ||
        /\b(?:termin|harmonogram).{0,180}\s[-–—]\s*$/u.test(before)) &&
        !/\b(?:ustaw|rozporzadzeni).{0,100}\s[-–—]\s*$/u.test(before) ||
        /^\s*[-–—]\s*(?:(?:skonsolidowany|jednostkowy)\s+)?(?:raport|sprawozdani)\b/u.test(after)) role = "REPORT_PUBLICATION";
      mentions.push({ date, role, context: line.slice(Math.max(0, match.index - 220),
        Math.min(line.length, match.index + match[0].length + 100)).trim() });
    }
  }
  return mentions;
}

const identityParts = (identity) => {
  const [type, period, year] = (identity ?? "").split(":");
  return { type, period, year };
};
const reportTypeWord = { QUARTERLY_REPORT: /kwartaln|kwartal|kwart|kw\./u,
  HALF_YEAR_REPORT: /polroczn|polrocz|polrocze|polrocza/u,
  ANNUAL_REPORT: /roczn|raport za rok|rok obrotow/u };
const periodWord = { Q1: /(?:\bi\b|\b1\b|pierwsz)[^.!?]{0,16}(?:kwart|kw\.)|\bq1\b/u,
  Q2: /(?:\bii\b|\b2\b|drug)[^.!?]{0,16}(?:kwart|kw\.)|\bq2\b/u,
  Q3: /(?:\biii\b|\b3\b|trzec)[^.!?]{0,16}(?:kwart|kw\.)|\bq3\b|trzy kwart/u,
  Q4: /(?:\biv\b|\b4\b|czwart)[^.!?]{0,16}(?:kwart|kw\.)|\bq4\b/u,
  H1: /polrocze|polroczn|polrocza/u, FY: /roczn|rok obrotow/u };

const fiscalContext = (value) => normalize(value)
  .replace(/\b\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2}\b/gu, " ")
  .replace(/\b\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrzesnia|pazdziernika|listopada|grudnia)\s+20\d{2}\b/gu, " ");

const hasIdentityOnPublicationClause = (identity, evidence, eventType) => {
  const clause = fiscalContext(evidence);
  if (!(reportTypeWord[eventType]?.test(clause) ?? false)) return false;
  if (identity.period && !(periodWord[identity.period]?.test(clause) ?? false)) return false;
  if (!identity.year) return true;
  const [firstYear, lastYear] = identity.year.split("/");
  const fiscalYear = lastYear
    ? `${firstYear}[/–-](?:${lastYear}|${lastYear.slice(-2)})` : firstYear;
  return new RegExp(`\\b${fiscalYear}\\b`, "u").test(clause);
};

/** Conservative source-to-projection comparison. REVIEW never means approval. */
export function compareOfficialSource(action, source, relatedActions = []) {
  if (!source?.body) return { status: "SOURCE_UNAVAILABLE", reason: "OFFICIAL_BODY_UNAVAILABLE", evidence: null, dates: [] };
  const dates = inspectSourceDates(source.body);
  const before = action.before ?? {};
  const after = action.after ?? {};
  const targetDate = after.eventDate ?? before.eventDate;
  const relevant = dates.filter((item) => item.date === targetDate);
  const publication = relevant.filter((item) => item.role === "REPORT_PUBLICATION");
  const issuer = action.issuerIsin;
  if (issuer && source.isin && issuer !== source.isin)
    return { status: "CONFLICT", reason: "ISSUER_ISIN_MISMATCH", evidence: null, dates: relevant };
  if (issuer && !source.isin)
    return { status: "NEEDS_REVIEW", reason: "ISSUER_ISIN_NOT_CONFIRMED", evidence: null, dates: relevant };
  const identity = identityParts(after.identity);
  const publicationMatches = publication.some((item) =>
    hasIdentityOnPublicationClause(identity, item.context, action.eventType));
  const keeper = relatedActions.find((item) => item.issuerId === action.issuerId &&
    item.eventType === action.eventType && item.after?.active === true &&
    item.after?.eventDate === targetDate && item.eventId !== action.eventId);
  if (action.decision === "DEACTIVATE") {
    const contextual = relevant.find((item) => ["LEGAL_ACT", "FISCAL_PERIOD_END"].includes(item.role));
    if (contextual && !publication.length)
      return { status: "NEEDS_REVIEW", reason: `CONTEXT_DATE_NOT_PUBLICATION:${contextual.role}`,
        evidence: contextual.context, dates: relevant, keeperId: keeper?.eventId ?? null };
    if (!keeper) return { status: "NEEDS_REVIEW", reason: "NO_CONFIRMED_ACTIVE_KEEPER", evidence: null, dates: relevant };
    if (!publication.length)
      return { status: "NEEDS_REVIEW", reason: "KEEPER_PUBLICATION_NOT_INDEPENDENTLY_CONFIRMED",
        evidence: relevant[0]?.context ?? null, dates: relevant, keeperId: keeper.eventId };
    const keeperIdentity = identityParts(keeper.after?.identity);
    if (!publication.some((item) =>
      hasIdentityOnPublicationClause(keeperIdentity, item.context, keeper.eventType)))
      return { status: "NEEDS_REVIEW", reason: "KEEPER_PERIOD_NOT_CONFIRMED",
        evidence: publication[0].context, dates: relevant, keeperId: keeper.eventId };
    return { status: "AUTO_EVIDENCE_MATCH", reason: "OFFICIAL_PUBLICATION_AND_ACTIVE_KEEPER",
      evidence: publication[0].context, dates: relevant, keeperId: keeper.eventId };
  }
  if (!relevant.length) return { status: "CONFLICT", reason: "PROPOSED_DATE_ABSENT_FROM_SOURCE",
    evidence: dates.find((item) => item.role === "REPORT_PUBLICATION")?.context ?? dates[0]?.context ?? null, dates };
  if (!publicationMatches)
    return { status: "NEEDS_REVIEW", reason: "DATE_ROLE_OR_REPORT_TYPE_NOT_CONFIRMED",
      evidence: relevant[0].context, dates: relevant };
  if (action.decision === "UPDATE" && before.eventDate !== after.eventDate) {
    const old = dates.filter((item) => item.date === before.eventDate);
    if (!old.some((item) => item.role === "REPLACED_PUBLICATION"))
      return { status: "NEEDS_REVIEW", reason: "PRIOR_DATE_NOT_EXPLICITLY_REPLACED",
        evidence: publication[0].context, dates: [...old, ...relevant] };
  }
  return { status: "AUTO_EVIDENCE_MATCH", reason: "EXPLICIT_OFFICIAL_PUBLICATION_MATCH",
    evidence: publication[0].context, dates: relevant };
}
