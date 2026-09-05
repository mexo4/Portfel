"use client";

import { useMemo, useState } from "react";

type Point = {
  year: number;
  nominal: number;
  contributed: number;
  real: number;
};

const PLN = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

const PERCENT = new Intl.NumberFormat("pl-PL", {
  style: "percent",
  maximumFractionDigits: 1,
});

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function buildProjection(
  initial: number,
  monthly: number,
  annualReturn: number,
  years: number,
  inflation: number,
  annualFee: number,
): Point[] {
  const months = Math.max(1, Math.round(years * 12));
  const netAnnualReturn = annualReturn - annualFee;
  const monthlyRate = Math.pow(1 + netAnnualReturn / 100, 1 / 12) - 1;

  let balance = initial;
  let contributed = initial;
  const points: Point[] = [
    { year: 0, nominal: balance, contributed, real: balance },
  ];

  for (let month = 1; month <= months; month += 1) {
    balance *= 1 + monthlyRate;
    balance += monthly;
    contributed += monthly;

    if (month % 12 === 0 || month === months) {
      const year = month / 12;
      const real = balance / Math.pow(1 + inflation / 100, year);
      points.push({ year, nominal: balance, contributed, real });
    }
  }

  return points;
}

function Input({
  label,
  value,
  onChange,
  suffix,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix: string;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-zinc-800">
        {label}
      </span>
      <div className="flex min-h-12 items-center rounded-xl border border-zinc-200 bg-white px-3 shadow-sm shadow-zinc-950/[0.02] focus-within:border-zinc-400">
        <input
          className="min-w-0 flex-1 bg-transparent py-2 text-base font-medium tabular-nums outline-none"
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) =>
            onChange(clampNumber(Number(event.target.value), min, max))
          }
        />
        <span className="ml-3 text-sm text-zinc-500">{suffix}</span>
      </div>
    </label>
  );
}

function ProjectionChart({ points }: { points: Point[] }) {
  const width = 1000;
  const height = 320;
  const pad = 30;
  const maxValue = Math.max(...points.map((p) => p.nominal), 1);
  const lastYear = Math.max(points.at(-1)?.year ?? 1, 1);

  const makePath = (key: "nominal" | "contributed" | "real") =>
    points
      .map((point, index) => {
        const x = pad + (point.year / lastYear) * (width - pad * 2);
        const y =
          height -
          pad -
          (point[key] / maxValue) * (height - pad * 2);
        return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ");

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-zinc-600">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-zinc-950" />
          Wartość nominalna
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-zinc-400" />
          Wpłacony kapitał
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-zinc-600" />
          Wartość realna
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Wykres prognozowanej wartości inwestycji"
      >
        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = height - pad - ratio * (height - pad * 2);
          return (
            <line
              key={ratio}
              x1={pad}
              x2={width - pad}
              y1={y}
              y2={y}
              stroke="currentColor"
              className="text-zinc-100"
              strokeWidth="1"
            />
          );
        })}
        <path
          d={makePath("contributed")}
          fill="none"
          stroke="currentColor"
          className="text-zinc-300"
          strokeWidth="6"
          strokeLinecap="round"
        />
        <path
          d={makePath("real")}
          fill="none"
          stroke="currentColor"
          className="text-zinc-500"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d={makePath("nominal")}
          fill="none"
          stroke="currentColor"
          className="text-zinc-950"
          strokeWidth="7"
          strokeLinecap="round"
        />
      </svg>

      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-zinc-400">
        <span>Dziś</span>
        <span>{Math.round(lastYear)} lat</span>
      </div>
    </div>
  );
}

export default function CompoundInterestCalculator() {
  const [initial, setInitial] = useState(10_000);
  const [monthly, setMonthly] = useState(1_000);
  const [annualReturn, setAnnualReturn] = useState(8);
  const [years, setYears] = useState(20);
  const [inflation, setInflation] = useState(2.5);
  const [annualFee, setAnnualFee] = useState(0.2);

  const points = useMemo(
    () =>
      buildProjection(
        initial,
        monthly,
        annualReturn,
        years,
        inflation,
        annualFee,
      ),
    [initial, monthly, annualReturn, years, inflation, annualFee],
  );

  const final = points.at(-1) ?? points[0];
  const investmentGain = final.nominal - final.contributed;
  const gainShare = final.nominal > 0 ? investmentGain / final.nominal : 0;

  return (
    <section className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="rounded-[24px] border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-950/[0.025] sm:p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold tracking-[-0.015em]">
              Założenia
            </h2>
            <p className="mt-1 text-sm leading-5 text-zinc-500">
              Zmień parametry, a wynik przeliczy się automatycznie.
            </p>
          </div>

          <div className="space-y-5">
            <Input label="Kapitał początkowy" value={initial} onChange={setInitial} suffix="PLN" min={0} max={100_000_000} step={100} />
            <Input label="Miesięczna wpłata" value={monthly} onChange={setMonthly} suffix="PLN" min={0} max={1_000_000} step={50} />
            <Input label="Roczna stopa zwrotu" value={annualReturn} onChange={setAnnualReturn} suffix="%" min={-99} max={100} step={0.1} />
            <Input label="Okres" value={years} onChange={setYears} suffix="lat" min={1} max={60} />
            <Input label="Inflacja" value={inflation} onChange={setInflation} suffix="%" min={-10} max={50} step={0.1} />
            <Input label="Roczna opłata" value={annualFee} onChange={setAnnualFee} suffix="%" min={0} max={10} step={0.05} />
          </div>
        </aside>

        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Wartość końcowa", PLN.format(final.nominal), null],
              ["Wpłacony kapitał", PLN.format(final.contributed), null],
              ["Zysk z inwestycji", PLN.format(investmentGain), `${PERCENT.format(gainShare)} wartości końcowej`],
              ["Po inflacji", PLN.format(final.real), "w dzisiejszej sile nabywczej"],
            ].map(([label, value, note]) => (
              <div key={label} className="rounded-2xl border border-zinc-200 bg-white p-5">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-500">{label}</p>
                <p className="mt-3 text-2xl font-semibold tracking-[-0.025em] tabular-nums">{value}</p>
                {note ? <p className="mt-1 text-xs text-zinc-500">{note}</p> : null}
              </div>
            ))}
          </div>

          <ProjectionChart points={points} />

          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-5 py-4">
              <h3 className="font-semibold">Rozwój kapitału</h3>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="sticky top-0 bg-zinc-50 text-left text-xs uppercase tracking-[0.08em] text-zinc-500">
                  <tr>
                    <th className="px-5 py-3 font-medium">Rok</th>
                    <th className="px-5 py-3 text-right font-medium">Wpłaty</th>
                    <th className="px-5 py-3 text-right font-medium">Wartość</th>
                    <th className="px-5 py-3 text-right font-medium">Po inflacji</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {points.slice(1).map((point) => (
                    <tr key={point.year} className="hover:bg-zinc-50/70">
                      <td className="px-5 py-3 font-medium tabular-nums">{Number.isInteger(point.year) ? point.year : point.year.toFixed(1)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-600">{PLN.format(point.contributed)}</td>
                      <td className="px-5 py-3 text-right font-medium tabular-nums">{PLN.format(point.nominal)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-600">{PLN.format(point.real)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs leading-5 text-zinc-500">
            Symulacja nie uwzględnia podatków ani nieregularności rzeczywistych stóp zwrotu. Roczna opłata jest odejmowana od założonej stopy zwrotu.
          </p>
        </div>
      </div>
    </section>
  );
}
