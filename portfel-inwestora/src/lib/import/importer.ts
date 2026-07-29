import { parseBrokerOperationsCsv } from "@/lib/import-operations";
import type {
  Importer,
  ImportFormat,
  ImportMapper,
  ImportParser,
  ImportPayload,
  ImportSource,
  ImportValidator,
} from "@/lib/import/types";
import type { BrokerImportParseResult, ImportedBrokerOperation } from "@/lib/import-operations";

export const SUPPORTED_IMPORT_SOURCES: Array<{
  source: ImportSource;
  label: string;
  formats: ImportFormat[];
  enabled: boolean;
}> = [
  { source: "myfund", label: "MyFund", formats: ["csv", "excel"], enabled: false },
  {
    source: "portfolio-performance",
    label: "Portfolio Performance",
    formats: ["csv", "json"],
    enabled: false,
  },
  { source: "xtb", label: "XTB", formats: ["csv"], enabled: false },
  { source: "ibkr", label: "IBKR", formats: ["csv"], enabled: false },
  { source: "trading212", label: "Trading212", formats: ["csv"], enabled: false },
  { source: "revolut", label: "Revolut", formats: ["csv"], enabled: false },
  { source: "binance", label: "Binance", formats: ["csv", "json"], enabled: false },
  { source: "bybit", label: "Bybit", formats: ["csv", "json"], enabled: false },
  { source: "kraken", label: "Kraken", formats: ["csv"], enabled: false },
  { source: "csv", label: "CSV", formats: ["csv"], enabled: true },
  { source: "excel", label: "Excel", formats: ["excel"], enabled: false },
  { source: "json", label: "JSON", formats: ["json"], enabled: false },
];

const createUnsupportedParser = (
  source: ImportSource,
  format: ImportFormat
): ImportParser<BrokerImportParseResult> => ({
  source,
  format,
  parse: () => {
    throw new Error("Parser dla tego zrodla importu zostanie dodany w kolejnym etapie.");
  },
});

const csvParser: ImportParser<BrokerImportParseResult> = {
  source: "csv",
  format: "csv",
  parse: (payload: ImportPayload) => {
    if (typeof payload.content !== "string") {
      throw new Error("Importer CSV oczekuje tekstowej zawartosci pliku.");
    }

    return parseBrokerOperationsCsv(payload.content, "generic");
  },
};

const identityMapper: ImportMapper<BrokerImportParseResult> = {
  source: "csv",
  map: (parsed) => parsed.operations,
};

export const operationImportValidator: ImportValidator = {
  validate: (operations: ImportedBrokerOperation[]) => ({
    operations: operations.filter(
      (operation) =>
        operation.date &&
        operation.symbol &&
        operation.quantity > 0 &&
        operation.price > 0 &&
        (operation.side === "buy" || operation.side === "sell")
    ),
    skippedRows: operations
      .filter(
        (operation) =>
          !operation.date ||
          !operation.symbol ||
          operation.quantity <= 0 ||
          operation.price <= 0 ||
          (operation.side !== "buy" && operation.side !== "sell")
      )
      .map((operation) => ({
        rowNumber: operation.rowNumber,
        reason: "Operacja nie przeszla walidacji importu.",
      })),
  }),
};

export const createOperationImporter = <TParsed>({
  source,
  parser,
  mapper,
  validator = operationImportValidator,
}: {
  source: ImportSource;
  parser: ImportParser<TParsed>;
  mapper: ImportMapper<TParsed>;
  validator?: ImportValidator;
}): Importer<TParsed> => ({
  source,
  parser,
  mapper,
  validator,
  import: (payload) => {
    const parsed = parser.parse(payload);
    const mappedOperations = mapper.map(parsed);
    const validation = validator.validate(mappedOperations);

    return {
      operations: validation.operations,
      skippedRows: validation.skippedRows,
    };
  },
});

const unsupportedImporters = SUPPORTED_IMPORT_SOURCES.filter((source) => !source.enabled).map(
  (sourceConfig) =>
    createOperationImporter({
      source: sourceConfig.source,
      parser: createUnsupportedParser(sourceConfig.source, sourceConfig.formats[0]),
      mapper: {
        source: sourceConfig.source,
        map: () => [],
      },
    })
);

export const operationImporters: Record<ImportSource, Importer<BrokerImportParseResult>> = {
  csv: createOperationImporter({
    source: "csv",
    parser: csvParser,
    mapper: identityMapper,
  }),
  myfund: unsupportedImporters.find((importer) => importer.source === "myfund")!,
  "portfolio-performance": unsupportedImporters.find(
    (importer) => importer.source === "portfolio-performance"
  )!,
  xtb: unsupportedImporters.find((importer) => importer.source === "xtb")!,
  ibkr: unsupportedImporters.find((importer) => importer.source === "ibkr")!,
  trading212: unsupportedImporters.find((importer) => importer.source === "trading212")!,
  revolut: unsupportedImporters.find((importer) => importer.source === "revolut")!,
  binance: unsupportedImporters.find((importer) => importer.source === "binance")!,
  bybit: unsupportedImporters.find((importer) => importer.source === "bybit")!,
  kraken: unsupportedImporters.find((importer) => importer.source === "kraken")!,
  excel: unsupportedImporters.find((importer) => importer.source === "excel")!,
  json: unsupportedImporters.find((importer) => importer.source === "json")!,
};

export const importOperations = (payload: ImportPayload) => {
  const importer = operationImporters[payload.source];

  if (!importer) {
    throw new Error("Nieznane zrodlo importu.");
  }

  return importer.import(payload);
};
