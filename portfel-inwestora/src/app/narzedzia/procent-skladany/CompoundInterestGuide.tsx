import styles from "./page.module.css";
import {
  compoundSingleDepositValue,
  EDUCATIONAL_ANNUAL_RATES,
  EDUCATIONAL_YEARS,
  EDUCATIONAL_PRINCIPAL,
} from "./compound-interest-content";

const pln = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });

export default function CompoundInterestGuide() {
  return (
    <div className={styles.guide}>
      <section className={styles.guideIntro}>
        <div>
          <p className="eyebrow">Zrozum wynik</p>
          <h2>Kapitał może pracować także na wcześniejszym wzroście.</h2>
        </div>
        <div className={styles.guideIntroCopy}>
          <p>
            Procent składany opisuje sytuację, w której wynik z poprzednich
            okresów pozostaje częścią kapitału używanego w kolejnych obliczeniach.
            Jeśli do tego regularnie dopłacasz, z czasem rośnie zarówno suma
            wpłat, jak i baza, od której liczony jest hipotetyczny wzrost.
          </p>
          <p>
            To mechanizm matematyczny, a nie obietnica zysku. W inwestycjach
            stopa zwrotu zmienia się, może być ujemna, a wypłaty lub brak
            reinwestowania zmieniają rzeczywistą ścieżkę kapitału.
          </p>
        </div>
      </section>

      <section className={styles.simpleVsCompound} aria-labelledby="simple-vs-compound-title">
        <div className={styles.simpleVsCompoundCopy}>
          <p className="eyebrow">Krótki przykład</p>
          <h3 id="simple-vs-compound-title">Różnicę widać w czasie</h3>
          <p>
            Przy 1&nbsp;000 zł i stałym założeniu 5% rocznie przez pięć lat
            prosty przyrost od samego kapitału dałby 1&nbsp;250 zł. Przy
            corocznym składaniu wartość wyniosłaby około 1&nbsp;276 zł — bo
            wcześniejszy wzrost także uczestniczy w kolejnych okresach.
          </p>
          <small>To uproszczona ilustracja bez dopłat, kosztów i podatków.</small>
        </div>
        <div className={styles.comparisonValues} aria-label="Porównanie wartości po pięciu latach">
          <div className={styles.simpleValue}>
            <span>Oprocentowanie proste</span>
            <strong>1&nbsp;250 zł</strong>
          </div>
          <div className={styles.compoundValue}>
            <span>Składanie co rok</span>
            <strong>1&nbsp;276 zł</strong>
          </div>
        </div>
      </section>

      <section className={styles.formulaSection} aria-labelledby="formula-title">
        <div className={styles.formulaCopy}>
          <p className="eyebrow">Model kalkulatora</p>
          <h3 id="formula-title">Jak liczymy wpłaty i wzrost?</h3>
          <p>
            Narzędzie przelicza założoną efektywną stopę roczną na równoważną
            stopę miesięczną, a następnie dodaje wpłatę na końcu każdego
            miesiąca. Wzór poniżej opisuje tę samą uproszczoną projekcję.
          </p>
        </div>
        <div className={styles.formulaPanel}>
          <p className={styles.formula}>
            W = P × (1 + i)<sup>m</sup> + C × ((1 + i)<sup>m</sup> − 1) / i
          </p>
          <p className={styles.formulaZeroRate}>
            Gdy i = 0: W = P + C × m
          </p>
          <dl className={styles.formulaDefinitions}>
            <div><dt>W</dt><dd>wartość końcowa</dd></div>
            <div><dt>P</dt><dd>kapitał początkowy</dd></div>
            <div><dt>C</dt><dd>stała wpłata na koniec miesiąca</dd></div>
            <div><dt>m</dt><dd>liczba miesięcy</dd></div>
            <div><dt>i</dt><dd>stopa miesięczna: (1 + r)<sup>1/12</sup> − 1</dd></div>
          </dl>
          <small>r oznacza roczną stopę w zapisie dziesiętnym, np. 5% = 0,05.</small>
        </div>
      </section>

      <section className={styles.scenarioSection} aria-labelledby="scenario-title">
        <div className={styles.scenarioHeading}>
          <div>
            <p className="eyebrow">Skala czasu</p>
            <h3 id="scenario-title">Ta sama kwota, różne założenia</h3>
          </div>
          <p>
            Wartość jednorazowej wpłaty {pln.format(EDUCATIONAL_PRINCIPAL)} zł,
            bez kolejnych dopłat, przy stałej efektywnej stopie rocznej.
          </p>
        </div>
        <div className={styles.scenarioTableWrap}>
          <table className={styles.scenarioTable}>
            <caption>Ilustracyjna wartość kapitału w kolejnych latach</caption>
            <thead>
              <tr>
                <th scope="col">Założenie</th>
                {EDUCATIONAL_YEARS.map((year) => (
                  <th scope="col" key={year}>{year === 0 ? "Start" : `${year} lat`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EDUCATIONAL_ANNUAL_RATES.map((rate) => (
                <tr key={rate}>
                  <th scope="row">{rate}% rocznie</th>
                  {EDUCATIONAL_YEARS.map((year) => (
                    <td key={year}>{pln.format(compoundSingleDepositValue(rate, year))} zł</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.tableNote}>
          Przykład zakłada niezmienną stopę i nie uwzględnia inflacji, opłat ani
          podatku. Stopy są scenariuszami matematycznymi, nie prognozą rynku.
        </p>
      </section>

      <section className={styles.driversSection} aria-labelledby="drivers-title">
        <div className={styles.driversHeading}>
          <p className="eyebrow">Co zmienia rezultat</p>
          <h3 id="drivers-title">Cztery elementy, które warto rozumieć</h3>
        </div>
        <ol className={styles.driverList}>
          <li>
            <span>01</span><div><h4>Czas</h4><p>Dłuższy horyzont daje większej części kapitału więcej okresów na wzrost lub spadek.</p></div>
          </li>
          <li>
            <span>02</span><div><h4>Regularność wpłat</h4><p>Stałe dopłaty zwiększają bazę, ale ich termin ma znaczenie: tutaj każda trafia na koniec miesiąca.</p></div>
          </li>
          <li>
            <span>03</span><div><h4>Założona stopa</h4><p>Niewielka zmiana założenia mocno wpływa na wynik wieloletni. W praktyce stopa nie jest stała.</p></div>
          </li>
          <li>
            <span>04</span><div><h4>Reinwestowanie</h4><p>Jeśli odsetki lub dywidendy są wypłacane i wydawane, nie powiększają automatycznie kapitału w kolejnych okresach.</p></div>
          </li>
        </ol>
      </section>

      <aside className={styles.limitsNote} aria-labelledby="limits-title">
        <div className={styles.limitsMark} aria-hidden="true">i</div>
        <div>
          <p className="eyebrow">Ograniczenia symulacji</p>
          <h3 id="limits-title">Rzeczywista droga nie jest gładką linią.</h3>
          <p>
            Model nie odejmuje podatków, prowizji i opłat za zarządzanie ani
            nie koryguje wyniku o inflację lub kursy walut. Nie pokazuje też
            zmienności i kolejności stóp zwrotu. Koszty obniżają kapitał, a
            inflacja zmniejsza jego przyszłą siłę nabywczą. Ten sam mechanizm
            procentu składanego może powiększać również zadłużenie, gdy odsetki
            pozostają niespłacone.
          </p>
        </div>
      </aside>
    </div>
  );
}
