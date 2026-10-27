// Source-reviewed decisions for the bounded 19–23 October 2026 audit. These
// are audit evidence, not parser exceptions or executable database mutations.
// The manifest is deliberately fail-closed: a new anomaly has no default fix.
const reviewedLabels = new Map([
  ["fc1afce0-b65b-46e3-80c5-493aa5f8534f", ["UPDATE", "ANNUAL_REPORT:FY:2025/2026", "493765", "FY 2025/26 publication on 29 October 2026."]],
  ["47b28b21-787e-4ef9-b790-6423d34dec70", ["UPDATE", "QUARTERLY_REPORT:Q3:2026", "479537", "Q3 2026 publication on 5 November 2026."]],
  ["793d5137-4de1-448a-a20d-a02ac29b3511", ["UPDATE", "QUARTERLY_REPORT:Q3:2026", "480564", "Q3 2026 publication on 6 November 2026."]],
  ["d31c86b2-2411-4bb6-ac69-fcff73711993", ["UPDATE", "QUARTERLY_REPORT:Q3:2026", "481146", "Q3 2026 publication on 10 November 2026."]],
  ["4c184155-1c94-44ee-ba98-ddc5ac850bd7", ["UPDATE", "QUARTERLY_REPORT:Q3:2026", "479827", "Q3 2026 publication on 24 November 2026."]],
  ["22fe9002-0fd0-4212-ab76-054285f339f7", ["UPDATE", "QUARTERLY_REPORT:Q3:2026", "480017", "Q3 2026 publication on 24 November 2026."]],
  ["64f527b7-43e0-48ba-a00b-ec2dad9fc664", ["UPDATE", "QUARTERLY_REPORT:Q1:2026/2027", "493765", "Q1 FY 2026/27 publication on 25 November 2026."]],
  ["32716906-43f7-4b9c-abb8-16898a4e299a", ["UPDATE", "QUARTERLY_REPORT:Q3:2026", "480307", "Q3 2026 publication on 26 November 2026."]],
  ["3dba107b-c030-4258-b13e-1c83fcc70380", ["UPDATE", "QUARTERLY_REPORT:Q3:2026", "480835", "Q3 2026 publication on 27 November 2026."]],
  ["2625f297-c26a-4408-ad55-2e4fa2676d11", ["UPDATE", "QUARTERLY_REPORT:Q3:2026", "479711", "Q3 2026 publication on 27 November 2026."]],
  ["d687beb6-33d4-407d-bc81-0ad7105b3ba8", ["UPDATE", "QUARTERLY_REPORT:Q3:2026", "480082", "SA-Q3 2026 publication on 27 November 2026."]],
  ["87d41cb1-7d59-48ee-99c5-7db9c3c3ab5e", ["UPDATE", "HALF_YEAR_REPORT:H1:2026/2027", "487377", "H1 FY 2026/27 publication on 10 December 2026."]],
  ["cbaa3f37-2ade-4d51-a0ec-80dfb763999f", ["DEACTIVATE", "QUARTERLY_REPORT:Q2:2026/2027", "497077", "One Q2 FY 2026/27 publication exists; this incomplete identity duplicates a precise active event."]],
  ["acf77358-da56-4a1b-992c-9462116b10d1", ["UPDATE", "QUARTERLY_REPORT:Q3:2026/2027", "487377", "Q3 FY 2026/27 publication on 25 February 2027."]],
  ["88f792d4-27b9-4b79-be4d-ce3210591373", ["UPDATE", "QUARTERLY_REPORT:Q3:2026/2027", "493765", "Q3 FY 2026/27 publication on 26 May 2027."]],
  ["026701ae-c2fd-4214-b0ac-50beead054dd", ["DEACTIVATE", "HALF_YEAR_REPORT:H1:2026/2027", "499171", "The same H1 FY 2026/27 publication already has a precise active identity; the 2025/26 schedule is for another year."]],
  ["558db458-ce75-4ae4-9153-f7ae5a252e90", ["DEACTIVATE", null, "493765", "30 June 2027 is the fiscal-year end, not a report publication date."]],
  ["767dd194-4ac2-4c68-9458-dd1be8c06220", ["DEACTIVATE", "HALF_YEAR_REPORT:H1:2026", "498893", "30 June 2027 is an H1 report, not Q1; the H1 projection already exists."]],
  ["967798d8-e9f6-4c34-aa14-72b138145b40", ["DEACTIVATE", "QUARTERLY_REPORT:Q4:2026/2027", "497077", "One Q4 FY 2026/27 publication exists; this incomplete identity duplicates a precise active event."]],
  ["d4eb35ba-cd38-4ad8-abd6-08dabeac4ac1", ["DEACTIVATE", null, "499171", "30 September 2027 is the fiscal-year end; the annual report is scheduled for 7 January 2028."]],
  ["3c80b262-0562-412c-a9c1-092d012a19c1", ["DEACTIVATE", "ANNUAL_REPORT:FY:2026/2027", "499003", "One FY 2026/27 publication exists; the older schedule covers FY 2025/26."]],
  ["5ad5b2d7-f78e-45ee-9a51-10d65cca90db", ["DEACTIVATE", "ANNUAL_REPORT:FY:2026/2027", "498808", "One FY 2026/27 publication exists; the older schedule covers FY 2025/26."]],
  ["155e2ea1-adcd-4fc1-8ed9-dabf6b9c88df", ["DEACTIVATE", "ANNUAL_REPORT:FY:2026/2027", "498809", "One FY 2026/27 publication exists; the older schedule covers FY 2025/26."]],
  ["387e263a-5c46-40ee-abbb-f84f2547d206", ["DEACTIVATE", "ANNUAL_REPORT:FY:2026/2027", "499000", "One FY 2026/27 publication exists; the older schedule covers FY 2025/26."]],
]);

const reviewedCollisions = new Map([
  ["IDM:2026-11-18", { keep: "25113cff-c2c7-4060-8908-fa4686cf70df", remove: "aaf7b124-46d3-433d-a611-946a55867196", sourceIds: ["480804", "480817"], reason: "The later official correction changes the mistaken Q3 2025 label to Q3 2026." }],
  ["GRX:2027-01-29", { keep: "b0b2c661-feb4-4365-ada1-aef2da6fe5f8", remove: "cbaa3f37-2ade-4d51-a0ec-80dfb763999f", sourceIds: ["497077"], reason: "One Q2 FY 2026/27 publication; the other row has an incomplete identity." }],
  ["GRX:2027-03-12", { keep: "c255431c-ce0f-4d4e-bd85-b27fa965eab5", remove: "fc9bdce2-212d-4da1-ab0d-d3dc639672f9", sourceIds: ["497077"], reason: "One H1 FY 2026/27 publication; the short year label loses fiscal context." }],
  ["ABE:2027-06-08", { keep: "df3c91a3-7a33-4381-ad28-b55de0264487", remove: "026701ae-c2fd-4214-b0ac-50beead054dd", sourceIds: ["475396", "499171"], reason: "One H1 FY 2026/27 publication; the old schedule concerns 2026." }],
  ["S2B:2027-06-30", { keep: "0758efb2-5abf-4551-b5c0-26eef7abf297", remove: "767dd194-4ac2-4c68-9458-dd1be8c06220", sourceIds: ["487495", "498893"], reason: "One H1 publication; Q1 is scheduled for 17 February 2027." }],
  ["GRX:2027-07-30", { keep: "b9ccbd42-46a4-4793-89d1-379763b1d408", remove: "967798d8-e9f6-4c34-aa14-72b138145b40", sourceIds: ["497077"], reason: "One Q4 FY 2026/27 publication; the other row has an incomplete identity." }],
  ["ATS:2027-09-30", { keep: "f6d643d5-b402-453f-992a-d03ba43b5d9f", remove: "3c80b262-0562-412c-a9c1-092d012a19c1", sourceIds: ["476675", "499003"], reason: "One FY 2026/27 publication; the older schedule concerns FY 2025/26." }],
  ["FON:2027-09-30", { keep: "e47c4ebc-f314-485b-bb15-262852f43721", remove: "5ad5b2d7-f78e-45ee-9a51-10d65cca90db", sourceIds: ["476671", "498808"], reason: "One FY 2026/27 publication; the older schedule concerns FY 2025/26." }],
  ["IFC:2027-09-30", { keep: "dbb1f027-185f-48f7-9ef7-10bc96c71535", remove: "155e2ea1-adcd-4fc1-8ed9-dabf6b9c88df", sourceIds: ["476673", "498809"], reason: "One FY 2026/27 publication; the older schedule concerns FY 2025/26." }],
  ["IFR:2027-09-30", { keep: "28fb4848-c2f3-49b6-a61d-30291c87e224", remove: "387e263a-5c46-40ee-abbb-f84f2547d206", sourceIds: ["476676", "499000"], reason: "One FY 2026/27 publication; the older schedule concerns FY 2025/26." }],
]);

const gpwUrl = (id) => `https://www.gpw.pl/komunikat?geru_id=${id}`;
const abeOfficialSchedule = [
  { identity: "QUARTERLY_REPORT:Q1:2026/2027", eventDate: "2027-02-22" },
  { identity: "HALF_YEAR_REPORT:H1:2026/2027", eventDate: "2027-06-08" },
  { identity: "QUARTERLY_REPORT:Q3:2026/2027", eventDate: "2027-08-23" },
  { identity: "ANNUAL_REPORT:FY:2026/2027", eventDate: "2028-01-07" },
];
const officialIds = (urls) => [...new Set((urls ?? []).map((url) => {
  try { return new URL(url).searchParams.get("geru_id"); } catch { return null; }
}).filter(Boolean))];
const sourceEvidence = (ids, explanation) => ({
  officialUrls: ids.map(gpwUrl),
  explanation,
  reviewDocument: "docs/gpw-incomplete-report-label-source-review.md",
});

const unique = (items) => [...new Set(items)];

/** Pure, read-only, bounded manifest. It cannot apply a DB mutation. */
export function buildGpwReprojectionManifest(snapshot) {
  const findings = snapshot?.findings ?? [];
  const anomalies = snapshot?.calendarAnomalies ?? [];
  const projections = new Map((snapshot?.projections ?? []).map((row) => [row.id, row]));
  const actions = new Map();
  const anomalyAssessments = [];
  const findingAssessments = [];
  const add = ({ eventId, current, source, proposedAction, proposedState = null, evidence,
    confidence = "SOURCE_REVIEWED", reason, origin }) => {
    const key = eventId ?? `${origin}:no-event`;
    const prior = actions.get(key);
    if (prior && (prior.proposedAction !== proposedAction ||
        JSON.stringify(prior.proposedState) !== JSON.stringify(proposedState))) {
      actions.set(key, { eventId, current, source, proposedAction: "REVIEW", proposedState: null,
        evidence: sourceEvidence(officialIds(unique([...(prior.evidence?.officialUrls ?? []),
          ...(evidence?.officialUrls ?? [])])), "Conflicting source-reviewed proposals; inspect the revision chain."),
        confidence: "AMBIGUOUS", reason: "CONFLICTING_PROPOSALS", origins: unique([...prior.origins, origin]) });
      return;
    }
    if (prior) { prior.origins = unique([...prior.origins, origin]); return; }
    actions.set(key, { eventId, current, source, proposedAction, proposedState, evidence,
      confidence, reason, origins: [origin], requiresSourcePriorityCheck: proposedAction !== "NO_CHANGE" && proposedAction !== "REVIEW" });
  };

  for (const [index, anomaly] of anomalies.entries()) {
    const origin = `calendarAnomalies:${index}:${anomaly.code}`;
    if (anomaly.code === "INCOMPLETE_REPORT_LABEL") {
      const decision = reviewedLabels.get(anomaly.eventId);
      const [action, identity, reviewedSourceId, explanation] = decision ?? [];
      const linkedIds = officialIds(anomaly.sourceUrls);
      const evidence = sourceEvidence(reviewedSourceId ? [reviewedSourceId] : linkedIds,
        explanation ?? "No official-source decision covers this event.");
      const matchesSource = Boolean(reviewedSourceId && linkedIds.includes(reviewedSourceId));
      const proposedAction = action && matchesSource ? action : "REVIEW";
      add({ eventId: anomaly.eventId,
        current: { eventDate: anomaly.eventDate, identity: anomaly.identity, active: true,
          sourceUrls: anomaly.sourceUrls, missing: anomaly.missing },
        source: { eventDate: action === "DEACTIVATE" && !identity ? null : anomaly.eventDate,
          identity: identity ?? null, sourceId: reviewedSourceId ? `gpw:${reviewedSourceId}` : null },
        proposedAction, proposedState: proposedAction === "REVIEW" ? null
          : proposedAction === "DEACTIVATE" ? { active: false }
            : { identity, eventDate: anomaly.eventDate },
        evidence, confidence: proposedAction === "REVIEW" ? "AMBIGUOUS" : "SOURCE_REVIEWED",
        reason: proposedAction === "REVIEW" ? "SOURCE_DECISION_MISSING_OR_NOT_LINKED" : explanation, origin });
      anomalyAssessments.push({ code: anomaly.code, eventIds: [anomaly.eventId],
        proposedAction, sourceIds: linkedIds, resolved: proposedAction !== "REVIEW" });
      continue;
    }
    if (anomaly.code === "SAME_ISSUER_DAY_REVIEW") {
      const decision = reviewedCollisions.get(anomaly.key);
      const rowIds = (anomaly.rows ?? []).map((row) => row.eventId);
      const exactPair = decision && rowIds.length === 2 &&
        rowIds.includes(decision.keep) && rowIds.includes(decision.remove);
      const rowIdsOfficial = unique((anomaly.rows ?? []).flatMap((row) => officialIds(row.sourceUrls)));
      const matchesSources = exactPair && decision.sourceIds.every((id) => rowIdsOfficial.includes(id));
      for (const row of anomaly.rows ?? []) {
        const keep = row.eventId === decision?.keep;
        const proposedAction = matchesSources ? keep ? "NO_CHANGE" : "DEACTIVATE" : "REVIEW";
        add({ eventId: row.eventId,
          current: { eventDate: anomaly.key?.split(":").at(-1) ?? null, identity: row.identity,
            active: true, sourceUrls: row.sourceUrls },
          source: { eventDate: anomaly.key?.split(":").at(-1) ?? null,
            identity: matchesSources ? anomaly.rows.find((item) => item.eventId === decision.keep)?.identity : null,
            sourceIds: decision?.sourceIds.map((id) => `gpw:${id}`) ?? [] },
          proposedAction, proposedState: proposedAction === "DEACTIVATE" ? { active: false }
            : proposedAction === "NO_CHANGE" ? { active: true, identity: row.identity } : null,
          evidence: sourceEvidence(decision?.sourceIds ?? rowIdsOfficial,
            matchesSources ? decision.reason : "Collision has no exact reviewed pair and source provenance."),
          confidence: matchesSources ? "SOURCE_REVIEWED" : "AMBIGUOUS",
          reason: matchesSources ? decision.reason : "COLLISION_NOT_SOURCE_VERIFIED", origin });
      }
      anomalyAssessments.push({ code: anomaly.code, key: anomaly.key, eventIds: rowIds,
        proposedAction: matchesSources ? "KEEP_ONE_SOURCE_SUPPORTED_EVENT" : "REVIEW",
        sourceIds: rowIdsOfficial, resolved: Boolean(matchesSources) });
      continue;
    }
    anomalyAssessments.push({ code: anomaly.code, eventIds: [], proposedAction: "REVIEW", resolved: false });
  }

  for (const [index, finding] of findings.entries()) {
    const origin = `findings:${index}:${finding.code}`;
    const id = finding.documentId;
    const official = officialIds([finding.sourceUrl]);
    if (finding.code === "AMBIGUOUS_EVENT_IDENTITY" && projections.has(id)) {
      const row = projections.get(id);
      const special = id === "bfad642e-2161-4ce2-ae7d-801a9ef2972b"
        ? "An annual FY 2026/27 report already has a precise active identity on 7 January 2028."
        : id === "797979f1-3672-4d74-8acf-d55081c05ead" || id === "e20269d0-35ec-48cf-98a9-f3181f8b40bd"
          ? "Neither the FY 2025/26 nor FY 2026/27 official schedule supports a publication on 6 June 2025."
          : "The source-reviewed schedule does not support this old identity/date; a precise active event exists.";
      add({ eventId: id, current: { eventDate: row.eventDate, identity: row.identity,
          active: true, sourceUrls: row.sourceUrls },
        source: { eventDate: null, identity: null, sourceIds: ["gpw:475396", "gpw:499171"],
          supportedCurrentSchedule: abeOfficialSchedule },
        proposedAction: "DEACTIVATE", proposedState: { active: false },
        evidence: sourceEvidence(["475396", "499171"], special),
        reason: special, origin });
      findingAssessments.push({ code: finding.code, documentId: id, eventId: id,
        proposedAction: "DEACTIVATE", resolved: true });
      continue;
    }
    if (["STALE_PROJECTION", "UNLINKED_SOURCE_PROJECTION"].includes(finding.code) &&
        ["gpw:499072", "gpw:499122", "gpw:499304"].includes(id)) {
      const observed = {
        "gpw:499072": { eventId: "22e5ec05-e42e-4f77-bfa6-1cc3a044cebf", eventDate: "2026-11-25", identity: "QUARTERLY_REPORT:Q3:2026", previousSourceId: "480169", explanation: "The Q3 2026 event already exists on the official planned date; incomplete source identity caused a false missing-event signal.", action: "LINK_SOURCE" },
        "gpw:499122": { eventId: "d7eef32a-dfa6-4a10-9070-175514cdbf67", eventDate: "2026-11-20", identity: "QUARTERLY_REPORT:Q3:2026", previousSourceId: "480882", explanation: "The formal Q3 2026 report already exists on 20 November; 20 October was only the preliminary-results preparation date.", action: "LINK_SOURCE" },
        "gpw:499304": { eventId: "6d534a6e-781e-4987-a8f8-7c0056e946ca", eventDate: "2026-11-30", identity: "QUARTERLY_REPORT:Q3:2026", previousSourceId: "480653", explanation: "The official correction moves Q3 2026 from 30 November to 28 October while retaining the same logical event.", action: "UPDATE" },
      }[id];
      const newDate = id === "gpw:499304" ? "2026-10-28" : observed.eventDate;
      add({ eventId: observed.eventId,
        current: { eventDate: observed.eventDate, identity: observed.identity, active: true,
          sourceUrls: [gpwUrl(observed.previousSourceId)], snapshot: "READ_ONLY_AIVEN_2026-10-27" },
        source: { eventDate: newDate, identity: observed.identity, sourceId: id,
          previousEventDate: observed.action === "UPDATE" ? observed.eventDate : null },
        proposedAction: observed.action,
        proposedState: observed.action === "UPDATE"
          ? { eventDate: newDate, identity: observed.identity, linkSource: finding.sourceUrl }
          : { linkSource: finding.sourceUrl },
        evidence: sourceEvidence(official, observed.explanation), reason: observed.explanation, origin });
      findingAssessments.push({ code: finding.code, documentId: id, eventId: observed.eventId,
        proposedAction: observed.action, resolved: true,
        auditConclusion: observed.action === "LINK_SOURCE" ? "FALSE_MISSING_EVENT" : "DATE_CORRECTION" });
      continue;
    }
    const explanation = id === "gpw:499257"
      ? "The official report is not present in the ESPI ingestion snapshot. Its RAR attachment was access-challenged; no calendar event can be inferred from the available body."
      : "No source-reviewed decision covers this finding.";
    add({ eventId: null, current: { documentId: id, espiIngested: false },
      source: { documentId: id, sourceUrl: finding.sourceUrl }, proposedAction: "REVIEW",
      evidence: sourceEvidence(official, explanation), confidence: "AMBIGUOUS",
      reason: explanation, origin });
    findingAssessments.push({ code: finding.code, documentId: id, eventId: null,
      proposedAction: "REVIEW", resolved: false });
  }

  const listed = [...actions.values()];
  const unresolved = listed.filter((item) => item.proposedAction === "REVIEW").length +
    anomalyAssessments.filter((item) => !item.resolved).length;
  const inputComplete = findings.length === 9 && anomalies.length === 34 &&
    [...reviewedLabels.keys()].every((id) => anomalies.some((item) => item.eventId === id)) &&
    [...reviewedCollisions.keys()].every((key) => anomalies.some((item) => item.key === key));
  return {
    schemaVersion: 1,
    status: !inputComplete ? "INPUT_REVIEW_REQUIRED" : unresolved ? "SOURCE_REVIEWED_APPLY_BLOCKED" : "SOURCE_REVIEWED_DRY_RUN_ONLY",
    sourceSnapshot: { status: snapshot?.status, databaseState: snapshot?.databaseState,
      findings: findings.length, calendarAnomalies: anomalies.length },
    actions: listed,
    findingAssessments, anomalyAssessments,
    summary: { findingsResolved: findingAssessments.filter((item) => item.resolved).length,
      anomalyAssessmentsResolved: anomalyAssessments.filter((item) => item.resolved).length,
      proposedByAction: Object.fromEntries(["UPDATE", "DEACTIVATE", "INSERT", "LINK_SOURCE", "NO_CHANGE", "REVIEW"]
        .map((action) => [action, listed.filter((item) => item.proposedAction === action).length])) },
    unresolved: unresolved + (inputComplete ? 0 : 1),
    safeToApply: false,
    limitations: [
      "Read-only manifest: no SQL mutation path exists in this generator.",
      "Aiven rows can change after the audit snapshot; recheck stable IDs, active flags, ownership and source priorities before any later apply.",
      "Deactivation is only a proposal based on full official source review, never on matching issuer and date alone.",
      "An isolated PostgreSQL replay, idempotency/rollback verification, and human approval are required before production reprojection.",
    ],
  };
}
