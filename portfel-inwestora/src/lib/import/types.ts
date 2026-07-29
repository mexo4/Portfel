import type { BrokerImportParseResult, ImportedBrokerOperation } from "@/lib/import-operations";

export type ImportSource =
  | "myfund"
  | "portfolio-performance"
  | "xtb"
  | "ibkr"
  | "trading212"
  | "revolut"
  | "binance"
  | "bybit"
  | "kraken"
  | "csv"
  | "excel"
  | "json";

export type ImportFormat = "csv" | "excel" | "json";

export type ImportPayload = {
  source: ImportSource;
  format: ImportFormat;
  fileName?: string;
  content: string | ArrayBuffer;
};

export type ImportParser<TParsed = unknown> = {
  source: ImportSource;
  format: ImportFormat;
  parse: (payload: ImportPayload) => TParsed;
};

export type ImportMapper<TParsed = unknown> = {
  source: ImportSource;
  map: (parsed: TParsed) => ImportedBrokerOperation[];
};

export type ImportValidator = {
  validate: (operations: ImportedBrokerOperation[]) => BrokerImportParseResult;
};

export type Importer<TParsed = unknown> = {
  source: ImportSource;
  parser: ImportParser<TParsed>;
  mapper: ImportMapper<TParsed>;
  validator: ImportValidator;
  import: (payload: ImportPayload) => BrokerImportParseResult;
};
