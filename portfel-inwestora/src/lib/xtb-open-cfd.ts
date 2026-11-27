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
 * What a new lot of an open CFD knows about its price. Indices and commodities such as US100 have
 * no exchange suffix and no quote source in Mexo, so XTB's price stays until the next import and
 * the automatic refresh leaves it alone. A CFD on a share is refreshed like the share.
 */
export const getOpenCfdLotPrice = (operation: ImportedBrokerOperation) =>
  isOpenCfdRow(operation) && operation.snapshotPrice && operation.positionSnapshotAt
    ? {
        latestPrice: operation.snapshotPrice,
        latestPriceDate: operation.positionSnapshotAt.slice(0, 10),
        latestPriceFetchedAt: operation.positionSnapshotAt,
        lastUpdatedAt: operation.positionSnapshotAt,
        priceSource: (operation.rawSymbol ?? operation.symbol).includes(".") ? ("AUTOMATIC" as const) : ("MANUAL" as const),
      }
    : {};

/** The operation metadata that ties a lot to its XTB position. */
export const getOpenCfdMetadata = (operation: ImportedBrokerOperation) => {
  const key = isOpenCfdRow(operation) ? getCfdPositionKey(operation) : null;
  return key ? { cfdPositionKey: key } : {};
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
    if (open?.positionSnapshotAt && open.snapshotPrice && open.positionSnapshotAt > (next.latestPriceFetchedAt ?? "")) {
      const price = getOpenCfdLotPrice(open);
      // A price the user or a later refresh keeps automatic stays automatic.
      if (next.priceSource === "MANUAL" || !next.latestPrice) {
        repriced += 1;
        next = { ...next, ...price };
      }
    }
    return [next];
  });

  return { assets: closed + reduced + repriced > 0 ? nextAssets : assets, closed, reduced, repriced };
};
