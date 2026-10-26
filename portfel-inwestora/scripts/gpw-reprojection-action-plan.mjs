import { getCorporateEventIdentityKey } from "../src/lib/corporate-events.ts";

const reportTypes = new Set(["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT"]);

const evidence = (event) => event.sourceEvidence?.trim().slice(0, 300) ?? null;

/** A conservative, read-only action preview. These are candidates, not writes:
 * actual upserts also consider source priority, locks, and current DB state. */
export const buildReportReprojectionActionPreview = ({
  sourceId, sourceUrl, publishedAt, parsed, existing, issuerEvents, issuerResolved,
  parseComplete, plan,
}) => {
  const actions = [];
  const byId = new Map(existing.map((row) => [row.id, row]));
  const matchedExisting = new Set();

  for (const event of parsed.filter((item) => reportTypes.has(item.eventType))) {
    const identity = getCorporateEventIdentityKey(event);
    const sourceEvidence = evidence(event);
    const context = { sourceId, sourceUrl, publishedAt, identity, sourceEvidence };
    if (!issuerResolved) {
      actions.push({ action: "REVIEW", reason: "ISSUER_NOT_RELIABLY_LINKED", ...context });
      continue;
    }
    if (event.requiresReview) {
      actions.push({ action: "REVIEW", reason: "PARSER_REQUIRES_REVIEW", ...context,
        reviewReasons: event.reviewReasons ?? [] });
      continue;
    }
    const matching = existing.filter((row) => row.event_identity === identity);
    if (matching.length > 1) {
      actions.push({ action: "REVIEW", reason: "MULTIPLE_SOURCE_PROJECTIONS_SAME_IDENTITY", ...context,
        existingIds: matching.map((row) => row.id) });
      continue;
    }
    if (matching.length === 1) {
      const current = matching[0];
      matchedExisting.add(current.id);
      if (current.event_date !== event.eventDate) {
        actions.push({ action: "UPDATE", reason: "SAME_IDENTITY_NEW_DATE", ...context,
          existingId: current.id, before: { date: current.event_date, identity: current.event_identity },
          proposedAfter: { date: event.eventDate, identity },
          requiresSourcePriorityCheck: true });
      }
      continue;
    }

    const correctionCandidates = event.previousEventDate ? existing.filter((row) =>
      row.event_type === event.eventType && row.event_date === event.previousEventDate &&
      row.source_urls?.length === 1 && row.source_urls[0] === sourceUrl
    ) : [];
    if (correctionCandidates.length === 1 && plan.retainedIds.includes(correctionCandidates[0].id)) {
      const current = correctionCandidates[0];
      matchedExisting.add(current.id);
      actions.push({ action: "UPDATE", reason: "EXPLICIT_CORRECTION_STABLE_ID", ...context,
        existingId: current.id, before: { date: current.event_date, identity: current.event_identity },
        proposedAfter: { date: event.eventDate, identity },
        requiresSourcePriorityCheck: true });
      continue;
    }
    if (correctionCandidates.length > 1) {
      actions.push({ action: "REVIEW", reason: "AMBIGUOUS_CORRECTION_TARGET", ...context,
        existingIds: correctionCandidates.map((row) => row.id) });
      continue;
    }

    const globalMatches = issuerEvents.filter((row) => row.event_type === event.eventType &&
      row.event_identity === identity && row.active === true);
    if (globalMatches.length === 1) {
      const current = globalMatches[0];
      if (current.event_date !== event.eventDate) {
        const before = { date: current.event_date, identity: current.event_identity };
        const proposedAfter = { date: event.eventDate, identity };
        if (parseComplete && event.isScheduleChange && event.previousEventDate === current.event_date) {
          actions.push({ action: "UPDATE", reason: "EXPLICIT_CORRECTION_FROM_NEW_SOURCE", ...context,
            existingId: current.id, before, proposedAfter, requiresSourcePriorityCheck: true });
          actions.push({ action: "LINK_SOURCE", reason: "LINK_EXPLICIT_CORRECTION_SOURCE", ...context,
            existingId: current.id, requiresSourcePriorityCheck: true });
        } else {
          actions.push({ action: "REVIEW", reason: "UNLINKED_SOURCE_DATE_CHANGE_REQUIRES_PRIORITY", ...context,
            existingId: current.id, before, proposedAfter,
            suggestedActions: ["UPDATE", "LINK_SOURCE"], requiresSourcePriorityCheck: true });
        }
      } else {
        actions.push({ action: "LINK_SOURCE", reason: "IDENTITY_ALREADY_EXISTS_FOR_ISSUER", ...context,
          existingId: current.id, requiresSourcePriorityCheck: true });
      }
    } else if (globalMatches.length > 1) {
      actions.push({ action: "REVIEW", reason: "MULTIPLE_ISSUER_PROJECTIONS_SAME_IDENTITY", ...context,
        existingIds: globalMatches.map((row) => row.id) });
    } else {
      actions.push({ action: "INSERT", reason: "SOURCE_EVENT_WITHOUT_ACTIVE_PROJECTION", ...context,
        proposedAfter: { date: event.eventDate, type: event.eventType,
          period: event.fiscalPeriod ?? null, fiscalYear: event.fiscalYearLabel ?? event.fiscalYear ?? null } });
    }
  }

  for (const id of plan.deactivateIds) {
    const current = byId.get(id);
    if (!current || matchedExisting.has(id)) continue;
    actions.push({ action: "DEACTIVATE", reason: "SOURCE_OWNED_FALSE_DUPLICATE", sourceId, sourceUrl,
      publishedAt, existingId: id, before: { date: current.event_date, identity: current.event_identity },
      requiresSourcePriorityCheck: true });
  }
  for (const id of plan.ambiguousIds) {
    const current = byId.get(id);
    actions.push({ action: "REVIEW", reason: "AMBIGUOUS_EXISTING_PROJECTION", sourceId, sourceUrl,
      publishedAt, existingId: id,
      before: current ? { date: current.event_date, identity: current.event_identity } : null });
  }
  if (!parseComplete) actions.push({ action: "REVIEW", reason: "SOURCE_ATTACHMENTS_INCOMPLETE",
    sourceId, sourceUrl, publishedAt });
  return actions;
};
