import {
  toPortfolioHistoryProgress,
  type PortfolioHistoryProgress,
  type PortfolioHistoryProgressUpdate,
} from "@/lib/portfolio-history-progress";

type ProgressAlias = {
  userId: string;
  buildKey: string;
  expiresAt: number;
};

type ProgressEntry = {
  userId: string;
  update: PortfolioHistoryProgress;
  expiresAt: number;
};

const PROGRESS_TTL_MS = 2 * 60 * 1_000;
const MAX_PROGRESS_ENTRIES = 128;
const aliases = new Map<string, ProgressAlias>();
const progressByBuildKey = new Map<string, ProgressEntry>();

const prune = (now = Date.now()) => {
  for (const [id, alias] of aliases) {
    if (alias.expiresAt <= now) aliases.delete(id);
  }
  for (const [key, entry] of progressByBuildKey) {
    if (entry.expiresAt <= now) progressByBuildKey.delete(key);
  }
  while (aliases.size > MAX_PROGRESS_ENTRIES) {
    const oldest = aliases.keys().next().value;
    if (oldest === undefined) break;
    aliases.delete(oldest);
  }
  while (progressByBuildKey.size > MAX_PROGRESS_ENTRIES) {
    const oldest = progressByBuildKey.keys().next().value;
    if (oldest === undefined) break;
    progressByBuildKey.delete(oldest);
  }
};

const isSafeProgressId = (progressId: string) => /^[A-Za-z0-9_-]{16,128}$/.test(progressId);

export const registerPortfolioHistoryProgress = (
  progressId: string | undefined,
  userId: string,
  buildKey: string,
  preserveExistingBuildProgress = false,
) => {
  prune();
  if (!progressId || !isSafeProgressId(progressId)) return false;
  const expiresAt = Date.now() + PROGRESS_TTL_MS;
  aliases.set(progressId, { userId, buildKey, expiresAt });
  progressByBuildKey.set(buildKey, {
    userId,
    update: preserveExistingBuildProgress
      ? progressByBuildKey.get(buildKey)?.update ?? toPortfolioHistoryProgress({
          completed: 0,
          total: 1,
          phase: "Przygotowuję historię portfela",
        })
      : toPortfolioHistoryProgress({
          completed: 0,
          total: 1,
          phase: "Przygotowuję historię portfela",
        }),
    expiresAt,
  });
  return true;
};

export const reportPortfolioHistoryProgress = (
  buildKey: string,
  userId: string,
  update: PortfolioHistoryProgressUpdate,
) => {
  prune();
  const previous = progressByBuildKey.get(buildKey);
  if (previous && previous.userId !== userId) return;
  progressByBuildKey.set(buildKey, {
    userId,
    update: toPortfolioHistoryProgress(update),
    expiresAt: Date.now() + PROGRESS_TTL_MS,
  });
};

export const finishPortfolioHistoryProgress = (
  buildKey: string,
  userId: string,
  phase = "Wykres gotowy",
) => {
  prune();
  const previous = progressByBuildKey.get(buildKey);
  if (previous && previous.userId !== userId) return;
  const current = previous?.update ?? toPortfolioHistoryProgress({ completed: 0, total: 1, phase });
  progressByBuildKey.set(buildKey, {
    userId,
    update: toPortfolioHistoryProgress({
      completed: current.total,
      total: current.total,
      phase,
    }, true),
    expiresAt: Date.now() + PROGRESS_TTL_MS,
  });
};

export const failPortfolioHistoryProgress = (buildKey: string, userId: string) => {
  prune();
  const previous = progressByBuildKey.get(buildKey);
  if (previous && previous.userId !== userId) return;
  const current = previous?.update ?? toPortfolioHistoryProgress({ completed: 0, total: 1, phase: "Błąd historii" });
  progressByBuildKey.set(buildKey, {
    userId,
    update: {
      ...current,
      phase: "Nie udało się pobrać historii",
      done: true,
    },
    expiresAt: Date.now() + PROGRESS_TTL_MS,
  });
};

export const getPortfolioHistoryProgress = (
  progressId: string,
  userId: string,
): PortfolioHistoryProgress | undefined => {
  prune();
  const alias = aliases.get(progressId);
  if (!alias || alias.userId !== userId) return undefined;
  const entry = progressByBuildKey.get(alias.buildKey);
  if (!entry || entry.userId !== userId) return undefined;
  return entry.update;
};
