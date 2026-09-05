"use client";

import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "./page.module.css";

type ProjectionPoint = {
  year: number;
  value: number;
  contributed: number;
  gain: number;
};

const money = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

const compactMoney = new Intl.NumberFormat("pl-PL", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function projectInvestment(
  initial: number,
  monthlyContribution: number,
  annualReturn: number,
  years: number,
): ProjectionPoint[] {
  const months = Math.round(years * 12);
  const monthlyRate = Math.pow(1 + annualReturn / 100, 1 / 12) - 1;
  let value = initial;
  let contributed = initial;

  const points: ProjectionPoint[] = [
    { year: 0, value, contributed, gain: value - contributed },
  ];

  for (let month = 1; month <= months; month += 1) {
    value *= 1 + monthlyRate;
    value += monthlyContribution;
    contributed += monthlyContribution;

    if (month % 12 === 0 || month === months) {
      points.push({
        year: month / 12,
        value,
        contributed,
        gain: value - contributed,
      });
    }
  }

  return points;
}

function MoneyInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <div className={styles.moneyInput}>
        <input
          type="number"
          min={0}
          max={100_000_000}
          step={100}
          inputMode="numeric"
          value={value}
          onChange={(event) =>
            onChange(clamp(Number(event.target.value), 0, 100_000_000))
          }
        />
        <span>PLN</span>
      </div>
      <small>{hint}</small>
    </label>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  suffix: string;
}) {
  return (
    <div className={styles.sliderField}>
      <div className={styles.sliderHead}>
        <span>{label}</span>
        <strong>{value.toLocaleString("pl-PL")}{suffix}</strong>
      </div>
      <input
        className={styles.range}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className={styles.rangeScale}>
        <span>{min}{suffix}</span>
        <span>{max}{suffix}</span>
      </div>
    </div>
  );
}

export default function CompoundInterestCalculator() {
  const [initial, setInitial] = useState(10_000);
  const [monthlyContribution, setMonthlyContribution] = useState(1_000);
  const [annualReturn, setAnnualReturn] = useState(7);
  const [years, setYears] = useState(20);

  const projection = useMemo(
    () => projectInvestment(initial, monthlyContribution, annualReturn, years),
    [initial, monthlyContribution, annualReturn, years],
  );

  const final = projection.at(-1) ?? projection[0];
  const gainShare = final.value > 0 ? (final.gain / final.value) * 100 : 0;
  const contributionShare = Math.max(0, 100 - gainShare);

  return (
    <section className={styles.calculatorShell}>
      <div className={styles.controlsPanel}>
        <div className={styles.panelHeading}>
          <div>
            <p className="eyebrow">Założenia</p>
            <h2>Ustaw swój scenariusz</h2>
          </div>
          <button
            type="button"
            className={styles.resetButton}
            onClick={() => {
              setInitial(10_000);
              setMonthlyContribution(1_000);
              setAnnualReturn(7);
              setYears(20);
            }}
          >
            Resetuj
          </button>
        </div>

        <div className={styles.fieldsGrid}>
          <MoneyInput
            label="Kwota początkowa"
            value={initial}
            onChange={setInitial}
            hint="Kapitał, od którego zaczynasz."
          />
          <MoneyInput
            label="Miesięczna wpłata"
            value={monthlyContribution}
            onChange={setMonthlyContribution}
            hint="Regularna kwota dopisywana co miesiąc."
          />
        </div>

        <div className={styles.sliders}>
          <SliderField
            label="Roczna stopa zwrotu"
            value={annualReturn}
            onChange={setAnnualReturn}
            min={0}
            max={20}
            step={0.5}
            suffix="%"
          />
          <SliderField
            label="Horyzont czasowy"
            value={years}
            onChange={setYears}
            min={1}
            max={50}
            step={1}
            suffix=" lat"
          />
        </div>
      </div>

      <div className={styles.resultsPanel}>
        <div className={styles.resultHero}>
          <span>Wartość inwestycji po {years} latach</span>
          <strong>{money.format(final.value)}</strong>
          <p>
            Przy założonej stopie zwrotu {annualReturn.toLocaleString("pl-PL")}% rocznie.
          </p>
        </div>

        <div className={styles.resultStats}>
          <div>
            <span>Suma wpłat</span>
            <strong>{money.format(final.contributed)}</strong>
          </div>
          <div>
            <span>Przyrost wartości</span>
            <strong className={styles.positive}>{money.format(final.gain)}</strong>
          </div>
        </div>

        <div className={styles.composition}>
          <div className={styles.compositionLabels}>
            <span><i className={styles.contributionDot} />Wpłaty</span>
            <span><i className={styles.gainDot} />Zysk</span>
          </div>
          <div className={styles.compositionBar}>
            <span
              className={styles.contributionBar}
              style={{ width: `${contributionShare}%` }}
            />
            <span
              className={styles.gainBar}
              style={{ width: `${Math.max(0, gainShare)}%` }}
            />
          </div>
        </div>
      </div>

      <div className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <div>
            <p className="eyebrow">Wzrost kapitału</p>
            <h2>Jak zmienia się wartość inwestycji</h2>
          </div>
          <div className={styles.chartLegend}>
            <span><i className={styles.valueDot} />Wartość inwestycji</span>
            <span><i className={styles.contributionDot} />Suma wpłat</span>
          </div>
        </div>

        <div className={styles.chart}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={projection}
              margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id="mexoValueArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0f766e" stopOpacity={0.30} />
                  <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(20, 35, 48, 0.08)" vertical={false} />
              <XAxis
                dataKey="year"
                axisLine={false}
                tickLine={false}
                minTickGap={28}
                tick={{ fill: "#617180", fontSize: 12 }}
                tickFormatter={(value) => Number(value) === 0 ? "Dziś" : `${value} r.`}
              />
              <YAxis
                width={58}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#617180", fontSize: 12 }}
                tickFormatter={(value) => compactMoney.format(Number(value))}
              />
              <Tooltip
                cursor={{ stroke: "rgba(20, 35, 48, 0.16)" }}
                contentStyle={{
                  border: "1px solid rgba(20, 35, 48, 0.12)",
                  borderRadius: 12,
                  background: "#fffdf8",
                  boxShadow: "0 14px 36px rgba(20, 35, 48, 0.12)",
                  fontFamily: "var(--font-sans)",
                }}
                labelFormatter={(value) =>
                  Number(value) === 0 ? "Dziś" : `Po ${Number(value).toLocaleString("pl-PL")} latach`
                }
                formatter={(value, name) => [
                  money.format(Number(value)),
                  name === "value" ? "Wartość inwestycji" : "Suma wpłat",
                ]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#0f766e"
                strokeWidth={3}
                fill="url(#mexoValueArea)"
                activeDot={{ r: 5, strokeWidth: 2 }}
              />
              <Line
                type="monotone"
                dataKey="contributed"
                stroke="#617180"
                strokeWidth={2}
                strokeDasharray="6 6"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.chartSummary}>
          <p>
            Po {years} latach około <strong>{Math.max(0, gainShare).toFixed(0)}%</strong>{" "}
            wartości końcowej pochodzi z wypracowanego wzrostu, a reszta z wpłat.
          </p>
        </div>
      </div>

      <p className={styles.disclaimer}>
        To uproszczona symulacja. Nie uwzględnia podatków, opłat, inflacji,
        zmian kursów walut ani zmienności rynku. Przyjęta stopa zwrotu nie jest
        prognozą ani gwarancją przyszłych wyników.
      </p>
    </section>
  );
}
