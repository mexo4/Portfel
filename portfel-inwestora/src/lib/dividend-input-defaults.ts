/**
 * UI-only defaults. Numeric inputs render these zeroes as blank fields; the
 * dividend engine still performs the authoritative validation on submit.
 */
export const getBlankDividendNumericInputs = () => ({
  quantity: 0,
  exchangeRate: 0,
});
