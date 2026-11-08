"use client";

import { useState } from "react";
import type { RefObject } from "react";

type FormattedNumberInputProps = {
  label: string;
  value: number;
  min?: number;
  precision?: number;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: number, rawValue: string) => void;
  onFocus?: () => void;
};

const formatter = new Intl.NumberFormat("pl-PL", {
  maximumFractionDigits: 8,
});

export const parseFormattedNumber = (value: string) => {
  const normalizedValue = value
    .replace(/\s/g, "")
    .replace(/\u00a0/g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const parsed = Number(normalizedValue);

  return Number.isFinite(parsed) ? parsed : 0;
};

const formatNumberInputValue = (value: number, precision: number) => {
  if (!Number.isFinite(value) || value === 0) {
    return "";
  }

  return formatter.format(Number(value.toFixed(precision)));
};

export default function FormattedNumberInput({
  label,
  value,
  min,
  precision = 6,
  placeholder,
  inputRef,
  onChange,
  onFocus,
}: FormattedNumberInputProps) {
  const [draft, setDraft] = useState(() => ({
    value,
    precision,
    text: formatNumberInputValue(value, precision),
  }));
  const displayValue = draft.value === value && draft.precision === precision
    ? draft.text
    : formatNumberInputValue(value, precision);

  return (
    <label className="field">
      <span>{label}</span>
      <input
        ref={inputRef}
        inputMode="decimal"
        value={displayValue}
        placeholder={placeholder}
        onFocus={onFocus}
        onChange={(event) => {
          const nextRawValue = event.target.value;
          const parsedValue = parseFormattedNumber(nextRawValue);
          const nextValue =
            typeof min === "number" && parsedValue < min ? min : parsedValue;

          setDraft({ value: nextValue, precision, text: nextRawValue });
          onChange(nextValue, nextRawValue);
        }}
        onBlur={() => {
          setDraft({ value, precision, text: formatNumberInputValue(value, precision) });
        }}
      />
    </label>
  );
}
