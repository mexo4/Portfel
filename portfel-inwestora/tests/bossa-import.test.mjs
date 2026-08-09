import assert from "node:assert/strict";
import test from "node:test";
import { parseBrokerOperationsCsv } from "../src/lib/import-operations.ts";

test("parses BM BOS purchase and sale settlements with an ISIN alias", () => {
  const result = parseBrokerOperationsCsv(
    [
      "data;tytuł operacji;szczegóły;kwota",
      "2026-08-07;Rozliczenie transakcji kupna:;MODIVO (PLCCC0000016) 150 x 90.00 PLN nr 000000000730;-13533,75",
      "2026-08-06;Rozliczenie transakcji sprzedaży:;MODIVO (PLCCC0000016) 100 x 99.22 PLN nr 000000004118;9897,19",
    ].join("\n"),
    "bossa"
  );

  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.operations.length, 2);
  assert.deepEqual(
    result.operations.map((operation) => ({
      side: operation.side,
      symbol: operation.symbol,
      quantity: operation.quantity,
      price: operation.price,
      feePln: operation.feePln,
    })),
    [
      { side: "buy", symbol: "MDV.WA", quantity: 150, price: 90, feePln: 33.75 },
      { side: "sell", symbol: "MDV.WA", quantity: 100, price: 99.22, feePln: 24.81 },
    ]
  );
});
