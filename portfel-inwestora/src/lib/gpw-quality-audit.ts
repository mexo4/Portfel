import {
  getCorporateEventIdentityKey,
  type ParsedCorporateEvent,
} from "@/lib/corporate-events";

/**
 * Deterministic, side-effect-free quality controls for the GPW calendar.
 *
 * This module deliberately knows nothing about individual issuers.  It can be
 * used with checked-in source annotations, a staging source inventory, or a
 * future read-only production export.  It never fetches a document and never
 * writes an event: discovery, synchronization and remediation stay explicit
 * operator actions in the server layer.
 */

export const GPW_AUDIT_FIELDS = [
  "eventType", "eventDate", "previousEventDate", "fiscalPeriod", "fiscalYear", "fiscalYearLabel",
  "periodStart", "periodEnd", "reportScope", "generalMeetingType", "eventTime", "registrationDate",
  "recordDate", "paymentDate", "dividendPerShare", "dividendTotalPerShare", "dividendCurrency",
  "dividendInstallment", "dividendStatus", "isScheduleChange",
] as const satisfies readonly (keyof ParsedCorporateEvent)[];

export type GpwAuditField = (typeof GPW_AUDIT_FIELDS)[number];

export type GpwAuditDocument = {
  id: string;
  group: string;
  issuer: string;
  sourceUrl?: string;
  publishedAt?: string;
  sourceKind?: string;
  parserInput?: string;
  expectedEvents?: ReadonlyArray<Partial<ParsedCorporateEvent>>;
  /** The source could be fetched but has no extractable main body yet. */
  fetchStatus?: "DISCOVERED" | "FETCHED" | "PARTIAL" | "REJECTED" | "UNAVAILABLE";
  /** Human annotation was deliberately left unresolved. */
  ambiguous?: boolean;
  annotation?: string;
};

export type GpwAuditAnomalyCode =
  | "WRONG_REPORT_PERIOD"
  | "WRONG_FISCAL_YEAR"
  | "WRONG_PUBLICATION_DATE"
  | "PERIOD_END_MISTAKEN_FOR_PUBLICATION"
  | "WRONG_EVENT_TYPE"
  | "MISSED_CORRECTION"
  | "STALE_PROJECTION"
  | "CACHE_MISMATCH"
  | "MISSING_SOURCE_DOCUMENT"
  | "PARSER_FALSE_POSITIVE"
  | "PARSER_FALSE_NEGATIVE"
  | "DUPLICATE_LOGICAL_EVENT"
  | "AMBIGUOUS_EVENT_IDENTITY"
  | "UNLINKED_SOURCE_PROJECTION"
  | "TIMEZONE_CONFLICT"
  | "SOURCE_DOCUMENT_CONTRADICTION"
  | "INCOMPLETE_DOCUMENT"
  | "UNSUPPORTED_ANNOTATION";

export type GpwAuditClassification =
  | "PARSER_ERROR"
  | "SYNCHRONIZATION_ERROR"
  | "REPROJECTION_ERROR"
  | "PRESENTATION_OR_CACHE_ERROR"
  | "INCOMPLETE_DOCUMENT"
  | "SOURCE_DOCUMENT_CONTRADICTION"
  | "VALID_UNUSUAL_CASE"
  | "REQUIRES_REVIEW";

export type GpwAuditFinding = {
  id: string;
  code: GpwAuditAnomalyCode;
  classification: GpwAuditClassification;
  confidence: "CONFIRMED" | "HIGH" | "MEDIUM" | "REVIEW";
  documentId: string;
  sourceUrl?: string;
  issuer: string;
  component: "PARSER" | "SYNC" | "PROJECTION" | "CACHE" | "SOURCE" | "ANNOTATION";
  message: string;
  eventIdentity?: string;
  expected?: Partial<ParsedCorporateEvent>;
  actual?: ParsedCorporateEvent;
  suggestedAction: string;
};

export type GpwAuditMatch = {
  expectedIndex?: number;
  actualIndex?: number;
  expected?: Partial<ParsedCorporateEvent>;
  actual?: ParsedCorporateEvent;
  score: number;
  mismatchedFields: GpwAuditField[];
  status: "MATCH" | "FIELD_MISMATCH" | "MISSING" | "UNEXPECTED" | "AMBIGUOUS";
};

export type GpwAuditDocumentResult = {
  document: GpwAuditDocument;
  actualEvents: ParsedCorporateEvent[];
  matches: GpwAuditMatch[];
  findings: GpwAuditFinding[];
};

export type GpwAuditCategoryMetrics = {
  expected: number;
  actual: number;
  /** Detected with the correct type and publication date. */
  truePositives: number;
  /** Fully equal to the independently annotated fields. */
  exactMatches: number;
  fieldMismatches: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  dateAccuracy: { correct: number; total: number; accuracy: number | null };
  periodAccuracy: { correct: number; total: number; accuracy: number | null };
  fiscalYearAccuracy: { correct: number; total: number; accuracy: number | null };
  correctionAccuracy: { correct: number; total: number; accuracy: number | null };
};

export type GpwAuditReport = {
  schemaVersion: 1;
  scope: {
    documents: number;
    issuers: number;
    sourceLinkedDocuments: number;
    ambiguousDocuments: number;
    groups: Record<string, number>;
    coverage: "FIXTURE_ONLY" | "SOURCE_INVENTORY" | "PROJECTION_COMPARISON";
    limitations: string[];
  };
  totals: {
    expectedEvents: number;
    actualEvents: number;
    documentPass: number;
    documentFail: number;
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  };
  metricsByCategory: Record<"reports" | "meetings" | "dividends", GpwAuditCategoryMetrics>;
  findings: GpwAuditFinding[];
  documents: GpwAuditDocumentResult[];
};

export type GpwParser = (value: string) => ParsedCorporateEvent[];

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const isReport = (event: Pick<ParsedCorporateEvent, "eventType">) =>
  event.eventType === "QUARTERLY_REPORT" || event.eventType === "HALF_YEAR_REPORT" || event.eventType === "ANNUAL_REPORT";

export const getGpwAuditCategory = (event: Pick<ParsedCorporateEvent, "eventType">) => {
  if (isReport(event)) return "reports" as const;
  if (event.eventType === "GENERAL_MEETING") return "meetings" as const;
  return "dividends" as const;
};

const stableEventValue = (event: Partial<ParsedCorporateEvent>) =>
  GPW_AUDIT_FIELDS
    .filter((field) => event[field] !== undefined)
    .map((field) => `${field}=${String(event[field])}`)
    .join("|");

const numberEquals = (left: unknown, right: unknown) =>
  typeof left === "number" && typeof right === "number" && Math.abs(left - right) < 0.000_001;

export const getGpwAuditMismatchedFields = (
  expected: Partial<ParsedCorporateEvent>,
  actual: ParsedCorporateEvent,
): GpwAuditField[] => GPW_AUDIT_FIELDS.filter((field) => {
  if (expected[field] === undefined) return false;
  const left = expected[field];
  const right = actual[field];
  return typeof left === "number" ? !numberEquals(left, right) : left !== right;
});

/** Score only semantically comparable events.  The weights keep date and
 * event type dominant while still allowing the audit to explain a field-level
 * mismatch instead of reporting a misleading pair of missing/extra rows. */
export const getGpwAuditMatchScore = (
  expected: Partial<ParsedCorporateEvent>,
  actual: ParsedCorporateEvent,
) => {
  let score = 0;
  if (expected.eventType === actual.eventType) score += 100;
  if (expected.eventDate === actual.eventDate) score += 90;
  if (expected.fiscalPeriod !== undefined && expected.fiscalPeriod === actual.fiscalPeriod) score += 35;
  if (expected.fiscalYear !== undefined && expected.fiscalYear === actual.fiscalYear) score += 35;
  if (expected.fiscalYearLabel !== undefined && expected.fiscalYearLabel === actual.fiscalYearLabel) score += 35;
  if (expected.generalMeetingType !== undefined && expected.generalMeetingType === actual.generalMeetingType) score += 35;
  if (expected.dividendInstallment !== undefined && expected.dividendInstallment === actual.dividendInstallment) score += 35;
  if (expected.previousEventDate !== undefined && expected.previousEventDate === actual.previousEventDate) score += 20;
  if (expected.recordDate !== undefined && expected.recordDate === actual.recordDate) score += 20;
  if (expected.paymentDate !== undefined && expected.paymentDate === actual.paymentDate) score += 20;
  return score;
};

const sourceIdentity = (event: Pick<ParsedCorporateEvent, "eventType" | "fiscalPeriod" | "fiscalYear" | "fiscalYearLabel" | "eventIdentity">) =>
  getCorporateEventIdentityKey(event);

const hasUsableExpectedIdentity = (event: Partial<ParsedCorporateEvent>) =>
  typeof event.eventType === "string" && typeof event.eventDate === "string" && isValidIsoDate(event.eventDate);

/**
 * Deterministic global candidate ordering avoids a document-order dependent
 * greedy match.  The parser produces only a handful of rows per source, so
 * this transparent maximum-first matching is easier to audit than a hidden
 * heuristic. Ties are broken by canonical source identity and indices.
 */
export const matchGpwAuditEvents = (
  expectedEvents: readonly Partial<ParsedCorporateEvent>[],
  actualEvents: readonly ParsedCorporateEvent[],
): GpwAuditMatch[] => {
  const candidatePairs = expectedEvents.flatMap((expected, expectedIndex) => actualEvents.map((actual, actualIndex) => ({
    expected,
    actual,
    expectedIndex,
    actualIndex,
    score: getGpwAuditMatchScore(expected, actual),
    identity: `${sourceIdentity(expected as ParsedCorporateEvent)}|${sourceIdentity(actual)}`,
  }))).filter((candidate) => candidate.score >= 100);

  candidatePairs.sort((left, right) =>
    right.score - left.score || left.identity.localeCompare(right.identity) ||
    left.expectedIndex - right.expectedIndex || left.actualIndex - right.actualIndex);

  const matchedExpected = new Set<number>();
  const matchedActual = new Set<number>();
  const matched: GpwAuditMatch[] = [];
  for (const candidate of candidatePairs) {
    if (matchedExpected.has(candidate.expectedIndex) || matchedActual.has(candidate.actualIndex)) continue;
    matchedExpected.add(candidate.expectedIndex);
    matchedActual.add(candidate.actualIndex);
    const mismatchedFields = getGpwAuditMismatchedFields(candidate.expected, candidate.actual);
    matched.push({
      expectedIndex: candidate.expectedIndex,
      actualIndex: candidate.actualIndex,
      expected: candidate.expected,
      actual: candidate.actual,
      score: candidate.score,
      mismatchedFields,
      status: mismatchedFields.length ? "FIELD_MISMATCH" : "MATCH",
    });
  }

  for (const [expectedIndex, expected] of expectedEvents.entries()) {
    if (matchedExpected.has(expectedIndex)) continue;
    matched.push({ expectedIndex, expected, score: 0, mismatchedFields: [], status: "MISSING" });
  }
  for (const [actualIndex, actual] of actualEvents.entries()) {
    if (matchedActual.has(actualIndex)) continue;
    matched.push({ actualIndex, actual, score: 0, mismatchedFields: [], status: "UNEXPECTED" });
  }

  return matched.sort((left, right) =>
    (left.expectedIndex ?? Number.MAX_SAFE_INTEGER) - (right.expectedIndex ?? Number.MAX_SAFE_INTEGER) ||
    (left.actualIndex ?? Number.MAX_SAFE_INTEGER) - (right.actualIndex ?? Number.MAX_SAFE_INTEGER));
};

const finding = (input: Omit<GpwAuditFinding, "id">): GpwAuditFinding => ({
  ...input,
  id: [input.documentId, input.code, input.eventIdentity ?? "document", stableEventValue(input.expected ?? input.actual ?? {})]
    .filter(Boolean).join(":"),
});

const mismatchCode = (fields: readonly GpwAuditField[]): GpwAuditAnomalyCode => {
  if (fields.includes("fiscalPeriod")) return "WRONG_REPORT_PERIOD";
  if (fields.includes("fiscalYear") || fields.includes("fiscalYearLabel")) return "WRONG_FISCAL_YEAR";
  if (fields.includes("eventDate")) return "WRONG_PUBLICATION_DATE";
  if (fields.includes("eventType")) return "WRONG_EVENT_TYPE";
  if (fields.includes("previousEventDate") || fields.includes("isScheduleChange")) return "MISSED_CORRECTION";
  if (fields.includes("eventTime")) return "TIMEZONE_CONFLICT";
  return "UNSUPPORTED_ANNOTATION";
};

const mismatchCodes = (fields: readonly GpwAuditField[]): GpwAuditAnomalyCode[] => {
  const codes = new Set<GpwAuditAnomalyCode>();
  if (fields.includes("fiscalPeriod")) codes.add("WRONG_REPORT_PERIOD");
  if (fields.includes("fiscalYear") || fields.includes("fiscalYearLabel")) codes.add("WRONG_FISCAL_YEAR");
  if (fields.includes("eventDate")) codes.add("WRONG_PUBLICATION_DATE");
  if (fields.includes("eventType")) codes.add("WRONG_EVENT_TYPE");
  if (fields.includes("previousEventDate") || fields.includes("isScheduleChange")) codes.add("MISSED_CORRECTION");
  if (fields.includes("eventTime")) codes.add("TIMEZONE_CONFLICT");
  return codes.size ? [...codes] : [mismatchCode(fields)];
};

const classifyMismatch = (code: GpwAuditAnomalyCode): GpwAuditClassification => {
  if (code === "TIMEZONE_CONFLICT") return "REQUIRES_REVIEW";
  if (code === "UNSUPPORTED_ANNOTATION") return "REQUIRES_REVIEW";
  return "PARSER_ERROR";
};

const isValidIsoDate = (value: string | undefined) => {
  if (!value || !isoDate.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const reviewCode = (event: ParsedCorporateEvent): GpwAuditAnomalyCode => {
  const reasons = event.reviewReasons?.join(" ").toUpperCase() ?? "";
  if (reasons.includes("FISCAL") || reasons.includes("YEAR") || reasons.includes("PERIOD")) return "WRONG_FISCAL_YEAR";
  if (reasons.includes("ZONE") || reasons.includes("TIME")) return "TIMEZONE_CONFLICT";
  return "SOURCE_DOCUMENT_CONTRADICTION";
};

const semanticIdentity = (event: ParsedCorporateEvent) => [
  event.eventType,
  event.fiscalPeriod ?? "",
  event.fiscalYearLabel ?? event.fiscalYear ?? "",
  event.generalMeetingType ?? "",
  event.dividendInstallment ?? "",
].join(":");

const documentFindings = (
  document: GpwAuditDocument,
  actualEvents: readonly ParsedCorporateEvent[],
  matches: readonly GpwAuditMatch[],
): GpwAuditFinding[] => {
  const findings: GpwAuditFinding[] = [];
  const expectedEvents = document.expectedEvents ?? [];

  if (!document.sourceUrl || !/^https:\/\//.test(document.sourceUrl)) {
    findings.push(finding({
      code: "MISSING_SOURCE_DOCUMENT", classification: "INCOMPLETE_DOCUMENT", confidence: "HIGH",
      documentId: document.id, issuer: document.issuer, component: "SOURCE",
      message: "Dokument audytowy nie ma weryfikowalnego adresu HTTPS źródła.",
      suggestedAction: "Uzupełnij kanoniczny oficjalny URL i dowód anotacji przed użyciem dokumentu jako gold set.",
    }));
  }
  if (!document.parserInput?.trim() || document.fetchStatus === "PARTIAL" || document.fetchStatus === "UNAVAILABLE") {
    findings.push(finding({
      code: document.parserInput?.trim() ? "INCOMPLETE_DOCUMENT" : "MISSING_SOURCE_DOCUMENT",
      classification: "INCOMPLETE_DOCUMENT", confidence: "HIGH", documentId: document.id,
      sourceUrl: document.sourceUrl, issuer: document.issuer, component: "SOURCE",
      message: "Źródło nie ma kompletnego tekstu możliwego do audytu parsera.",
      suggestedAction: "Zachowaj stan pobrania i skieruj dokument do ponownego pobrania lub ręcznej weryfikacji, bez tworzenia wydarzenia.",
    }));
  }

  for (const match of matches) {
    if (match.status === "MISSING" && match.expected) {
      findings.push(finding({
        code: "PARSER_FALSE_NEGATIVE", classification: "PARSER_ERROR", confidence: document.ambiguous ? "REVIEW" : "CONFIRMED",
        documentId: document.id, sourceUrl: document.sourceUrl, issuer: document.issuer, component: "PARSER",
        message: "Źródłowo opisane wydarzenie nie zostało wyemitowane przez parser.",
        eventIdentity: sourceIdentity(match.expected as ParsedCorporateEvent), expected: match.expected,
        suggestedAction: "Odtwórz na źródłowym fragmencie; popraw regułę semantyczną, nie dodawaj wyjątku emitenta.",
      }));
    } else if (match.status === "UNEXPECTED" && match.actual) {
      findings.push(finding({
        code: "PARSER_FALSE_POSITIVE", classification: "PARSER_ERROR", confidence: document.ambiguous ? "REVIEW" : "CONFIRMED",
        documentId: document.id, sourceUrl: document.sourceUrl, issuer: document.issuer, component: "PARSER",
        message: "Parser wygenerował wydarzenie nieobecne w niezależnej anotacji dokumentu.",
        eventIdentity: sourceIdentity(match.actual), actual: match.actual,
        suggestedAction: "Sprawdź wiązanie semantyczne daty i kontekst źródłowy; nie usuwaj danych w projekcji bez dowodu.",
      }));
    } else if (match.status === "FIELD_MISMATCH" && match.expected && match.actual) {
      for (const code of mismatchCodes(match.mismatchedFields)) {
        findings.push(finding({
          code, classification: classifyMismatch(code), confidence: document.ambiguous ? "REVIEW" : "CONFIRMED",
          documentId: document.id, sourceUrl: document.sourceUrl, issuer: document.issuer, component: "PARSER",
          message: `Różnica pól: ${match.mismatchedFields.join(", ")}.`,
          eventIdentity: sourceIdentity(match.actual), expected: match.expected, actual: match.actual,
          suggestedAction: "Porównaj z cytowanym fragmentem źródła; napraw wspólną regułę wykrywania okresu/daty/tożsamości.",
        }));
      }
    }
  }

  const exactEvents = new Map<string, ParsedCorporateEvent[]>();
  const semanticEvents = new Map<string, ParsedCorporateEvent[]>();
  for (const event of actualEvents) {
    const exactKey = `${semanticIdentity(event)}:${event.eventDate}:${event.eventTime ?? ""}`;
    exactEvents.set(exactKey, [...(exactEvents.get(exactKey) ?? []), event]);
    const semanticKey = semanticIdentity(event);
    semanticEvents.set(semanticKey, [...(semanticEvents.get(semanticKey) ?? []), event]);

    if (!isValidIsoDate(event.eventDate)) {
      findings.push(finding({
        code: "WRONG_PUBLICATION_DATE", classification: "PARSER_ERROR", confidence: "CONFIRMED",
        documentId: document.id, sourceUrl: document.sourceUrl, issuer: document.issuer, component: "PARSER",
        message: `Parser zwrócił nieprawidłową datę wydarzenia: ${event.eventDate}.`, eventIdentity: sourceIdentity(event), actual: event,
        suggestedAction: "Napraw walidację dat na etapie parsera; nie próbuj korygować projekcji.",
      }));
    }
    if (event.previousEventDate === event.eventDate) {
      findings.push(finding({
        code: "MISSED_CORRECTION", classification: "PARSER_ERROR", confidence: "CONFIRMED",
        documentId: document.id, sourceUrl: document.sourceUrl, issuer: document.issuer, component: "PARSER",
        message: "Korekta wskazuje identyczny stary i nowy termin.", eventIdentity: sourceIdentity(event), actual: event,
        suggestedAction: "Wymagaj różnych, źródłowo zakotwiczonych dat przed oznaczeniem zmiany harmonogramu.",
      }));
    }
    if (event.requiresReview) {
      const code = reviewCode(event);
      findings.push(finding({
        code, classification: "REQUIRES_REVIEW", confidence: "REVIEW", documentId: document.id,
        sourceUrl: document.sourceUrl, issuer: document.issuer, component: "PARSER",
        message: `Parser oznaczył wydarzenie do weryfikacji: ${(event.reviewReasons ?? ["brak powodu"]).join(", ")}.`,
        eventIdentity: sourceIdentity(event), actual: event,
        suggestedAction: "Nie podnoś automatycznie statusu do potwierdzonego; zachowaj dowód źródłowy i prześlij do kolejki przeglądu.",
      }));
    }
    if (event.periodEnd && event.eventDate === event.periodEnd) {
      findings.push(finding({
        code: "PERIOD_END_MISTAKEN_FOR_PUBLICATION", classification: "REQUIRES_REVIEW", confidence: "MEDIUM",
        documentId: document.id, sourceUrl: document.sourceUrl, issuer: document.issuer, component: "PARSER",
        message: "Termin publikacji jest identyczny z końcem okresu; wymaga źródłowego potwierdzenia.",
        eventIdentity: sourceIdentity(event), actual: event,
        suggestedAction: "Sprawdź, czy data jest wyraźnie powiązana z publikacją/przekazaniem, a nie wyłącznie z okresem sprawozdawczym.",
      }));
    }
  }

  for (const [key, events] of exactEvents) {
    if (events.length < 2) continue;
    findings.push(finding({
      code: "DUPLICATE_LOGICAL_EVENT", classification: "PARSER_ERROR", confidence: "CONFIRMED",
      documentId: document.id, sourceUrl: document.sourceUrl, issuer: document.issuer, component: "PARSER",
      message: `Parser wygenerował ${events.length} identyczne logicznie wydarzenia (${key}).`,
      eventIdentity: sourceIdentity(events[0]!), actual: events[0],
      suggestedAction: "Deduplikuj po stabilnej tożsamości źródłowej, ale zachowaj odrębne raty dywidendy i spotkania o różnych godzinach.",
    }));
  }
  for (const [key, events] of semanticEvents) {
    const dates = new Set(events.map((event) => event.eventDate));
    if (dates.size < 2 || events.some((event) => event.isScheduleChange || event.previousEventDate)) continue;
    findings.push(finding({
      code: "AMBIGUOUS_EVENT_IDENTITY", classification: "REQUIRES_REVIEW", confidence: "MEDIUM",
      documentId: document.id, sourceUrl: document.sourceUrl, issuer: document.issuer, component: "PARSER",
      message: `Jedna tożsamość semantyczna (${key}) ma wiele terminów bez jawnej korekty.`,
      eventIdentity: sourceIdentity(events[0]!), actual: events[0],
      suggestedAction: "Porównaj dokumenty i historię korekt; nie scalaj automatycznie wydarzeń tylko dlatego, że dotyczą tego samego okresu.",
    }));
  }

  if (expectedEvents.length === 0 && actualEvents.length > 0 && /(?:korekta|correction)/iu.test(document.parserInput ?? "")) {
    findings.push(finding({
      code: "PARSER_FALSE_POSITIVE", classification: "PARSER_ERROR", confidence: document.ambiguous ? "REVIEW" : "HIGH",
      documentId: document.id, sourceUrl: document.sourceUrl, issuer: document.issuer, component: "PARSER",
      message: "Dokument kontrolny bez wydarzenia wygenerował wpis kalendarza.", actual: actualEvents[0],
      eventIdentity: sourceIdentity(actualEvents[0]!),
      suggestedAction: "Wymagaj formalnej relacji między semantyką wydarzenia i datą; sama wzmianka o WZA/raporcie nie wystarcza.",
    }));
  }

  return findings;
};

const zeroMetrics = (): GpwAuditCategoryMetrics => ({
  expected: 0, actual: 0, truePositives: 0, exactMatches: 0, fieldMismatches: 0, falsePositives: 0, falseNegatives: 0,
  precision: null, recall: null, f1: null,
  dateAccuracy: { correct: 0, total: 0, accuracy: null },
  periodAccuracy: { correct: 0, total: 0, accuracy: null },
  fiscalYearAccuracy: { correct: 0, total: 0, accuracy: null },
  correctionAccuracy: { correct: 0, total: 0, accuracy: null },
});

const ratio = (correct: number, total: number) => total ? Number((correct / total).toFixed(6)) : null;

const addAccuracy = (
  target: GpwAuditCategoryMetrics["dateAccuracy"],
  matches: readonly GpwAuditMatch[],
  fields: readonly GpwAuditField[],
) => {
  for (const match of matches) {
    if (!match.expected || !match.actual) continue;
    const relevant = fields.some((field) => match.expected![field] !== undefined);
    if (!relevant) continue;
    target.total += 1;
    if (fields.every((field) => match.expected![field] === undefined || !match.mismatchedFields.includes(field))) {
      target.correct += 1;
    }
  }
};

const finalizeMetrics = (metrics: GpwAuditCategoryMetrics) => {
  metrics.falseNegatives = metrics.expected - metrics.truePositives;
  metrics.falsePositives = metrics.actual - metrics.truePositives;
  metrics.precision = ratio(metrics.truePositives, metrics.actual);
  metrics.recall = ratio(metrics.truePositives, metrics.expected);
  metrics.f1 = metrics.precision !== null && metrics.recall !== null && metrics.precision + metrics.recall > 0
    ? Number((2 * metrics.precision * metrics.recall / (metrics.precision + metrics.recall)).toFixed(6))
    : metrics.precision === 0 || metrics.recall === 0 ? 0 : null;
  for (const accuracy of [metrics.dateAccuracy, metrics.periodAccuracy, metrics.fiscalYearAccuracy, metrics.correctionAccuracy]) {
    accuracy.accuracy = ratio(accuracy.correct, accuracy.total);
  }
};

export const auditGpwDocuments = (
  documents: readonly GpwAuditDocument[],
  parser: GpwParser,
): GpwAuditReport => {
  const results = documents.map((document) => {
    const actualEvents = document.parserInput ? parser(document.parserInput) : [];
    const expectedEvents = document.expectedEvents ?? [];
    const validExpectedEvents = expectedEvents.filter(hasUsableExpectedIdentity);
    const matches = matchGpwAuditEvents(validExpectedEvents, actualEvents);
    const findings = documentFindings(document, actualEvents, matches);
    for (const expected of expectedEvents.filter((event) => !hasUsableExpectedIdentity(event))) {
      findings.push(finding({
        code: "UNSUPPORTED_ANNOTATION", classification: "INCOMPLETE_DOCUMENT", confidence: "HIGH",
        documentId: document.id, sourceUrl: document.sourceUrl, issuer: document.issuer, component: "ANNOTATION",
        message: "Anotacja oczekiwanego wydarzenia nie ma poprawnego typu i daty ISO.", expected,
        suggestedAction: "Uzupełnij niezależnie zweryfikowaną anotację przed wykorzystaniem dokumentu jako wzorca jakości.",
      }));
    }
    return { document, actualEvents, matches, findings };
  });
  const categories: GpwAuditReport["metricsByCategory"] = {
    reports: zeroMetrics(), meetings: zeroMetrics(), dividends: zeroMetrics(),
  };
  for (const result of results) {
    const expected = (result.document.expectedEvents ?? []).filter(hasUsableExpectedIdentity);
    for (const event of expected) categories[getGpwAuditCategory(event as ParsedCorporateEvent)].expected += 1;
    for (const event of result.actualEvents) categories[getGpwAuditCategory(event)].actual += 1;
    for (const match of result.matches) {
      if (!match.expected || !match.actual) continue;
      const category = categories[getGpwAuditCategory(match.expected as ParsedCorporateEvent)];
      if (!match.mismatchedFields.includes("eventType") && !match.mismatchedFields.includes("eventDate")) {
        category.truePositives += 1;
      }
      if (match.status === "MATCH") category.exactMatches += 1;
      if (match.status === "FIELD_MISMATCH") category.fieldMismatches += 1;
    }
    for (const [categoryName, category] of Object.entries(categories) as [keyof typeof categories, GpwAuditCategoryMetrics][]) {
      const categoryMatches = result.matches.filter((match) => match.expected &&
        getGpwAuditCategory(match.expected as ParsedCorporateEvent) ===
          categoryName);
      addAccuracy(category.dateAccuracy, categoryMatches, ["eventDate"]);
      addAccuracy(category.periodAccuracy, categoryMatches, ["fiscalPeriod"]);
      addAccuracy(category.fiscalYearAccuracy, categoryMatches, ["fiscalYear", "fiscalYearLabel"]);
      addAccuracy(category.correctionAccuracy, categoryMatches, ["previousEventDate", "isScheduleChange"]);
    }
  }
  for (const metrics of Object.values(categories)) finalizeMetrics(metrics);
  const expectedEvents = results.reduce((total, result) => total +
    (result.document.expectedEvents?.filter(hasUsableExpectedIdentity).length ?? 0), 0);
  const actualEvents = results.reduce((total, result) => total + result.actualEvents.length, 0);
  const truePositives = Object.values(categories).reduce((total, metric) => total + metric.truePositives, 0);
  const falsePositives = actualEvents - truePositives;
  const falseNegatives = expectedEvents - truePositives;
  const precision = ratio(truePositives, actualEvents);
  const recall = ratio(truePositives, expectedEvents);
  const f1 = precision !== null && recall !== null && precision + recall > 0
    ? Number((2 * precision * recall / (precision + recall)).toFixed(6))
    : precision === 0 || recall === 0 ? 0 : null;
  const groups = Object.fromEntries([...new Set(documents.map((document) => document.group))]
    .sort().map((group) => [group, documents.filter((document) => document.group === group).length]));
  const findings = results.flatMap((result) => result.findings);
  return {
    schemaVersion: 1,
    scope: {
      documents: documents.length,
      issuers: new Set(documents.map((document) => document.issuer)).size,
      sourceLinkedDocuments: documents.filter((document) => /^https:\/\//.test(document.sourceUrl ?? "")).length,
      ambiguousDocuments: documents.filter((document) => document.ambiguous).length,
      groups,
      coverage: "FIXTURE_ONLY",
      limitations: [
        "Fixture audit is deterministic parser evidence, not proof of complete GPW market coverage.",
        "A document marked ambiguous or incomplete is retained as review evidence and never auto-corrected.",
        "Projection, cache and live-source findings require an explicit read-only inventory or isolated database input.",
      ],
    },
    totals: {
      expectedEvents, actualEvents,
      documentPass: results.filter((result) => result.matches.every((match) => match.status === "MATCH")).length,
      documentFail: results.filter((result) => result.matches.some((match) => match.status !== "MATCH")).length,
      truePositives, falsePositives, falseNegatives, precision, recall, f1,
    },
    metricsByCategory: categories,
    findings,
    documents: results,
  };
};

export type GpwProjectionSnapshot = {
  id: string;
  documentId?: string;
  issuer: string;
  identity: string;
  eventDate: string;
  status?: string;
  sourceUrl?: string;
  sourceUrls?: readonly string[];
  sourceUpdatedAt?: string;
  projectionUpdatedAt?: string;
};

export type GpwSourceInventoryItem = {
  id: string;
  issuer: string;
  sourceUrl?: string;
  fetchStatus: "DISCOVERED" | "FETCHED" | "PARTIAL" | "REJECTED" | "UNAVAILABLE";
  parseStatus: "NOT_ATTEMPTED" | "PARSED" | "PARTIAL" | "REJECTED";
  parsedEventCount?: number;
  cursor?: string;
  error?: string;
};

export type GpwSourceInventoryAudit = {
  scope: { documents: number; issuers: number; statusCounts: Record<string, number> };
  findings: GpwAuditFinding[];
  resyncRequiredDocumentIds: string[];
};

/**
 * Read-only completeness control for a discovery/fetch/parse inventory. A
 * missing or partial document becomes a review/resync candidate, never an
 * instruction to invent a calendar event or delete a projection.
 */
export const auditGpwSourceInventory = (
  inventory: readonly GpwSourceInventoryItem[],
): GpwSourceInventoryAudit => {
  const findings: GpwAuditFinding[] = [];
  const resyncRequired = new Set<string>();
  const byUrl = new Map<string, GpwSourceInventoryItem[]>();
  for (const item of inventory) {
    if (item.sourceUrl) byUrl.set(item.sourceUrl, [...(byUrl.get(item.sourceUrl) ?? []), item]);
    if (!item.sourceUrl || !/^https:\/\//.test(item.sourceUrl)) {
      findings.push(finding({
        code: "MISSING_SOURCE_DOCUMENT", classification: "SYNCHRONIZATION_ERROR", confidence: "HIGH",
        documentId: item.id, sourceUrl: item.sourceUrl, issuer: item.issuer, component: "SYNC",
        message: "Source inventory row has no canonical HTTPS URL.",
        suggestedAction: "Keep the row as discovery evidence, then retry official-source resolution before projection.",
      }));
      resyncRequired.add(item.id);
    }
    if (item.fetchStatus === "PARTIAL" || item.fetchStatus === "UNAVAILABLE" || item.parseStatus === "PARTIAL") {
      findings.push(finding({
        code: "INCOMPLETE_DOCUMENT", classification: "INCOMPLETE_DOCUMENT", confidence: "HIGH",
        documentId: item.id, sourceUrl: item.sourceUrl, issuer: item.issuer, component: "SYNC",
        message: `Document cannot be used as complete parser evidence (fetch=${item.fetchStatus}, parse=${item.parseStatus}).`,
        suggestedAction: "Retry only this source through the normal synchronizer; preserve the last verified projection until source evidence is complete.",
      }));
      resyncRequired.add(item.id);
    }
    if (item.fetchStatus === "DISCOVERED" && item.parseStatus === "NOT_ATTEMPTED") {
      findings.push(finding({
        code: "INCOMPLETE_DOCUMENT", classification: "SYNCHRONIZATION_ERROR", confidence: "MEDIUM",
        documentId: item.id, sourceUrl: item.sourceUrl, issuer: item.issuer, component: "SYNC",
        message: "Official source was discovered but has not been fetched or sent to the parser.",
        suggestedAction: "Resume the normal bounded source synchronizer for this immutable source ID; do not infer a calendar event from discovery metadata.",
      }));
      resyncRequired.add(item.id);
    }
    if (item.fetchStatus === "FETCHED" && item.parseStatus === "NOT_ATTEMPTED") {
      findings.push(finding({
        code: "MISSING_SOURCE_DOCUMENT", classification: "SYNCHRONIZATION_ERROR", confidence: "MEDIUM",
        documentId: item.id, sourceUrl: item.sourceUrl, issuer: item.issuer, component: "SYNC",
        message: "Fetched document has not reached the parser stage.",
        suggestedAction: "Inspect cursor/queue state and resume parsing idempotently from this source record.",
      }));
      resyncRequired.add(item.id);
    }
  }
  for (const [sourceUrl, entries] of byUrl) {
    if (entries.length < 2) continue;
    for (const item of entries) {
      findings.push(finding({
        code: "SOURCE_DOCUMENT_CONTRADICTION", classification: "REQUIRES_REVIEW", confidence: "MEDIUM",
        documentId: item.id, sourceUrl, issuer: item.issuer, component: "SYNC",
        message: `The same source URL occurs in ${entries.length} inventory rows.`,
        suggestedAction: "Compare immutable source IDs and cursor history before deduplicating; URL equality alone is not a deletion instruction.",
      }));
    }
  }
  const statusCounts = Object.fromEntries([...new Set(inventory.map((item) => `${item.fetchStatus}:${item.parseStatus}`))]
    .sort().map((status) => [status, inventory.filter((item) => `${item.fetchStatus}:${item.parseStatus}` === status).length]));
  return {
    scope: { documents: inventory.length, issuers: new Set(inventory.map((item) => item.issuer)).size, statusCounts },
    findings,
    resyncRequiredDocumentIds: [...resyncRequired].sort(),
  };
};

/** Compare a read-only source inventory to a projection export.  It never
 * treats absence as a deletion instruction: every mismatch is a review item. */
export const auditGpwProjectionSnapshots = (
  sourceEvents: readonly GpwProjectionSnapshot[],
  projectedEvents: readonly GpwProjectionSnapshot[],
  cachedEvents: readonly GpwProjectionSnapshot[] = [],
  issuerEvents: readonly GpwProjectionSnapshot[] = [],
): GpwAuditFinding[] => {
  const findings: GpwAuditFinding[] = [];
  const projectionsByIdentity = new Map<string, GpwProjectionSnapshot[]>();
  const sourcesByIdentity = new Map<string, GpwProjectionSnapshot[]>();
  const projectionsBySource = new Map<string, GpwProjectionSnapshot[]>();
  const sourcesBySource = new Map<string, GpwProjectionSnapshot[]>();
  const sourceEventsByDocument = new Map<string, GpwProjectionSnapshot[]>();
  const cacheByIdentity = new Map<string, GpwProjectionSnapshot[]>();
  const officialDocumentKey = (url: string) => {
    try {
      const parsed = new URL(url);
      const gpwId = parsed.hostname === "www.gpw.pl" && parsed.pathname === "/komunikat"
        ? parsed.searchParams.get("geru_id") : null;
      return gpwId && /^\d+$/.test(gpwId) ? `gpw:${gpwId}` : parsed.href;
    } catch { return url; }
  };
  const officialKey = (url: string, identity: string) => `${officialDocumentKey(url)}:${identity}`;
  for (const projected of projectedEvents) {
    const key = `${projected.issuer}:${projected.identity}`;
    projectionsByIdentity.set(key, [...(projectionsByIdentity.get(key) ?? []), projected]);
    for (const url of projected.sourceUrls ?? (projected.sourceUrl ? [projected.sourceUrl] : [])) {
      const sourceKey = officialKey(url, projected.identity);
      projectionsBySource.set(sourceKey, [...(projectionsBySource.get(sourceKey) ?? []), projected]);
    }
  }
  for (const source of sourceEvents) {
    const key = `${source.issuer}:${source.identity}`;
    sourcesByIdentity.set(key, [...(sourcesByIdentity.get(key) ?? []), source]);
    if (source.sourceUrl) {
      const sourceKey = officialKey(source.sourceUrl, source.identity);
      sourcesBySource.set(sourceKey, [...(sourcesBySource.get(sourceKey) ?? []), source]);
      const documentKey = officialDocumentKey(source.sourceUrl);
      sourceEventsByDocument.set(documentKey, [...(sourceEventsByDocument.get(documentKey) ?? []), source]);
    }
  }
  for (const cached of cachedEvents) {
    const key = `${cached.issuer}:${cached.identity}`;
    cacheByIdentity.set(key, [...(cacheByIdentity.get(key) ?? []), cached]);
  }
  for (const source of sourceEvents) {
    const key = `${source.issuer}:${source.identity}`;
    // The list feed can name an issuer differently from the persisted
    // instrument (for example its legal name versus a short company name).
    // An exact official document URL + event identity is stronger evidence
    // than either spelling; retain the issuer match for older URL-less rows.
    const byOfficialSource = source.sourceUrl
      ? projectionsBySource.get(officialKey(source.sourceUrl, source.identity)) ?? [] : [];
    const candidates = [...new Map([...(projectionsByIdentity.get(key) ?? []), ...byOfficialSource]
      .map((item) => [item.id, item])).values()];
    if (!candidates.length) {
      // An unlinked document can refer to an already scheduled issuer event.
      // Never call that event missing merely because its source parser produced
      // a less complete identity. Equally, never equate different known periods
      // just because issuer, type and day happen to match.
      const [sourceType, sourcePeriod, sourceYear] = source.identity.split(":");
      const sameIssuerDayType = issuerEvents.filter((row) => {
        const [rowType] = row.identity.split(":");
        return row.issuer === source.issuer && row.eventDate === source.eventDate && rowType === sourceType;
      });
      const compatible = sameIssuerDayType.filter((row) => {
        const [, rowPeriod, rowYear] = row.identity.split(":");
        return (!sourcePeriod || sourcePeriod === rowPeriod) && (!sourceYear || sourceYear === rowYear);
      });
      if (compatible.length === 1 && sameIssuerDayType.length === 1) {
        findings.push(finding({
          code: "UNLINKED_SOURCE_PROJECTION", classification: "REQUIRES_REVIEW", confidence: "REVIEW",
          documentId: source.documentId ?? source.id, sourceUrl: source.sourceUrl, issuer: source.issuer,
          component: "PROJECTION", eventIdentity: source.identity,
          message: "An issuer event with the same report type/date and compatible known period already exists; source linkage or incomplete identity needs review, not a missing-event claim.",
          suggestedAction: "Check the full official period/year and source ownership, then link the document to the stable existing event if confirmed.",
        }));
        continue;
      }
      if (compatible.length > 1 || (!sourcePeriod && sameIssuerDayType.length > 1)) {
        findings.push(finding({
          code: "UNLINKED_SOURCE_PROJECTION", classification: "REQUIRES_REVIEW", confidence: "REVIEW",
          documentId: source.documentId ?? source.id, sourceUrl: source.sourceUrl, issuer: source.issuer,
          component: "PROJECTION", eventIdentity: source.identity,
          message: "Several same-day issuer reports could match the incomplete source identity; no existing event can be selected safely.",
          suggestedAction: "Review official period/year and all candidate identities before linking, inserting or changing any event.",
        }));
        continue;
      }
      findings.push(finding({
        code: "STALE_PROJECTION", classification: "REPROJECTION_ERROR", confidence: "HIGH",
        documentId: source.documentId ?? source.id, sourceUrl: source.sourceUrl, issuer: source.issuer,
        component: "PROJECTION", message: "Źródłowo wykryte wydarzenie nie ma aktywnej projekcji.",
        eventIdentity: source.identity,
        suggestedAction: "Zbadaj stan kolejki projekcji i uruchom wyłącznie kontrolowaną reprojekcję w izolowanym środowisku.",
      }));
      continue;
    }
    if (!candidates.some((candidate) => candidate.eventDate === source.eventDate)) {
      findings.push(finding({
        code: "STALE_PROJECTION", classification: "REPROJECTION_ERROR", confidence: "HIGH",
        documentId: source.documentId ?? source.id, sourceUrl: source.sourceUrl, issuer: source.issuer,
        component: "PROJECTION", message: "Projekcja ma inną datę niż źródłowo odczytane wydarzenie.",
        eventIdentity: source.identity,
        suggestedAction: "Porównaj historię korekt i kolejność źródeł; nie nadpisuj aktywnej daty bez dowodu.",
      }));
    }
    const sourceUpdatedAt = source.sourceUpdatedAt ? Date.parse(source.sourceUpdatedAt) : Number.NaN;
    if (Number.isFinite(sourceUpdatedAt) && candidates.some((candidate) => {
      const projectionUpdatedAt = candidate.projectionUpdatedAt ? Date.parse(candidate.projectionUpdatedAt) : Number.NaN;
      return Number.isFinite(projectionUpdatedAt) && projectionUpdatedAt < sourceUpdatedAt;
    })) {
      findings.push(finding({
        code: "STALE_PROJECTION", classification: "REPROJECTION_ERROR", confidence: "MEDIUM",
        documentId: source.documentId ?? source.id, sourceUrl: source.sourceUrl, issuer: source.issuer,
        component: "PROJECTION", message: "Źródło jest nowsze niż skojarzona projekcja.", eventIdentity: source.identity,
        suggestedAction: "Zweryfikuj wersję projekcji i oznacz rekord do kontrolowanego ponownego przetworzenia.",
      }));
    }
    const cached = cacheByIdentity.get(key) ?? [];
    if (cached.length && !cached.some((candidate) => candidate.eventDate === source.eventDate)) {
      findings.push(finding({
        code: "CACHE_MISMATCH", classification: "PRESENTATION_OR_CACHE_ERROR", confidence: "HIGH",
        documentId: source.documentId ?? source.id, sourceUrl: source.sourceUrl, issuer: source.issuer,
        component: "CACHE", message: "Cache snapshot has a different event date than the source/projection input.",
        eventIdentity: source.identity,
        suggestedAction: "Invalidate only this cache key after verifying the active projection; do not alter financial or source records.",
      }));
    }
  }
  for (const [key, projections] of projectionsByIdentity) {
    const distinctDates = new Set(projections.map((projection) => projection.eventDate));
    if (projections.length > 1 && distinctDates.size === 1) {
      const projection = projections[0]!;
      findings.push(finding({
        code: "DUPLICATE_LOGICAL_EVENT", classification: "REPROJECTION_ERROR", confidence: "HIGH",
        documentId: projection.documentId ?? projection.id, sourceUrl: projection.sourceUrl, issuer: projection.issuer,
        component: "PROJECTION", message: "Projection export contains repeated rows with the same logical identity and date.",
        eventIdentity: projection.identity,
        suggestedAction: "Inspect stable IDs and idempotency keys in an isolated database before any controlled reprojection.",
      }));
    }
    const hasSourceByOfficialDocument = projections.some((projection) =>
      (projection.sourceUrls ?? (projection.sourceUrl ? [projection.sourceUrl] : []))
        .some((url) => sourcesBySource.has(officialKey(url, projection.identity))));
    if (!sourcesByIdentity.has(key) && !hasSourceByOfficialDocument) {
      const projection = projections[0]!;
      const linkedSourceEvents = projections.flatMap((item) =>
        (item.sourceUrls ?? (item.sourceUrl ? [item.sourceUrl] : []))
          .flatMap((url) => sourceEventsByDocument.get(officialDocumentKey(url)) ?? []));
      const sourceDocumentPresent = linkedSourceEvents.length > 0;
      findings.push(finding({
        code: sourceDocumentPresent ? "AMBIGUOUS_EVENT_IDENTITY" : "MISSING_SOURCE_DOCUMENT",
        classification: "SYNCHRONIZATION_ERROR", confidence: "REVIEW",
        documentId: projection.documentId ?? projection.id, sourceUrl: projection.sourceUrl, issuer: projection.issuer,
        component: "SYNC", message: sourceDocumentPresent
          ? "The linked official document was parsed, but it does not support this projection identity; compare event type, date, period and revision history."
          : "Projection row has no matching event in the supplied source inventory scope.",
        eventIdentity: projection.identity,
        suggestedAction: sourceDocumentPresent
          ? "Review the linked source events and projection history; do not merge or deactivate records solely from a name/date match."
          : "Check source-inventory coverage and cursor bounds before treating the projection as stale or deleting anything.",
      }));
    }
  }
  return findings;
};
