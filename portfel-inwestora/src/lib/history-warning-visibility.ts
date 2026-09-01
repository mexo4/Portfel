const normalizeWarning = (warning: string) =>
  warning
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pl-PL");

export const isSuccessfulHistoryFallbackWarning = (warning: string) => {
  const normalized = normalizeWarning(warning);

  return (
    normalized.includes("uzyto fallbacku z danych zakupu") ||
    (normalized.startsWith("historia ") &&
      normalized.includes("ma braki na poczatku zakresu") &&
      normalized.includes("wyceniono po cenie zakupu"))
  );
};

export const getUserFacingHistoryWarnings = (warnings: string[]) =>
  warnings.filter((warning) => !isSuccessfulHistoryFallbackWarning(warning));
