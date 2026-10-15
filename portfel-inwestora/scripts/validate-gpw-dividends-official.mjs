import {
  getGlobalDividends,
  synchronizeGlobalDividends,
} from "../src/lib/server/corporate-events.ts";
import { synchronizeGpwDividendReports } from "../src/lib/server/espi.ts";

const getWarsawDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const addYear = (date) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCFullYear(value.getUTCFullYear() + 1);
  return value.toISOString().slice(0, 10);
};

const today = getWarsawDate();
const sourceSync = await synchronizeGpwDividendReports({ force: true });
const sync = await synchronizeGlobalDividends({ force: true, refreshSource: false });
const events = await getGlobalDividends({ fromDate: today, toDate: addYear(today) });

console.log(JSON.stringify({
  source: "official GPW ESPI public feed",
  sourceSync,
  fromDate: today,
  toDate: addYear(today),
  sync,
  count: events.length,
  events: events.map((event) => ({
    ticker: event.ticker,
    recordDate: event.recordDate,
    paymentDate: event.paymentDate,
    amount: event.dividendPerShare,
    currency: event.dividendCurrency,
    status: event.status,
    sourceUrl: event.source?.sourceUrl,
  })),
}, null, 2));

process.exit(0);
