"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import styles from "./page.module.css";
import {
  calculateFire,
  type FireInputs,
} from "./fire-calculator";

const DEFAULT_INPUTS: FireInputs = {
  age: 30,
  portfolio: 100_000,
  monthlyExpenses: 8_000,
  monthlyContribution: 3_000,
  annualReturnPercent: 7,
  inflationPercent: 2.5,
  safeWithdrawalRatePercent: 4,
  useRealValues: true,
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

const formatPercent = (value: number, digits = 1) =>
  `${value.toLocaleString("pl-PL", { maximumFractionDigits: digits })}%`;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

function MoneyInput({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <label className={styles.field} htmlFor={id}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.moneyInput}>
        <input
          id={id}
          type="number"
          min={0}
          max={100_000_000}
          step={100}
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(clamp(Number(event.target.value), 0, 100_000_000))}
        />
        <span>PLN</span>
      </span>
      <small>{hint}</small>
    </label>
  );
}

function SliderField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  suffix: string;
  hint?: string;
}) {
  return (
    <div className={styles.sliderField}>
      <div className={styles.sliderHead}>
        <label htmlFor={id}>{label}</label>
        <strong>{value.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}{suffix}</strong>
      </div>
      <input
        id={id}
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
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

export default function FireCalculator() {
  const [inputs, setInputs] = useState<FireInputs>(DEFAULT_INPUTS);
  const result = useMemo(() => calculateFire(inputs), [inputs]);
  const fiWidth = Math.min(100, Math.max(0, result.fiRatioPercent));
  const finalPoint = result.projection.at(-1) ?? result.projection[0]!;
  const firstFirePoint = result.yearsToFire === null
    ? null
    : result.projection.find((point) => point.year >= result.yearsToFire!);
  const update = <K extends keyof FireInputs>(key: K, value: FireInputs[K]) => {
    setInputs((current) => ({ ...current, [key]: value }));
  };
  const reset = () => setInputs(DEFAULT_INPUTS);

  return (
    <section className={styles.calculatorShell} aria-label="Kalkulator FIRE">
      <div className={styles.controlsPanel}>
        <div className={styles.panelHeading}>
          <div>
            <p className="eyebrow">Założenia</p>
            <h2>Ustaw swoją mapę</h2>
          </div>
          <button type="button" className={styles.resetButton} onClick={reset}>Resetuj</button>
        </div>

        <div className={styles.fieldsGrid}>
          <MoneyInput id="fire-portfolio" label="Aktualny portfel" value={inputs.portfolio} onChange={(value) => update("portfolio", value)} hint="Wartość kapitału, który już pracuje." />
          <MoneyInput id="fire-expenses" label="Miesięczne wydatki" value={inputs.monthlyExpenses} onChange={(value) => update("monthlyExpenses", value)} hint="Kwota potrzebna do wygodnego życia." />
          <MoneyInput id="fire-contribution" label="Miesięczne inwestowanie" value={inputs.monthlyContribution} onChange={(value) => update("monthlyContribution", value)} hint="Regularna wpłata do portfela." />
          <label className={styles.field} htmlFor="fire-age">
            <span className={styles.fieldLabel}>Wiek teraz</span>
            <span className={styles.moneyInput}>
              <input id="fire-age" type="number" min={18} max={80} step={1} inputMode="numeric" value={inputs.age} onChange={(event) => update("age", clamp(Number(event.target.value), 18, 80))} />
              <span>lat</span>
            </span>
            <small>Wiek potrzebny do wyznaczenia horyzontu.</small>
          </label>
        </div>

        <div className={styles.sliders}>
          <SliderField id="fire-return" label="Oczekiwana stopa zwrotu" value={inputs.annualReturnPercent} onChange={(value) => update("annualReturnPercent", value)} min={0} max={15} step={0.1} suffix="%" hint="Założenie matematyczne, nie obietnica wyniku." />
          <SliderField id="fire-inflation" label="Inflacja" value={inputs.inflationPercent} onChange={(value) => update("inflationPercent", value)} min={0} max={10} step={0.1} suffix="%" />
        </div>

        <fieldset className={styles.swrField}>
          <legend>Bezpieczna stopa wypłaty (SWR)</legend>
          <div className={styles.swrOptions}>
            {[3, 3.5, 4, 4.5, 5].map((rate) => (
              <button key={rate} type="button" className={inputs.safeWithdrawalRatePercent === rate ? styles.swrActive : undefined} aria-pressed={inputs.safeWithdrawalRatePercent === rate} onClick={() => update("safeWithdrawalRatePercent", rate)}>{formatPercent(rate)}</button>
            ))}
          </div>
          <small>Zasada 4% to punkt odniesienia. Niższa wartość oznacza większy wymagany kapitał.</small>
        </fieldset>

        <label className={styles.toggle}>
          <input type="checkbox" checked={inputs.useRealValues} onChange={(event) => update("useRealValues", event.target.checked)} />
          <span className={styles.toggleTrack} aria-hidden="true"><span /></span>
          <span><strong>Liczyć w wartościach realnych</strong><small>Uwzględnij inflację w stopie zwrotu, ale pokazuj cel w dzisiejszych złotych.</small></span>
        </label>
      </div>

      <div className={styles.resultsPanel}>
        <div className={styles.resultTopline}>
          <span>Twoja mapa do FIRE</span>
          <span className={styles.resultTag}>{inputs.useRealValues ? "Wartości realne" : "Wartości nominalne"}</span>
        </div>
        <div className={styles.resultHero}>
          <span>Cel FIRE</span>
          <strong>{money.format(result.target)}</strong>
          <p>{inputs.useRealValues ? "Kapitał potrzebny dziś, aby pokryć roczne wydatki przy wybranym SWR." : "Nominalny kapitał potrzebny do pokrycia rocznych wydatków przy wybranym SWR."}</p>
        </div>

        <div className={styles.fiProgress} aria-label={`Wskaźnik FI: ${formatPercent(result.fiRatioPercent, 1)}`}>
          <div className={styles.fiProgressHead}><span>FI ratio</span><strong>{formatPercent(result.fiRatioPercent, 1)}</strong></div>
          <div className={styles.fiProgressTrack}><span style={{ width: `${fiWidth}%` }} /></div>
          <div className={styles.fiProgressScale}><span>Start</span><span>Wolność finansowa</span></div>
        </div>

        <div className={styles.resultStats}>
          <div><span>Szacowany wiek FIRE</span><strong className={result.isReachable ? styles.positive : styles.warning}>{result.isAlreadyFire ? "Już teraz" : result.fireAge ? `${result.fireAge} lat` : "Poza horyzontem"}</strong></div>
          <div><span>Pozostało lat</span><strong>{result.isAlreadyFire ? "0" : result.yearsToFire === null ? "—" : result.yearsToFire}</strong></div>
          <div><span>Dochód miesięczny z portfela</span><strong>{money.format(result.monthlyFireIncome)}</strong></div>
          <div><span>Realna stopa zwrotu</span><strong>{formatPercent(result.realAnnualReturnPercent)}</strong></div>
        </div>

        <div className={styles.timeline} aria-label="Oś czasu do FIRE">
          <div className={styles.timelineLine}><span style={{ left: `${result.isReachable ? Math.min(100, Math.max(0, ((result.yearsToFire ?? 0) / 80) * 100)) : 100}%` }} /></div>
          <div className={styles.timelineLabels}><span>Dziś · {inputs.age} lat</span><strong>{result.isReachable ? (result.isAlreadyFire ? "FIRE osiągnięte" : `około ${result.fireAge} lat`) : "Cel poza 80-letnią symulacją"}</strong></div>
        </div>

        <div className={styles.resultNotice}>
          {result.isReachable
            ? result.isAlreadyFire
              ? "Twój obecny portfel przekracza wyliczony cel. Dalsze wpłaty mogą zwiększyć margines bezpieczeństwa."
              : `Przy tych założeniach cel pojawia się w projekcji po około ${result.yearsToFire} latach.`
            : "Cel może nie zostać osiągnięty w tym scenariuszu. Zmień oszczędności, wydatki albo założenia stopy zwrotu."}
        </div>
      </div>

      <div className={styles.chartCard}>
        <div className={styles.chartHeader}>
          <div><p className="eyebrow">Projekcja</p><h2>Kapitał na drodze do celu</h2></div>
          <div className={styles.chartLegend}><span><i className={styles.valueDot} />Portfel</span><span><i className={styles.targetDot} />Cel FIRE</span></div>
        </div>
        <div className={styles.chart}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 720, height: 340 }}>
            <ComposedChart data={result.projection} margin={{ top: 14, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(20, 35, 48, 0.08)" vertical={false} />
              <XAxis dataKey="year" axisLine={false} tickLine={false} minTickGap={28} tick={{ fill: "#617180", fontSize: 12 }} tickFormatter={(value) => Number(value) === 0 ? "Dziś" : `${value} r.`} />
              <YAxis width={60} axisLine={false} tickLine={false} tick={{ fill: "#617180", fontSize: 12 }} tickFormatter={(value) => compactMoney.format(Number(value))} />
              <Tooltip cursor={{ stroke: "rgba(20, 35, 48, 0.16)" }} contentStyle={{ border: "1px solid rgba(20, 35, 48, 0.12)", borderRadius: 12, background: "#fffdf8", boxShadow: "0 14px 36px rgba(20, 35, 48, 0.12)" }} labelFormatter={(value) => Number(value) === 0 ? "Dziś" : `Po ${Number(value).toLocaleString("pl-PL")} latach`} formatter={(value, name) => [money.format(Number(value)), name === "value" ? "Portfel" : "Cel FIRE"]} />
              <Line type="monotone" dataKey="target" stroke="#d38d38" strokeWidth={2} strokeDasharray="7 7" dot={false} />
              <Line type="monotone" dataKey="value" stroke="#0f766e" strokeWidth={3} dot={false} activeDot={{ r: 5, strokeWidth: 2 }} />
              {firstFirePoint ? <ReferenceLine x={firstFirePoint.year} stroke="#0f766e" strokeDasharray="3 5" label={{ value: "FIRE", fill: "#0f766e", fontSize: 12 }} /> : null}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className={styles.chartSummary}>Po {result.projection.at(-1)?.year ?? 0} latach scenariusz pokazuje {money.format(finalPoint.value)} wartości portfela przy {money.format(finalPoint.contributed)} łącznych wpłatach. Różnica to uproszczony efekt wzrostu kapitału.</p>
      </div>
    </section>
  );
}
