import type { PortfolioAssetGroup } from "@/lib/portfolio-engine";
import type { AssetTableSortMode } from "@/types/portfolio";

export const sortPortfolioAssetGroups = (
  groups: PortfolioAssetGroup[],
  sortMode: AssetTableSortMode
) => {
  const ranked = groups.map((group, index) => ({ group, index }));
  const byManual = (left: (typeof ranked)[number], right: (typeof ranked)[number]) =>
    left.group.groupOrder - right.group.groupOrder ||
    left.index - right.index ||
    left.group.name.localeCompare(right.group.name, "pl");
  const withAvailableValueFirst = (
    leftValue: number | undefined,
    rightValue: number | undefined
  ) => Number(rightValue !== undefined) - Number(leftValue !== undefined);

  ranked.sort((left, right) => {
    if (sortMode === "manual") return byManual(left, right);

    if (sortMode === "daily-gain-desc" || sortMode === "daily-loss-asc") {
      const availability = withAvailableValueFirst(
        left.group.dailyChangeBase,
        right.group.dailyChangeBase
      );
      if (availability) return availability;
      if (left.group.dailyChangeBase === undefined || right.group.dailyChangeBase === undefined) {
        return byManual(left, right);
      }

      return (
        (sortMode === "daily-gain-desc"
          ? right.group.dailyChangeBase - left.group.dailyChangeBase
          : left.group.dailyChangeBase - right.group.dailyChangeBase) || byManual(left, right)
      );
    }

    const availability = withAvailableValueFirst(
      left.group.hasLivePrice ? left.group.profitLossBase : undefined,
      right.group.hasLivePrice ? right.group.profitLossBase : undefined
    );
    if (availability) return availability;
    if (!left.group.hasLivePrice || !right.group.hasLivePrice) return byManual(left, right);

    if (sortMode === "value-desc") return right.group.totalValuePln - left.group.totalValuePln || byManual(left, right);
    if (sortMode === "value-asc") return left.group.totalValuePln - right.group.totalValuePln || byManual(left, right);
    if (sortMode === "profit-percent-desc") return right.group.profitLossPercent - left.group.profitLossPercent || byManual(left, right);
    if (sortMode === "profit-percent-asc") return left.group.profitLossPercent - right.group.profitLossPercent || byManual(left, right);
    if (sortMode === "profit-desc") return right.group.totalProfitLossPln - left.group.totalProfitLossPln || byManual(left, right);
    return left.group.totalProfitLossPln - right.group.totalProfitLossPln || byManual(left, right);
  });

  return ranked.map((entry) => entry.group);
};
