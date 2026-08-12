import assert from "node:assert/strict";
import test from "node:test";
import { parseBrokerOperationsCsv } from "../src/lib/import-operations.ts";
import { getPortfolioInstrumentId } from "../src/lib/operation-engine.ts";

const parseCryptoRows = (rows) =>
  parseBrokerOperationsCsv(
    [
      "Type;Date;Symbol;Name;Quantity;Price;Currency;Value",
      ...rows,
    ].join("\n"),
    "generic"
  );

test("normalizes broker BTC pairs and the XTB Bitcoin label to one crypto identity", () => {
  const result = parseCryptoRows([
    "Buy;10.08.2026;BTCUSD;Bitcoin;0,002;66 831,90;USD;133,6638",
    "Buy;11.08.2026;BTC-USD;Bitcoin;0.00001;66831.90;USD;0.668319",
    "Buy;12.08.2026;BITCOIN;Bitcoin;1.5;66831.90;USD;100247.85",
  ]);

  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.operations.length, 3);
  assert.deepEqual(
    result.operations.map((operation) => ({
      symbol: operation.symbol,
      kind: operation.kind,
      provider: operation.provider,
      providerId: operation.providerId,
      currency: operation.currency,
      quantity: operation.quantity,
    })),
    [
      {
        symbol: "BTC",
        kind: "crypto",
        provider: "coingecko",
        providerId: "bitcoin",
        currency: "USD",
        quantity: 0.002,
      },
      {
        symbol: "BTC",
        kind: "crypto",
        provider: "coingecko",
        providerId: "bitcoin",
        currency: "USD",
        quantity: 0.00001,
      },
      {
        symbol: "BTC",
        kind: "crypto",
        provider: "coingecko",
        providerId: "bitcoin",
        currency: "USD",
        quantity: 1.5,
      },
    ]
  );
  assert.equal(
    new Set(
      result.operations.map((operation) =>
        getPortfolioInstrumentId("portfolio-1", {
          kind: operation.kind,
          symbol: operation.symbol,
        })
      )
    ).size,
    1
  );
});

test("keeps a fractional BTC purchase on the existing portfolio instrument", () => {
  const result = parseCryptoRows([
    "Buy;10.08.2026;BTC;Bitcoin;0.002;66831.90;USD;133.6638",
  ]);
  const [operation] = result.operations;

  assert.ok(operation);
  assert.equal(operation.quantity, 0.002);
  assert.equal(
    getPortfolioInstrumentId("portfolio-1", {
      kind: "crypto",
      symbol: "BTC",
    }),
    getPortfolioInstrumentId("portfolio-1", {
      kind: operation.kind,
      symbol: operation.symbol,
    })
  );
});

test("imports every supported crypto symbol and its USD pair as a crypto operation", () => {
  const symbols = [
    "ETH",
    "SOL",
    "BNB",
    "XRP",
    "ADA",
    "DOGE",
    "DOT",
    "LINK",
    "LTC",
    "BCH",
    "AVAX",
    "MATIC",
  ];
  const result = parseCryptoRows(
    symbols.flatMap((symbol) => [
      `Buy;10.08.2026;${symbol};${symbol};0.002;100.50;USD;0.201`,
      `Buy;11.08.2026;${symbol}-USD;${symbol};0.00001;101.25;USD;0.0010125`,
    ])
  );

  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.operations.length, symbols.length * 2);

  for (const symbol of symbols) {
    const normalized = result.operations.filter((operation) => operation.symbol === symbol);

    assert.equal(normalized.length, 2, `${symbol} should retain its base and pair import`);
    assert.ok(normalized.every((operation) => operation.kind === "crypto"));
    assert.ok(normalized.every((operation) => operation.provider === "coingecko"));
    assert.deepEqual(
      normalized.map((operation) => operation.quantity),
      [0.002, 0.00001]
    );
  }
});

test("does not classify a regular stock ticker as crypto", () => {
  const result = parseCryptoRows([
    "Buy;10.08.2026;AAPL;Apple Inc.;2;200.00;USD;400.00",
  ]);
  const [operation] = result.operations;

  assert.ok(operation);
  assert.equal(operation.kind, "stock");
  assert.equal(operation.symbol, "AAPL");
});
