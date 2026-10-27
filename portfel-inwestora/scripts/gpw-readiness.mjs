/** Independent decisions: a reviewable code diff is not evidence that the
 * market feed, a database rewrite, or a production deploy is safe. */
export const assessGpwReadiness = ({ audit, sources, projections, e2e, manifest, httpE2e, strictGate }) => {
  const regressionPass = audit?.qualityGate?.parserRegressionFree === true &&
    audit?.antiTickerPolicy?.status === "PASS";
  const postgresPass = e2e?.status === "POSTGRES_E2E_PASS" &&
    e2e?.nativePostgres?.status === "POSTGRES_E2E_PASS";
  const httpPass = httpE2e?.status === "HTTP_E2E_PASS";
  const holdoutPass = strictGate?.stages?.holdout === "HOLDOUT_PASS";
  const coverage = sources?.coverage ?? [];
  const publicationHorizon = sources?.sourcePublicationHorizon;
  const publicationComplete = coverage.length > 0 &&
    coverage.every((day) => day.status === "COMPLETE") &&
    sources?.counts?.partial === 0 && sources?.counts?.pending === 0;
  const documentedFutureHorizon = sources?.futureEventHorizon ?? sources?.scope?.futureEventHorizon;
  const futureEventsVerified = documentedFutureHorizon?.completeness === "VERIFIED" &&
    documentedFutureHorizon?.independentInventory === true;
  const projectionFindings = projections?.findings?.length ?? null;
  const reprojectionReady = manifest?.safeToApply === true && manifest?.unresolved === 0 &&
    manifest?.isolatedReplay?.status === "PASS" && postgresPass && httpPass;
  const syncReady = publicationComplete && holdoutPass && httpPass &&
    sources?.scope?.boundedSyncProbe?.status === "PASS";

  const codeReview = {
    status: regressionPass && postgresPass ? "REVIEWABLE_WITH_LIMITATIONS" : "NOT_READY",
    reasons: [
      ...(!regressionPass ? ["Parser regression or anti-ticker policy evidence is missing."] : []),
      ...(!postgresPass ? ["Isolated PostgreSQL integration evidence is missing."] : []),
      "Code review is distinct from independent data completeness; full repository lint and reviewer approval remain separate checks.",
    ],
  };
  const parser = {
    status: holdoutPass ? "INDEPENDENT_SAMPLE_PASS" : "NOT_VERIFIED",
    reasons: holdoutPass ? [] : ["No independently double-reviewed holdout with verified event fields and category metrics."],
  };
  const reprojection = {
    status: reprojectionReady ? "READY_FOR_HUMAN_APPROVAL" : "NOT_READY",
    reasons: reprojectionReady ? [] : [
      "A source-backed action manifest, zero unresolved identities, isolated replay, PostgreSQL and live local HTTP checks are all required before applying a production reprojection.",
    ],
    evidence: { manifestStatus: manifest?.status ?? "NOT_RUN", unresolved: manifest?.unresolved ?? null,
      projectionFindings, isolatedReplay: manifest?.isolatedReplay?.status ?? "NOT_RUN" },
  };
  const synchronization = {
    status: syncReady ? "READY_FOR_BOUNDED_SYNC" : "NOT_VERIFIED",
    reasons: syncReady ? [] : ["Bounded source pagination, independent parser validation and local HTTP sync/cache behaviour are not jointly verified."],
  };
  const sourceCompleteness = {
    publication: {
      status: publicationComplete ? "COMPLETE_FOR_EXPLICIT_WINDOW_ONLY" : "INCOMPLETE",
      from: publicationHorizon?.from ?? coverage[0]?.date ?? null,
      to: publicationHorizon?.to ?? coverage.at(-1)?.date ?? null,
      daysAudited: coverage.length,
      partialDocuments: sources?.counts?.partial ?? null,
      reason: publicationComplete
        ? "Only the explicitly audited publication dates are covered; this does not establish whole-market archive completeness."
        : "At least one publication cursor, document, or attachment is incomplete or unverified.",
    },
    futureEvents: {
      status: futureEventsVerified ? "INDEPENDENT_FORWARD_INVENTORY_PASS" : "NOT_PROVEN",
      from: documentedFutureHorizon?.from ?? null,
      to: documentedFutureHorizon?.to ?? null,
      reason: futureEventsVerified ? "An independent forward-event inventory was supplied."
        : "A window of source-publication dates does not prove completeness of events in the coming 365 days.",
    },
  };
  const deploymentReady = codeReview.status === "REVIEWABLE_WITH_LIMITATIONS" &&
    parser.status === "INDEPENDENT_SAMPLE_PASS" && reprojectionReady && syncReady &&
    publicationComplete && futureEventsVerified && projectionFindings === 0 && httpPass &&
    strictGate?.status === "FULL_AUDIT_PASS";
  const deployment = {
    status: deploymentReady ? "READY_FOR_SEPARATE_RELEASE_APPROVAL" : "NOT_READY",
    reasons: deploymentReady ? [] : ["Deployment requires all independent evidence dimensions and a separate release decision; this assessor never deploys."],
  };
  return { codeReview, parser, reprojection, synchronization, sourceCompleteness, deployment };
};
