import type { CurrencyCode } from "@/types/portfolio";

const DATE_INPUT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}T/;

export const round = (value: number, precision = 2) => {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

export const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const getTodayDateInputValue = () => {
  const now = new Date();
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localNow.toISOString().slice(0, 10);
};

export const toDateInputValue = (
  value?: string,
  fallback = getTodayDateInputValue()
) => {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return fallback;
  }

  if (DATE_INPUT_PATTERN.test(trimmedValue)) {
    return trimmedValue;
  }

  if (ISO_DATE_PREFIX_PATTERN.test(trimmedValue)) {
    return trimmedValue.slice(0, 10);
  }

  const parsedDate = new Date(trimmedValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return fallback;
  }

  const localDate = new Date(
    parsedDate.getTime() - parsedDate.getTimezoneOffset() * 60_000
  );

  return localDate.toISOString().slice(0, 10);
};

export const formatCurrency = (value: number, currency: CurrencyCode = "PLN") => {
  try {
    return new Intl.NumberFormat("pl-PL", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "PLN" ? 2 : 4,
    }).format(value);
  } catch {
    return `${new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: 0,
      maximumFractionDigits: currency === "PLN" ? 2 : 4,
    }).format(value)} ${currency}`;
  }
};

export const formatNumber = (value: number, fractionDigits = 4) =>
  new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  }).format(value);

export const formatDateTime = (value?: string) => {
  if (!value) return "brak";
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
};

export const formatDate = (value?: string) => {
  const normalizedValue = toDateInputValue(value, "");

  if (!normalizedValue) {
    return "brak";
  }

  const [year, month, day] = normalizedValue.split("-").map(Number);

  if (!year || !month || !day) {
    return "brak";
  }

  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
};

export const uniqueBy = <T,>(items: T[], getKey: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const toCurrencyCode = (
  value?: string,
  fallback: CurrencyCode = "PLN"
): CurrencyCode => {
  const upper = value?.trim().toUpperCase();
  return upper ? upper : fallback;
};
