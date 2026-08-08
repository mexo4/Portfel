import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { parseBrokerOperationsXlsx } from "../src/lib/import-operations";

const files = process.argv.slice(2);

const getCountsByKey = (values: string[]) =>
  Object.fromEntries(
    Array.from(
      values.reduce((counts, value) => {
        counts.set(value, (counts.get(value) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())
    ).sort(([left], [right]) => left.localeCompare(right))
  );

const main = async () => {
  for (const filePath of files) {
    const result = await parseBrokerOperationsXlsx(
      new Uint8Array(await readFile(filePath))
    );
    const trades = result.operations.filter(
      (operation) => operation.operationType === "BUY" || operation.operationType === "SELL"
    );
    const dividends = result.operations.filter(
      (operation) => operation.operationType === "DIVIDEND"
    );
    const convertedTrades = trades.filter(
      (operation) =>
        operation.marketCurrency &&
        operation.cashCurrency &&
        operation.marketCurrency !== operation.cashCurrency
    );
    const invalidTrades = trades.filter(
      (operation) => !operation.symbol || operation.quantity <= 0 || operation.price <= 0
    );

    console.log(
      JSON.stringify(
        {
          file: basename(filePath),
          operations: result.operations.length,
          skippedRows: result.skippedRows.length,
          operationsByType: getCountsByKey(
            result.operations.map((operation) => operation.operationType ?? "UNKNOWN")
          ),
          tradesByCurrency: getCountsByKey(
            trades.map(
              (operation) => `${operation.marketCurrency ?? "?"}->${operation.cashCurrency ?? "?"}`
            )
          ),
          invalidTrades: invalidTrades.length,
          dividendTotals: dividends.reduce(
            (totals, operation) => ({
              gross: totals.gross + (operation.grossAmount ?? 0),
              net: totals.net + (operation.netAmount ?? 0),
              tax: totals.tax + (operation.tax ?? 0),
            }),
            { gross: 0, net: 0, tax: 0 }
          ),
          customCashSamples: result.operations
            .filter((operation) => operation.operationType === "CUSTOM")
            .slice(0, 8)
            .map((operation) => ({
              symbol: operation.symbol,
              amount: operation.amount,
              currency: operation.currency,
              rawType: operation.rawType,
              rawTime: operation.rawTime,
              notes: operation.warnings,
            })),
          closeTradeContexts: result.operations
            .filter((operation) => operation.rawType?.toLowerCase() === "close trade")
            .map((closeTrade) => ({
              closeTrade: {
                symbol: closeTrade.rawSymbol,
                amount: closeTrade.amount,
                rawTime: closeTrade.rawTime,
              },
              sameSymbol: result.operations
                .filter((operation) => operation.rawSymbol === closeTrade.rawSymbol)
                .map((operation) => ({
                  type: operation.operationType,
                  amount: operation.amount,
                  rawType: operation.rawType,
                  rawTime: operation.rawTime,
                })),
            })),
          convertedTradeSamples: convertedTrades.slice(0, 8).map((operation) => ({
            type: operation.operationType,
            symbol: operation.symbol,
            marketCurrency: operation.marketCurrency,
            cashCurrency: operation.cashCurrency,
            quantity: operation.quantity,
            price: operation.price,
            marketAmount: operation.marketAmount,
            cashAmount: operation.cashAmount,
            exchangeRate: operation.exchangeRate,
            autoFxConversion: operation.autoFxConversion,
          })),
        },
        null,
        2
      )
    );
  }
};

void main();
