"use client";

import { useMemo, useState } from "react";
import {
  parseBrokerOperationsCsv,
  parseBrokerOperationsPdf,
  type BrokerImportParseResult,
  type BrokerImportPreset,
  type ImportedBrokerOperation,
} from "@/lib/import-operations";

type BrokerImportPanelProps = {
  onImport: (operations: ImportedBrokerOperation[]) => Promise<{
    importedBuys: number;
    importedSells: number;
    skippedSells: number;
  }>;
};

const BROKER_PRESETS: Array<{ value: BrokerImportPreset; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "xtb", label: "XTB" },
  { value: "degiro", label: "DEGIRO" },
  { value: "ibkr", label: "IBKR" },
  { value: "mbank", label: "mBank" },
  { value: "etoro", label: "eToro" },
  { value: "trading212", label: "Trading 212" },
  { value: "generic", label: "CSV uniwersalny" },
];

const formatSide = (side: ImportedBrokerOperation["side"]) =>
  side === "buy" ? "Kupno" : "Sprzedaz";

const isPdfFile = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

export default function BrokerImportPanel({ onImport }: BrokerImportPanelProps) {
  const [preset, setPreset] = useState<BrokerImportPreset>("auto");
  const [fileName, setFileName] = useState("");
  const [parseResult, setParseResult] = useState<BrokerImportParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const previewRows = useMemo(
    () => parseResult?.operations.slice(0, 6) ?? [],
    [parseResult]
  );

  const handleFileChange = async (file: File | undefined) => {
    setError(null);
    setSuccess(null);
    setParseResult(null);
    setFileName(file?.name ?? "");

    if (!file) {
      return;
    }

    try {
      const result = isPdfFile(file)
        ? parseBrokerOperationsPdf(new Uint8Array(await file.arrayBuffer()), preset)
        : parseBrokerOperationsCsv(await file.text(), preset);

      setParseResult(result);

      if (result.operations.length === 0) {
        setError("Nie znalazlem poprawnych operacji w tym pliku.");
      }
    } catch {
      setError("Nie udalo sie odczytac pliku CSV/PDF.");
    }
  };

  const handleImport = async () => {
    if (!parseResult || parseResult.operations.length === 0) {
      setError("Najpierw wybierz plik z operacjami.");
      return;
    }

    setIsImporting(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await onImport(parseResult.operations);
      const importedTotal = result.importedBuys + result.importedSells;

      setSuccess(
        `Zaimportowano ${importedTotal} operacji: ${result.importedBuys} kupna i ${result.importedSells} sprzedazy. Pominiete sprzedaze bez pozycji: ${result.skippedSells}.`
      );
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Nie udalo sie zaimportowac operacji."
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Import operacji</p>
          <h2 className="section-title">Wczytaj historie z platformy inwestycyjnej</h2>
        </div>

        <p className="section-copy">
          Obslugiwane sa eksporty CSV oraz tekstowe raporty PDF XTB z danymi
          transakcji.
        </p>
      </div>

      <div className="import-grid mt-6">
        <label className="field">
          <span>Platforma</span>
          <select
            value={preset}
            onChange={(event) => {
              setPreset(event.target.value as BrokerImportPreset);
              setParseResult(null);
              setSuccess(null);
              setError(null);
            }}
          >
            {BROKER_PRESETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Plik CSV/PDF</span>
          <input
            type="file"
            accept=".csv,.pdf,text/csv,application/pdf"
            onChange={(event) => {
              void handleFileChange(event.target.files?.[0]);
            }}
          />
        </label>

        <button
          type="button"
          className="primary-button self-end"
          disabled={!parseResult?.operations.length || isImporting}
          onClick={() => {
            void handleImport();
          }}
        >
          {isImporting ? "Importuje..." : "Importuj"}
        </button>
      </div>

      {fileName ? <p className="field-note mt-4">Wybrany plik: {fileName}</p> : null}
      {error ? <p className="field-note field-note-error mt-4">{error}</p> : null}
      {success ? <p className="field-note mt-4">{success}</p> : null}

      {parseResult?.warnings?.length ? (
        <div className="import-warning-list mt-4">
          {parseResult.warnings.map((warning) => (
            <p key={warning} className="field-note">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      {parseResult ? (
        <div className="import-summary mt-5">
          <span>Rozpoznane operacje: {parseResult.operations.length}</span>
          <span>Pominiete wiersze: {parseResult.skippedRows.length}</span>
        </div>
      ) : null}

      {previewRows.length > 0 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="portfolio-table import-preview-table min-w-full">
            <thead>
              <tr>
                <th>Typ</th>
                <th>Data</th>
                <th>Ticker</th>
                <th>Ilosc</th>
                <th>Cena</th>
                <th>Wartosc</th>
                <th>Waluta</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((operation) => (
                <tr key={`${operation.rowNumber}-${operation.symbol}`}>
                  <td>{formatSide(operation.side)}</td>
                  <td>{operation.date}</td>
                  <td>{operation.symbol}</td>
                  <td>{operation.quantity}</td>
                  <td>{operation.price}</td>
                  <td>{operation.transactionValue ?? "-"}</td>
                  <td>{operation.currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {parseResult?.skippedRows.length ? (
        <p className="field-note mt-4">
          Pierwszy pominiety wiersz: {parseResult.skippedRows[0].rowNumber} -
          {" "}
          {parseResult.skippedRows[0].reason}
        </p>
      ) : null}
    </section>
  );
}
