import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  parseBrokerOperationsXlsx,
  type ImportedBrokerOperation,
} from "../src/lib/import-operations";

const getReportAccountNumber = (filePath: string) =>
  basename(filePath).match(/_(\d{6,})_/)?.[1] ?? "";

const getOrdinaryCashEffect = (operation: ImportedBrokerOperation) => {
  const amount = Math.abs(operation.amount ?? 0);
  const fee = Math.abs(operation.fee ?? 0);
  const tax = Math.abs(operation.tax ?? 0);

  switch (operation.operationType) {
    case "BUY":
    case "WITHDRAW":
      return -(Math.abs(operation.cashAmount ?? amount) + fee + tax);
    case "SELL":
    case "DEPOSIT":
    case "COUPON":
    case "INTEREST":
    case "BONUS":
      return Math.abs(operation.cashAmount ?? amount) - fee - tax;
    case "DIVIDEND":
      return operation.netAmount ?? amount - fee - tax;
    case "FEE":
      return -Math.max(amount, fee);
    case "TAX":
      return -Math.max(amount, tax);
    case "CUSTOM":
      return (operation.amount ?? 0) - fee - tax;
    case "TRANSFER":
      return -amount;
    default:
      return 0;
  }
};

const getReportCashEffect = (
  operation: ImportedBrokerOperation,
  reportAccountNumber: string
) => {
  if (operation.operationType !== "CONVERSION" && operation.operationType !== "TRANSFER") {
    return operation.accountNumber === reportAccountNumber
      ? getOrdinaryCashEffect(operation)
      : 0;
  }

  const sourceAccountNumber = operation.sourceAccountNumber ?? operation.accountNumber;

  if (sourceAccountNumber === reportAccountNumber) {
    return -Math.abs(operation.amount ?? 0);
  }

  if (operation.targetAccountNumber === reportAccountNumber) {
    return Math.abs(operation.targetAmount ?? 0);
  }

  return 0;
};

const main = async () => {
  for (const filePath of process.argv.slice(2)) {
    const reportAccountNumber = getReportAccountNumber(filePath);
    const result = await parseBrokerOperationsXlsx(
      new Uint8Array(await readFile(filePath))
    );
    const byType = new Map<string, { count: number; cashEffect: number }>();
    let reportCash = 0;

    result.operations.forEach((operation) => {
      const type = operation.operationType ?? "UNKNOWN";
      const current = byType.get(type) ?? { count: 0, cashEffect: 0 };
      const cashEffect = getReportCashEffect(operation, reportAccountNumber);

      current.count += 1;
      current.cashEffect += cashEffect;
      reportCash += cashEffect;
      byType.set(type, current);
    });

    console.log(
      JSON.stringify(
        {
          file: basename(filePath),
          reportAccountNumber,
          operations: result.operations.length,
          skippedRows: result.skippedRows,
          calculatedReportCash: Number(reportCash.toFixed(6)),
          byType: Object.fromEntries(
            Array.from(byType.entries()).map(([type, value]) => [
              type,
              {
                count: value.count,
                cashEffect: Number(value.cashEffect.toFixed(6)),
              },
            ])
          ),
        },
        null,
        2
      )
    );
  }
};

void main();
