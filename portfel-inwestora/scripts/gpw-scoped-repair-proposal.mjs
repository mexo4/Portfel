import { createHash } from "node:crypto";
import { verifyReplayInputs } from "./gpw-reprojection-replay.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const mutationTypes = new Set(["UPDATE", "DEACTIVATE", "LINK_SOURCE"]);
const sourceId = (url) => {
  try { return new URL(url).searchParams.get("geru_id"); } catch { return null; }
};
const unique = (values) => [...new Set(values)];

/** A review document only. It cannot authorize or execute a production write. */
export function buildScopedRepairProposal(manifest, snapshot) {
  verifyReplayInputs(manifest, snapshot);
  const mutations = manifest.actions.filter((action) => mutationTypes.has(action.proposedAction));
  const unchanged = manifest.actions.filter((action) => action.proposedAction === "NO_CHANGE");
  const reviews = manifest.actions.filter((action) => action.proposedAction === "REVIEW");
  const eventById = new Map(snapshot.events.map((event) => [event.id, event]));
  if (reviews.some((action) => !(action.evidence?.officialUrls?.length))) {
    throw new Error("SCOPED_REPAIR_REVIEW_SOURCE_UNKNOWN");
  }
  const reviewSources = new Set(reviews.flatMap((action) => action.evidence?.officialUrls ?? []).map(sourceId));
  if (mutations.some((action) => reviews.some((review) => review.eventId === action.eventId && action.eventId)) ||
      mutations.some((action) => (action.evidence?.officialUrls ?? []).some((url) => reviewSources.has(sourceId(url))))) {
    throw new Error("SCOPED_REPAIR_OVERLAPS_UNRESOLVED_REVIEW");
  }
  const actionRows = [...mutations, ...unchanged].map((action) => {
    const event = eventById.get(action.eventId);
    if (!event || event.active !== action.current?.active ||
        event.event_date !== action.current.eventDate ||
        event.event_identity !== action.current.identity) {
      throw new Error(`SCOPED_REPAIR_BASELINE_MISMATCH:${action.eventId}`);
    }
    const officialUrls = action.evidence?.officialUrls ?? [];
    if (!officialUrls.length || officialUrls.some((url) =>
      !/^https:\/\/www\.gpw\.pl\/komunikat\?geru_id=\d+(?:&|$)/.test(url))) {
      throw new Error(`SCOPED_REPAIR_OFFICIAL_SOURCE_MISSING:${action.eventId}`);
    }
    if (typeof action.evidence.explanation !== "string" || !action.evidence.explanation.trim()) {
      throw new Error(`SCOPED_REPAIR_SOURCE_CLAIM_MISSING:${action.eventId}`);
    }
    const linkedSources = snapshot.sources.filter((source) => source.corporate_event_id === event.id);
    const relatedActionIds = manifest.actions.filter((other) => other.eventId && other.eventId !== event.id &&
      eventById.get(other.eventId)?.instrument_id === event.instrument_id).map((other) => other.eventId);
    const after = action.proposedAction === "DEACTIVATE"
      ? { eventDate: event.event_date, identity: event.event_identity, status: event.status, active: false }
      : action.proposedAction === "UPDATE"
        ? { eventDate: action.proposedState.eventDate, identity: action.proposedState.identity,
          status: event.status, active: true }
        : { eventDate: event.event_date, identity: event.event_identity,
          status: event.status, active: event.active };
    return {
      eventId: event.id, issuerId: event.instrument_id, eventType: event.event_type,
      decision: action.proposedAction,
      before: { eventDate: event.event_date, identity: event.event_identity,
        status: event.status, active: event.active,
        sourcePriority: event.source_priority, rowFingerprint: hash(event) },
      after,
      proposedSourceLink: action.proposedState?.linkSource ?? null,
      officialUrls, sourceClaim: action.evidence.explanation,
      existingSourceIds: linkedSources.map((source) => sourceId(source.source_url)).filter(Boolean),
      relatedActionIds: unique(relatedActionIds),
      independentSourceReview: { status: "PENDING", reviewer: null, reviewedAt: null,
        officialDocumentVerified: false, exactFieldEvidence: null, secondReviewer: null },
      preconditions: ["fresh snapshot and manifest fingerprint match", "full row equals before.rowFingerprint",
        "event identity, issuer, active flag and all source links remain unchanged",
        "official document and exact date/period/status independently approved",
        "source priority and logical-identity collision rechecked", "GPW synchronization paused under operator lock"],
      rollback: { mode: "TRANSACTION_ROLLBACK_BEFORE_COMMIT_OR_RESTORE_VERIFIED_BACKUP",
        originalRowFingerprint: hash(event),
        note: "After commit, reverse only with fresh drift checks and source/provenance audit; never delete unrelated writes." },
    };
  });
  return {
    schemaVersion: 1, kind: "SCOPED_REPAIR_PROPOSAL_ONLY", safeToApply: false,
    globalReadinessGateUnchanged: true,
    sourceSnapshotFingerprint: snapshot.fingerprint,
    sourceManifestFingerprint: snapshot.manifestFingerprint,
    counts: { mutations: mutations.length, unchangedControls: unchanged.length,
      excludedReviews: reviews.length, byAction: Object.fromEntries(
        ["UPDATE", "DEACTIVATE", "LINK_SOURCE"].map((type) =>
          [type, mutations.filter((action) => action.proposedAction === type).length])) },
    transactionBoundary: "ONE_ATOMIC_TRANSACTION_FOR_ALL_MUTATIONS_AND_NO_CHANGE_CONTROLS",
    excludedReviews: reviews.map((action) => ({ documentId: action.current?.documentId ?? null,
      officialUrls: action.evidence?.officialUrls ?? [], reason: action.reason })),
    actions: actionRows,
    limitations: ["No independent human source sign-off is recorded in this proposal.",
      "Technical separation from REVIEW is based on event IDs and source IDs; fresh issuer/source dependencies must be rechecked before approval.",
      "No production SQL executor is supplied by this proposal."],
  };
}
