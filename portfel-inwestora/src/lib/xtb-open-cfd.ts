import { getCfdQuoteSource } from "@/lib/cfd";
import { XTB_OPEN_CFD_KEY, type ImportedBrokerOperation } from "@/lib/import-operations";
import type { PortfolioAsset, PortfolioOperation } from "@/types/portfolio";

/**
 * Open CFDs follow the state XTB reports. A newer file closes or reduces a position when it has a
 * closing row with the same position number. The result of the closed part is not touched here:
 * it is already booked from XTB's "Close trade" cash row, so it is counted once.
 */

export const getCfdPositionKey = (operation: Pick<ImportedBrokerOperation, "accountNumber" | "brokerPositionId">) =>
  operation.brokerPositionId ? `${operation.accountNumber ?? ""}:${operation.brokerPositionId}` : null;

const isOpenCfdRow = (operation: ImportedBrokerOperation) => Boolean(operation.importKey?.startsWith(XTB_OPEN_CFD_KEY));

/**
 * What a new lot of an open CFD knows about its price and leverage. It starts at XTB's price; a
 * CFD with a quote source is then refreshed, the others keep XTB's price until a newer file.
 * No price source is marked here: only a price the user sets is "manual", and that mark lives in
 * the quote table, not in the saved lot.
 */
export const getOpenCfdLotPrice = (operation: ImportedBrokerOperation) =>
  isOpenCfdRow(operation) && operation.snapshotPrice && operation.positionSnapshotAt
    ? {
        latestPrice: operation.snapshotPrice,
        latestPriceDate: operation.positionSnapshotAt.slice(0, 10),
        latestPriceFetchedAt: operation.positionSnapshotAt,
        lastUpdatedAt: operation.positionSnapshotAt,
        ...(operation.leverage ? { leverage: operation.leverage } : {}),
      }
    : {};

/** The operation metadata that ties a lot to its XTB position. */
export const getOpenCfdMetadata = (operation: ImportedBrokerOperation) => {
  const key = isOpenCfdRow(operation) ? getCfdPositionKey(operation) : null;
  return key ? { cfdPositionKey: key } : {};
};

/**
 * Adds the details of closed CFDs to their stored cash rows, including rows imported before Mexo
 * read them. Only metadata changes: no amount is added or moved.
 */
export const attachClosedCfdDetails = (operations: PortfolioOperation[], imported: ImportedBrokerOperation[]) => {
  const trades = new Map<string, NonNullable<ImportedBrokerOperation["cfdTrade"]>>();
  for (const operation of imported) {
    if (!operation.cfdTrade) continue;
    for (const key of [operation.importKey, ...(operation.legacyImportKeys ?? [])]) {
      if (key) trades.set(key, operation.cfdTrade);
    }
  }
  let attached = 0;
  const next = operations.map((operation) => {
    const key = operation.metadata.importKey;
    const trade = operation.operationType === "CUSTOM" && typeof key === "string" ? trades.get(key) : undefined;
    if (!trade || operation.metadata.cfdTrade) return operation;
    attached += 1;
    return { ...operation, metadata: { ...operation.metadata, cfdTrade: trade } };
  });
  return { operations: attached > 0 ? next : operations, attached };
};

export const reconcileXtbOpenCfds = ({ assets, operations, imported }: {
  assets: PortfolioAsset[];
  operations: PortfolioOperation[];
  imported: ImportedBrokerOperation[];
}) => {
  const keyByLot = new Map<string, string>();
  for (const operation of operations) {
    const { cfdPositionKey, lotId } = operation.metadata;
    if (typeof cfdPositionKey === "string" && typeof lotId === "string") keyByLot.set(lotId, cfdPositionKey);
  }

  const stillOpen = new Map<string, ImportedBrokerOperation>();
  const closing = new Set<string>();
  for (const operation of imported) {
    const key = getCfdPositionKey(operation);
    if (!key || !operation.positionSnapshotAt) continue;
    if (isOpenCfdRow(operation)) stillOpen.set(key, operation);
    else if (operation.operationType === "CUSTOM") closing.add(key);
  }

  let closed = 0;
  let reduced = 0;
  let repriced = 0;
  let completed = 0;
  const nextAssets = assets.flatMap((asset) => {
    const key = keyByLot.get(asset.id);
    if (!key) return [asset];
    const open = stillOpen.get(key);
    let next = asset;
    if (closing.has(key)) {
      // An older file can only list as much or more than is left, so it never raises a position.
      const remaining = open?.quantity ?? 0;
      if (remaining <= 1e-9) {
        closed += 1;
        return [];
      }
      if (remaining < next.quantity - 1e-9) {
        reduced += 1;
        next = { ...next, quantity: remaining };
      }
    }
    // Positions imported before the leverage was read get it from any later file.
    if (open?.leverage && !next.leverage) {
      completed += 1;
      next = { ...next, leverage: open.leverage };
    }
    if (open?.positionSnapshotAt && open.snapshotPrice && open.positionSnapshotAt > (next.latestPriceFetchedAt ?? "")) {
      // Only a file ever moves the price of a CFD without a quote source, unless the user set one.
      // A CFD with a source is refreshed, which is newer than any file.
      if (next.priceSource !== "MANUAL" && (!getCfdQuoteSource(next) || !next.latestPrice)) {
        repriced += 1;
        next = { ...next, ...getOpenCfdLotPrice(open) };
      }
    }
    return [next];
  });

  return { assets: closed + reduced + repriced + completed > 0 ? nextAssets : assets, closed, reduced, repriced, completed };
};
