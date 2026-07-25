"use client";

import { ASSET_ENTRY_MODE_OPTIONS } from "@/lib/constants";
import type { AssetEntryMode } from "@/types/portfolio";

type AssetModeSelectorProps = {
  value: AssetEntryMode;
  onChange: (mode: AssetEntryMode) => void;
};

export default function AssetModeSelector({
  value,
  onChange,
}: AssetModeSelectorProps) {
  return (
    <div className="mode-grid">
      {ASSET_ENTRY_MODE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "mode-card is-active" : "mode-card"}
          onClick={() => onChange(option.value)}
        >
          <span className="mode-title">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
