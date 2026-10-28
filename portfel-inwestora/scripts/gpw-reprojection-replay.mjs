import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stable = (value) => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, stable(value[key])])) : value;
const equal = (left, right) => hash(stable(left)) === hash(stable(right));
const targetActions = (manifest) => manifest.actions.filter((item) =>
  item.eventId && item.proposedAction !== "REVIEW");
const officialId = (url) => {
  try { return `gpw:${new URL(url).searchParams.get("geru_id")}`; } catch { return null; }
};
const targetLabel = (identity) => {
  const [eventType, fiscalPeriod, fiscalYearLabel] = String(identity ?? "").split(":");
  if (!/^(QUARTERLY_REPORT|HALF_YEAR_REPORT|ANNUAL_REPORT)$/.test(eventType) ||
      !/^(Q[1-4]|H1|FY)$/.test(fiscalPeriod) ||
      !/^(20\d{2})(?:\/20\d{2})?$/.test(fiscalYearLabel)) {
    throw new Error("REPLAY_INVALID_TARGET_IDENTITY");
  }
  return { eventType, fiscalPeriod, fiscalYear: Number(fiscalYearLabel.slice(-4)),
    fiscalYearLabel: fiscalYearLabel.includes("/") ? fiscalYearLabel : null };
};

export const assertIsolatedReplayDatabase = (value) => {
  assert.ok(value, "MEXO_GPW_TEST_DATABASE_URL is required; no application DB fallback");
  const url = new URL(value);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(url.hostname), "Loopback PostgreSQL only");
  assert.equal(decodeURIComponent(url.username), "mexo_gpw_test", "Dedicated PostgreSQL role only");
  assert.equal(decodeURIComponent(url.pathname.slice(1)), "mexo_gpw_test", "Dedicated PostgreSQL database only");
};

export const assertIsolatedReplayClient = (client) => {
  const connection = client?.connectionParameters;
  assert.ok(connection && ["127.0.0.1", "localhost", "::1"].includes(connection.host),
    "Replay client must connect to loopback PostgreSQL");
  assert.equal(connection.user, "mexo_gpw_test", "Replay client must use the dedicated role");
  assert.equal(connection.database, "mexo_gpw_test", "Replay client must use the dedicated database");
};

const assertIsolatedReplayServer = async (client) => {
  assertIsolatedReplayClient(client);
  const result = await client.query(`SELECT host(inet_server_addr()) AS host,
    current_database() AS database, current_user AS role`);
  assert.ok(["127.0.0.1", "::1"].includes(result.rows[0]?.host),
    "Replay PostgreSQL server must itself be loopback, not a remote tunnel");
  assert.equal(result.rows[0]?.database, "mexo_gpw_test");
  assert.equal(result.rows[0]?.role, "mexo_gpw_test");
};

export const verifyReplayInputs = (manifest, snapshot) => {
  assert.equal(snapshot?.schemaVersion, 1);
  assert.equal(snapshot?.source, "AIVEN_READ_ONLY_PUBLIC_MARKET_ROWS");
  assert.equal(snapshot.manifestFingerprint, hash(manifest.actions), "MANIFEST_FINGERPRINT_CHANGED");
  const payload = Object.fromEntries(["manifestFingerprint", "instruments", "events", "sources",
    "reports", "history", "projectionChanges"].map((field) => [field, snapshot[field]]));
  assert.equal(snapshot.fingerprint, hash(payload), "SNAPSHOT_FINGERPRINT_CHANGED");
  assert.equal(snapshot.actionCount, targetActions(manifest).length);
  const referencedIds = manifest.actions.filter((item) => item.eventId).map((item) => item.eventId);
  assert.equal(new Set(referencedIds).size, referencedIds.length, "DUPLICATE_MANIFEST_EVENT_ID");
  assert.ok(manifest.actions.every((item) => ["UPDATE", "DEACTIVATE", "LINK_SOURCE", "NO_CHANGE", "REVIEW"]
    .includes(item.proposedAction)), "UNSUPPORTED_MANIFEST_DECISION");
  return snapshot.fingerprint;
};

const insertRow = async (client, table, row) => {
  const columns = Object.keys(row);
  await client.query(`INSERT INTO ${table} (${columns.map((item) => `"${item}"`).join(", ")})
    VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`, Object.values(row));
};

/** Loads only market rows from a signed-off read-only snapshot into the dedicated
 * loopback test DB. Existing IDs make the import fail, not overwrite anything. */
export const seedIsolatedMarketSnapshot = async (client, snapshot) => {
  await assertIsolatedReplayServer(client);
  const ids = snapshot.events.map((item) => item.id);
  const existing = await client.query("SELECT id FROM corporate_events WHERE id = ANY($1::text[])", [ids]);
  assert.equal(existing.rowCount, 0, "ISOLATED_DATABASE_ALREADY_CONTAINS_SNAPSHOT_ROWS");
  await client.query("BEGIN");
  try {
    for (const row of snapshot.instruments) await insertRow(client, "corporate_event_instruments", row);
    for (const row of snapshot.events) await insertRow(client, "corporate_events", row);
    for (const row of snapshot.sources) await insertRow(client, "corporate_event_sources", row);
    for (const row of snapshot.history) await insertRow(client, "corporate_event_history", row);
    for (const row of snapshot.projectionChanges) await insertRow(client, "corporate_event_projection_changes", row);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
};

export const readIsolatedMarketState = async (client, snapshot) => {
  assertIsolatedReplayClient(client);
  const issuerIds = snapshot.instruments.map((item) => item.id);
  const instruments = (await client.query("SELECT * FROM corporate_event_instruments WHERE id = ANY($1::text[]) ORDER BY id", [issuerIds])).rows;
  const events = (await client.query("SELECT * FROM corporate_events WHERE instrument_id = ANY($1::text[]) ORDER BY id", [issuerIds])).rows;
  const sources = (await client.query(`SELECT source.* FROM corporate_event_sources AS source
    JOIN corporate_events AS event ON event.id = source.corporate_event_id
    WHERE event.instrument_id = ANY($1::text[]) ORDER BY source.id`, [issuerIds])).rows;
  const history = (await client.query(`SELECT history.* FROM corporate_event_history AS history
    JOIN corporate_events AS event ON event.id = history.corporate_event_id
    WHERE event.instrument_id = ANY($1::text[]) ORDER BY history.id`, [issuerIds])).rows;
  const projectionChanges = (await client.query(`SELECT change.* FROM corporate_event_projection_changes AS change
    JOIN corporate_events AS event ON event.id = change.corporate_event_id
    WHERE event.instrument_id = ANY($1::text[]) ORDER BY change.id`, [issuerIds])).rows;
  return { instruments, events, sources, history, projectionChanges };
};

const reportForUrl = (snapshot, url) => snapshot.reports.find((item) => item.source_id === officialId(url) &&
  officialId(item.source_url) === officialId(url));
const sourceForUrl = (sources, eventId, url) => sources.find((item) => item.corporate_event_id === eventId &&
  officialId(item.source_url) === officialId(url));
const assertPrecondition = (action, event, sources, snapshot) => {
  const original = snapshot.events.find((item) => item.id === event.id);
  assert.ok(original, "SNAPSHOT_TARGET_MISSING");
  if (!equal(event, original)) throw new Error(`SNAPSHOT_DRIFT:${event.id}`);
  assert.equal(event.active, action.current.active, `MANIFEST_ACTIVE_DRIFT:${event.id}`);
  assert.equal(event.event_date, action.current.eventDate, `MANIFEST_DATE_DRIFT:${event.id}`);
  assert.equal(event.event_identity, action.current.identity, `MANIFEST_IDENTITY_DRIFT:${event.id}`);
  for (const url of action.current.sourceUrls ?? []) {
    if (!sourceForUrl(sources, event.id, url)) throw new Error(`MANIFEST_SOURCE_DRIFT:${event.id}`);
  }
};

const sourceEvidence = (action, event, sources, snapshot) => {
  const urls = action.evidence?.officialUrls ?? [];
  if (!urls.length || urls.some((url) => !/^https:\/\/www\.gpw\.pl\/komunikat\?geru_id=\d+/.test(url))) {
    throw new Error(`OFFICIAL_EVIDENCE_MISSING:${event.id}`);
  }
  const linked = urls.map((url) => sourceForUrl(sources, event.id, url)).filter(Boolean);
  const reports = urls.map((url) => reportForUrl(snapshot, url)).filter(Boolean);
  if (!linked.length && !reports.length) throw new Error(`EVIDENCE_NOT_IN_SNAPSHOT:${event.id}`);
  if (linked.some((item) => item.source_priority < event.source_priority) ||
      (reports.length && event.source_priority > 300) ||
      reports.some((item) => item.issuer_id !== event.instrument_id || item.market !== "GPW")) {
    throw new Error(`LOWER_PRIORITY_OR_FOREIGN_SOURCE:${event.id}`);
  }
  return { linked, reports };
};

const addChange = async (client, action, event, url, timestamp) => {
  await client.query(`INSERT INTO corporate_event_projection_changes
    (id, corporate_event_id, previous_row, reason, source_url, changed_at)
    VALUES ($1, $2, $3::jsonb, $4, $5, $6)`, [randomUUID(), event.id,
    JSON.stringify(event), `REPROJECTION_REPLAY:${action.proposedAction}:${action.reason}`, url, timestamp]);
};

/** All actionable decisions run in one SERIALIZABLE transaction. One REVIEW
 * stays blocked. An injected interruption rolls the entire manifest back. */
export const replayGpwManifest = async (client, manifest, snapshot, {
  interruptAfter = null, idempotentRun = false, expectedPostState = null,
  timestamp = new Date().toISOString(),
} = {}) => {
  await assertIsolatedReplayServer(client);
  verifyReplayInputs(manifest, snapshot);
  const actions = manifest.actions.filter((item) => item.proposedAction !== "REVIEW")
    .sort((a, b) => ({ DEACTIVATE: 0, UPDATE: 1, LINK_SOURCE: 2, NO_CHANGE: 3 }[a.proposedAction] -
      { DEACTIVATE: 0, UPDATE: 1, LINK_SOURCE: 2, NO_CHANGE: 3 }[b.proposedAction]));
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SET LOCAL statement_timeout = '15s'");
    const state = await readIsolatedMarketState(client, snapshot);
    if (idempotentRun && (!expectedPostState || !equal(state, expectedPostState))) {
      throw new Error("IDEMPOTENT_POST_STATE_DRIFT");
    }
    const byId = new Map(state.events.map((item) => [item.id, item]));
    const original = new Map(snapshot.events.map((item) => [item.id, item]));
    const actionIds = new Set(targetActions(manifest).map((item) => item.eventId));
    if (!idempotentRun) {
      for (const action of actions.filter((item) => item.proposedAction === "UPDATE")) {
        const event = byId.get(action.eventId);
        const collision = state.events.find((item) => item.id !== event.id && item.active &&
          item.instrument_id === event.instrument_id && item.event_type === event.event_type &&
          item.event_identity === action.proposedState.identity &&
          !actions.some((candidate) => candidate.eventId === item.id && candidate.proposedAction === "DEACTIVATE"));
        if (collision) throw new Error(`IDENTITY_COLLISION:${event.id}:${collision.id}`);
      }
    }
    if (!equal(state.instruments, snapshot.instruments) ||
        !equal(state.events.filter((item) => !actionIds.has(item.id)),
          snapshot.events.filter((item) => !actionIds.has(item.id)))) {
      throw new Error("NON_MANIFEST_ROW_DRIFT");
    }
    if (!idempotentRun && (!equal(state.sources, snapshot.sources) ||
        !equal(state.history, snapshot.history) ||
        !equal(state.projectionChanges, snapshot.projectionChanges))) {
      throw new Error("SOURCE_OR_PROVENANCE_SNAPSHOT_DRIFT");
    }
    const processed = [];
    for (const action of actions) {
      const event = byId.get(action.eventId);
      if (!event) throw new Error(`TARGET_MISSING:${action.eventId}`);
      const before = original.get(event.id);
      if (idempotentRun) {
        const target = action.proposedState ?? {};
        const alreadyDone = action.proposedAction === "NO_CHANGE" ? equal(event, before)
          : action.proposedAction === "DEACTIVATE" ? event.active === false
            : action.proposedAction === "LINK_SOURCE" ? Boolean(sourceForUrl(state.sources, event.id, target.linkSource))
              : event.active && event.event_date === target.eventDate && event.event_identity === target.identity &&
                (!target.linkSource || Boolean(sourceForUrl(state.sources, event.id, target.linkSource)));
        if (!alreadyDone) throw new Error(`IDEMPOTENT_STATE_MISMATCH:${event.id}`);
        processed.push({ eventId: event.id, decision: action.proposedAction, result: "UNCHANGED" });
        continue;
      }
      assertPrecondition(action, event, state.sources, snapshot);
      const evidence = sourceEvidence(action, event, state.sources, snapshot);
      const url = action.proposedState?.linkSource ?? action.evidence.officialUrls[0];
      if (action.proposedAction === "NO_CHANGE") {
        processed.push({ eventId: event.id, decision: "NO_CHANGE", result: "UNCHANGED" });
      } else if (action.proposedAction === "DEACTIVATE") {
        await addChange(client, action, event, url, timestamp);
        await client.query("UPDATE corporate_events SET active = FALSE, updated_at = $2 WHERE id = $1", [event.id, timestamp]);
        processed.push({ eventId: event.id, decision: "DEACTIVATE", result: "DEACTIVATED" });
      } else if (action.proposedAction === "UPDATE") {
        const target = action.proposedState;
        const label = targetLabel(target.identity);
        if (label.eventType !== event.event_type) throw new Error(`EVENT_TYPE_CHANGE:${event.id}`);
        const collision = state.events.find((item) => item.id !== event.id && item.active &&
          item.instrument_id === event.instrument_id && item.event_type === event.event_type &&
          item.event_identity === target.identity &&
          !actions.some((candidate) => candidate.eventId === item.id && candidate.proposedAction === "DEACTIVATE"));
        if (collision) throw new Error(`IDENTITY_COLLISION:${event.id}:${collision.id}`);
        if (target.linkSource && !evidence.reports.some((item) => item.source_url === target.linkSource &&
            (!event.source_published_at || item.published_at >= event.source_published_at))) {
          throw new Error(`NEW_SOURCE_NOT_VERIFIED:${event.id}`);
        }
        await addChange(client, action, event, url, timestamp);
        await client.query(`UPDATE corporate_events SET event_date = $2, event_identity = $3,
          fiscal_period = $4, fiscal_year = $5, fiscal_year_label = $6, updated_at = $7 WHERE id = $1`,
        [event.id, target.eventDate, target.identity, label.fiscalPeriod, label.fiscalYear,
          label.fiscalYearLabel, timestamp]);
        if (event.event_date !== target.eventDate) {
          await client.query(`INSERT INTO corporate_event_history
            (id, corporate_event_id, previous_event_date, next_event_date, source_url, detected_at)
            VALUES ($1, $2, $3, $4, $5, $6)`, [randomUUID(), event.id, event.event_date,
            target.eventDate, url, timestamp]);
        }
        if (target.linkSource) {
          const report = reportForUrl(snapshot, target.linkSource);
          if (!sourceForUrl(state.sources, event.id, target.linkSource)) {
            await client.query(`INSERT INTO corporate_event_sources
              (id, corporate_event_id, source_type, source_url, source_published_at,
               source_priority, discovered_at, source_title)
              VALUES ($1, $2, 'ISSUER_CURRENT_REPORT', $3, $4, 300, $5, $6)`,
            [randomUUID(), event.id, target.linkSource, report.published_at, timestamp, report.source_title]);
          }
        }
        processed.push({ eventId: event.id, decision: "UPDATE", result: "UPDATED" });
      } else if (action.proposedAction === "LINK_SOURCE") {
        const report = reportForUrl(snapshot, action.proposedState.linkSource);
        if (!report || report.issuer_id !== event.instrument_id || report.market !== "GPW" ||
            report.source_url !== action.proposedState.linkSource ||
            (event.source_published_at && report.published_at < event.source_published_at)) {
          throw new Error(`NEW_SOURCE_NOT_VERIFIED:${event.id}`);
        }
        if (sourceForUrl(state.sources, event.id, action.proposedState.linkSource)) {
          throw new Error(`SOURCE_ALREADY_LINKED:${event.id}`);
        }
        await addChange(client, action, event, url, timestamp);
        await client.query(`INSERT INTO corporate_event_sources
          (id, corporate_event_id, source_type, source_url, source_published_at,
           source_priority, discovered_at, source_title)
          VALUES ($1, $2, 'ISSUER_CURRENT_REPORT', $3, $4, 300, $5, $6)`,
        [randomUUID(), event.id, action.proposedState.linkSource, report.published_at, timestamp, report.source_title]);
        processed.push({ eventId: event.id, decision: "LINK_SOURCE", result: "LINKED" });
      } else throw new Error(`UNSUPPORTED_ACTION:${action.proposedAction}`);
      if (interruptAfter === processed.length) throw new Error(`INJECTED_REPLAY_INTERRUPTION:${interruptAfter}`);
    }
    await client.query("COMMIT");
    return { processed, blocked: manifest.actions.filter((item) => item.proposedAction === "REVIEW")
      .map((item) => ({ documentId: item.current?.documentId, reason: item.reason })) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
};
