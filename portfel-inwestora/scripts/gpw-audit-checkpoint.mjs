import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 1;
const MAX_HTML_BYTES = 1_000_000;
const MAX_CHECKPOINT_AGE_MS = 24 * 60 * 60 * 1_000;
const TRANSIENT_REASONS = new Set(["TIMEOUT", "FETCH_ERROR", "HTTP_429", "HTTP_5XX"]);

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** A retry never follows a CAPTCHA/403/404 or retries a parser/format failure. */
export const readAttachmentWithBoundedRetry = async (url, read, {
  maxAttempts = 2, wait = pause,
} = {}) => {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("Attachment audit attempt limit must be between 1 and 3.");
  }
  let result;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await read(url);
    if (result.status === "READ" || !TRANSIENT_REASONS.has(result.reason) || attempt === maxAttempts) {
      return { result, attempts: attempt };
    }
    // A rate-limit response deserves a longer pause than a network timeout.
    await wait(result.reason === "HTTP_429" ? 2_000 * 2 ** (attempt - 1)
      : 250 * 2 ** (attempt - 1));
  }
  throw new Error("Unreachable attachment retry state.");
};

const readCheckpoint = async (filePath) => {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed?.schemaVersion !== SCHEMA_VERSION || typeof parsed.entries !== "object" ||
        parsed.entries === null || Array.isArray(parsed.entries)) {
      throw new Error("Unsupported GPW audit checkpoint format.");
    }
    return parsed.entries;
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
};

const writeCheckpoint = async (filePath, entries) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(), entries }, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
};

const isRecent = (value, now) => typeof value === "string" && Number.isFinite(Date.parse(value)) &&
  now - Date.parse(value) >= 0 && now - Date.parse(value) <= MAX_CHECKPOINT_AGE_MS;

/** Stores public-source HTML and unresolved attachment diagnostics outside Git.
 * Cached HTML is reparsed on resume, so a changed parser cannot reuse old
 * parser outputs. Listing cursors are always refetched. */
export const createGpwAuditCheckpoint = async ({ outputDir, resume = false, now = () => Date.now() }) => {
  const detailPath = path.join(outputDir, "source-detail-checkpoint.json");
  const attachmentPath = path.join(outputDir, "attachment-issues-checkpoint.json");
  const details = await readCheckpoint(detailPath);
  const attachments = await readCheckpoint(attachmentPath);
  const counters = { cachedDetailsReused: 0, attachmentFailuresReused: 0,
    transientRetries: 0, detailsSaved: 0, attachmentChecks: 0 };

  return {
    counters,
    async fetchDocument(url, fetcher) {
      const prior = details[url];
      if (resume && prior?.url === url && isRecent(prior.checkedAt, now()) &&
          typeof prior.document === "string" && Buffer.byteLength(prior.document, "utf8") <= MAX_HTML_BYTES) {
        counters.cachedDetailsReused += 1;
        return { status: "SUCCESS", document: prior.document };
      }
      const result = await fetcher(url);
      if (result.status === "SUCCESS" && Buffer.byteLength(result.document, "utf8") <= MAX_HTML_BYTES) {
        details[url] = { url, checkedAt: new Date(now()).toISOString(), document: result.document };
        await writeCheckpoint(detailPath, details);
        counters.detailsSaved += 1;
      }
      return result;
    },
    async readAttachment(url, reader, wait = pause) {
      const prior = attachments[url];
      if (resume && prior?.url === url && prior?.result?.status === "UNREADABLE" &&
          !TRANSIENT_REASONS.has(prior.result.reason) && isRecent(prior.checkedAt, now())) {
        counters.attachmentFailuresReused += 1;
        return prior.result;
      }
      const { result, attempts } = await readAttachmentWithBoundedRetry(url, reader, { wait });
      counters.attachmentChecks += 1;
      counters.transientRetries += attempts - 1;
      attachments[url] = { url, checkedAt: new Date(now()).toISOString(), attempts,
        result: result.status === "READ" ? { status: "READ" } : result };
      await writeCheckpoint(attachmentPath, attachments);
      return result;
    },
  };
};
