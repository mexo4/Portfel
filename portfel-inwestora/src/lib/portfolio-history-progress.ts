export type PortfolioHistoryProgressUpdate = {
  completed: number;
  total: number;
  phase: string;
};

export type PortfolioHistoryProgress = PortfolioHistoryProgressUpdate & {
  percentage: number;
  done: boolean;
};

export const toPortfolioHistoryProgress = (
  update: PortfolioHistoryProgressUpdate,
  done = false,
): PortfolioHistoryProgress => {
  const total = Math.max(1, Math.floor(update.total));
  const completed = Math.max(0, Math.min(total, Math.floor(update.completed)));
  return {
    completed,
    total,
    phase: update.phase,
    percentage: done ? 100 : Math.floor((completed / total) * 100),
    done,
  };
};
