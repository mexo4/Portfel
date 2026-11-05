"use client";

import type { InvestmentPortfolio } from "@/types/portfolio";

type Props = {
  portfolios: InvestmentPortfolio[];
  value: string;
  onChange: (portfolioId: string) => void;
  disabled?: boolean;
  id?: string;
};

/** An explicit destination selector for writes initiated from aggregate views. */
export default function PortfolioTargetSelector({
  portfolios,
  value,
  onChange,
  disabled = false,
  id = "operation-target-portfolio",
}: Props) {
  return (
    <label className="field portfolio-target-selector" htmlFor={id}>
      <span>Portfel docelowy</span>
      <select
        id={id}
        value={value}
        disabled={disabled || portfolios.length === 0}
        onChange={(event) => onChange(event.target.value)}
        required
      >
        <option value="">Wybierz portfel</option>
        {portfolios.map((portfolio) => (
          <option key={portfolio.id} value={portfolio.id}>
            {portfolio.name}
          </option>
        ))}
      </select>
      {portfolios.length === 0 ? (
        <small className="field-note">W wybranym zakresie nie ma portfeli docelowych.</small>
      ) : null}
    </label>
  );
}
