"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseBrokerOperationsCsv,
  parseBrokerOperationsPdf,
  parseBrokerOperationsXlsx,
  type BrokerImportParseResult,
  type ImportedBrokerOperation,
} from "@/lib/import-operations";
import ImportPlatformPicker, {
  DEFAULT_IMPORT_PLATFORM_ID,
  getImportPlatformById,
  type ImportPlatformDefinition,
} from "@/components/ImportPlatformPicker";

type BrokerImportPanelProps = {
  onImport: (operations: ImportedBrokerOperation[]) => Promise<{
    importedBuys: number;
    importedSells: number;
    skippedSells: number;
  }>;
};

const formatSide = (side: ImportedBrokerOperation["side"]) =>
  side === "buy" ? "Kupno" : "Sprzedaz";

const isPdfFile = (file: File) =>
  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const isXlsxFile = (file: File) =>
  file.name.toLowerCase().endsWith(".xlsx") ||
  file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

export default function BrokerImportPanel({ onImport }: BrokerImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedPlatformId, setSelectedPlatformId] = useState(
    DEFAULT_IMPORT_PLATFORM_ID
  );
  const [fileName, setFileName] = useState("");
  const [parseResult, setParseResult] = useState<BrokerImportParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [parseStatus, setParseStatus] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const previewRows = useMemo(
    () => parseResult?.operations.slice(0, 6) ?? [],
    [parseResult]
  );
  const preset = getImportPlatformById(selectedPlatformId).preset;

  const handlePlatformSelect = (platform: ImportPlatformDefinition) => {
    setSelectedPlatformId(platform.id);
    setParseResult(null);
    setSuccess(null);
    setError(null);
  };

  const handleFileChange = useCallback(async (file: File | undefined) => {
    setError(null);
    setSuccess(null);
    setParseResult(null);
    setFileName(file?.name ?? "");
    setParseStatus(null);

    if (!file) {
      return;
    }

    setIsParsing(true);
    setParseStatus(
      isXlsxFile(file)
        ? "Odczytuje arkusz XLSX..."
        : isPdfFile(file)
          ? "Odczytuje raport PDF..."
          : "Odczytuje plik CSV..."
    );
    await waitForPaint();

    try {
      let result: BrokerImportParseResult;

      if (isXlsxFile(file)) {
        setParseStatus("Rozpakowuje XLSX i mapuje pierwsza zakladke...");
        result = await parseBrokerOperationsXlsx(
          new Uint8Array(await file.arrayBuffer()),
          preset
        );
      } else if (isPdfFile(file)) {
        setParseStatus("Wyszukuje tekst i operacje w PDF...");
        result = await parseBrokerOperationsPdf(
          new Uint8Array(await file.arrayBuffer()),
          preset
        );
      } else {
        setParseStatus("Mapuje kolumny CSV...");
        result = parseBrokerOperationsCsv(await file.text(), preset);
      }

      setParseResult(result);
      setParseStatus(null);

      if (result.operations.length === 0) {
        setError("Nie znalazlem poprawnych operacji w tym pliku.");
      }
    } catch (parseError) {
      console.error("[broker-import] Nie udalo sie odczytac pliku.", {
        fileName: file.name,
        fileType: file.type,
        preset,
        error: parseError,
      });
      setError(
        parseError instanceof Error
          ? parseError.message
          : "Nie udalo sie odczytac pliku CSV/XLSX/PDF."
      );
      setParseStatus(null);
    } finally {
      setIsParsing(false);
    }
  }, [preset]);

  useEffect(() => {
    const fileInput = fileInputRef.current;

    if (!fileInput) {
      return;
    }

    const handleNativeFileChange = () => {
      void handleFileChange(fileInput.files?.[0]);
    };

    fileInput.addEventListener("change", handleNativeFileChange);

    return () => {
      fileInput.removeEventListener("change", handleNativeFileChange);
    };
  }, [handleFileChange]);

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
          Obslugiwane sa eksporty CSV, XLSX oraz tekstowe raporty PDF XTB z
          danymi transakcji.
        </p>
      </div>

      <div className="import-grid mt-6">
        <ImportPlatformPicker
          selectedPlatformId={selectedPlatformId}
          onSelect={handlePlatformSelect}
        />

        <label className="field">
          <span>Plik CSV/XLSX/PDF</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          />
        </label>

        <button
          type="button"
          className="primary-button self-end"
          disabled={!parseResult?.operations.length || isImporting || isParsing}
          onClick={() => {
            void handleImport();
          }}
        >
          {isImporting ? "Importuje..." : isParsing ? "Odczytuje..." : "Importuj"}
        </button>
      </div>

      {fileName ? <p className="field-note mt-4">Wybrany plik: {fileName}</p> : null}
      {isParsing && parseStatus ? <p className="field-note mt-4">{parseStatus}</p> : null}
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
