import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildScopedRepairProposal } from "../scripts/gpw-scoped-repair-proposal.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const url = (id) => `https://www.gpw.pl/komunikat?geru_id=${id}`;
const fixture = () => {
  const events = [
    { id: "remove", instrument_id: "issuer", event_type: "QUARTERLY_REPORT",
      event_date: "2027-01-29", event_identity: "QUARTERLY_REPORT:Q2:2026/2027",
      active: true, source_priority: 300 },
    { id: "keep", instrument_id: "issuer", event_type: "QUARTERLY_REPORT",
      event_date: "2027-01-29", event_identity: "QUARTERLY_REPORT:Q2:2026/2027",
      active: true, source_priority: 300 },
  ];
  const actions = [
    { eventId: "remove", proposedAction: "DEACTIVATE", current: { active: true,
      eventDate: "2027-01-29", identity: events[0].event_identity },
    proposedState: { active: false }, evidence: { officialUrls: [url(497077)], explanation: "Duplicate" } },
    { eventId: "keep", proposedAction: "NO_CHANGE", current: { active: true,
      eventDate: "2027-01-29", identity: events[1].event_identity },
    proposedState: { active: true }, evidence: { officialUrls: [url(497077)], explanation: "Keep" } },
    { eventId: null, proposedAction: "REVIEW", current: { documentId: "gpw:499257" },
      evidence: { officialUrls: [url(499257)] }, reason: "Attachment unavailable" },
  ];
  const manifest = { actions };
  const payload = { manifestFingerprint: hash(actions), instruments: [{ id: "issuer" }], events,
    sources: [], reports: [], history: [], projectionChanges: [] };
  const snapshot = { schemaVersion: 1, source: "AIVEN_READ_ONLY_PUBLIC_MARKET_ROWS",
    actionCount: 2, fingerprint: hash(payload), ...payload };
  return { manifest, snapshot };
};

test("scoped proposal keeps linked mutations and NO_CHANGE controls without approving writes", () => {
  const { manifest, snapshot } = fixture();
  const proposal = buildScopedRepairProposal(manifest, snapshot);
  assert.equal(proposal.safeToApply, false);
  assert.equal(proposal.globalReadinessGateUnchanged, true);
  assert.deepEqual(proposal.counts, { mutations: 1, unchangedControls: 1,
    excludedReviews: 1, byAction: { UPDATE: 0, DEACTIVATE: 1, LINK_SOURCE: 0 } });
  assert.deepEqual(proposal.actions[0].relatedActionIds, ["keep"]);
  assert.deepEqual(proposal.actions[1].relatedActionIds, ["remove"]);
  assert.equal(proposal.actions[0].independentSourceReview.status, "PENDING");
  assert.equal(proposal.actions[0].before.rowFingerprint, hash(snapshot.events[0]));
  assert.equal(proposal.excludedReviews[0].documentId, "gpw:499257");
});

test("scoped proposal refuses a mutation sharing an unresolved source", () => {
  const { manifest, snapshot } = fixture();
  manifest.actions[2].evidence.officialUrls = [url(497077)];
  snapshot.manifestFingerprint = hash(manifest.actions);
  snapshot.fingerprint = hash(Object.fromEntries(["manifestFingerprint", "instruments", "events",
    "sources", "reports", "history", "projectionChanges"].map((key) => [key, snapshot[key]])));
  assert.throws(() => buildScopedRepairProposal(manifest, snapshot), /OVERLAPS_UNRESOLVED_REVIEW/);
});

test("scoped proposal refuses to claim independence when REVIEW has no identified source", () => {
  const { manifest, snapshot } = fixture();
  manifest.actions[2].evidence.officialUrls = [];
  snapshot.manifestFingerprint = hash(manifest.actions);
  snapshot.fingerprint = hash(Object.fromEntries(["manifestFingerprint", "instruments", "events",
    "sources", "reports", "history", "projectionChanges"].map((key) => [key, snapshot[key]])));
  assert.throws(() => buildScopedRepairProposal(manifest, snapshot), /REVIEW_SOURCE_UNKNOWN/);
});
