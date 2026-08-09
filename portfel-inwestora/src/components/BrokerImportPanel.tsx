"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseBrokerOperationsCsv,
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
  onImport: (
    operations: ImportedBrokerOperation[],
    onQuoteProgress: (progress: { completed: number; total: number }) => void
  ) => Promise<{
    importedBuys: number;
    importedSells: number;
    importedDividends?: number;
    importedCashOperations?: number;
    skippedSells: number;
    skippedInvalid?: number;
    skippedDuplicates?: number;
    skippedPlanLimit?: number;
    quoteTotal?: number;
    missingQuotes?: number;
  }>;
};

const formatOperationType = (operation: ImportedBrokerOperation) => {
  if (operation.side === "buy") return "Kupno";
  if (operation.side === "sell") return "Sprzedaz";

  const labels: Record<string, string> = {
    DEPOSIT: "Wplata",
    WITHDRAW: "Wyplata",
    TRANSFER: "Transfer",
    CONVERSION: "Przewalutowanie",
    DIVIDEND: "Dywidenda",
    INTEREST: "Odsetki",
    FEE: "Oplata",
    TAX: "Podatek",
  };

  return labels[operation.operationType ?? ""] ?? operation.operationType ?? "Operacja";
};

const isXlsxFile = (file: File) =>
  file.name.toLowerCase().endsWith(".xlsx") ||
  file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const isCsvFile = (file: File) =>
  file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";

const waitForPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

export default function BrokerImportPanel({ onImport }: BrokerImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isImportingRef = useRef(false);
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
  const [quoteProgress, setQuoteProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const previewRows = useMemo(
    () => parseResult?.operations.slice(0, 6) ?? [],
    [parseResult]
  );
  const selectedPlatform = getImportPlatformById(selectedPlatformId);
  const preset = selectedPlatform.preset;
  const isXtbImport = selectedPlatform.id === "xtb";
  const isBossaImport = selectedPlatform.id === "bm-bos";
  const acceptedFileTypes = isXtbImport
    ? ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : ".csv,text/csv";
  const fileLabel = isXtbImport ? "Plik XTB (XLSX)" : "Plik CSV";
  const importDescription = isXtbImport
    ? "Dla XTB obslugiwany jest aktualny eksport XLSX. Starsze raporty PDF, HTML i CSV nie sa juz pokazywane w wyborze XTB."
    : "Dla pozostalych platform uzyj uniwersalnego importera CSV. Dedykowane parsery pozostaja rozdzielone modulowo.";

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

    const isAcceptedFile = isXtbImport ? isXlsxFile(file) : isCsvFile(file);

    if (!isAcceptedFile) {
      setError(
        isXtbImport
          ? "Import XTB obsluguje teraz wylacznie pliki XLSX."
          : "Ten importer obsluguje wylacznie pliki CSV."
      );
      return;
    }

    setIsParsing(true);
    setParseStatus(isXtbImport ? "Odczytuje arkusz XLSX..." : "Odczytuje plik CSV...");
    await waitForPaint();

    try {
      let result: BrokerImportParseResult;

      if (isXtbImport) {
        setParseStatus("Rozpakowuje XLSX i mapuje pierwsza zakladke...");
        result = await parseBrokerOperationsXlsx(
          new Uint8Array(await file.arrayBuffer()),
          preset
        );
      } else {
        setParseStatus("Mapuje kolumny CSV...");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const text = isBossaImport
          ? new TextDecoder("windows-1250").decode(bytes)
          : new TextDecoder("utf-8").decode(bytes);
        result = parseBrokerOperationsCsv(text, preset);
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
          : "Nie udalo sie odczytac pliku importu."
      );
      setParseStatus(null);
    } finally {
      setIsParsing(false);
    }
  }, [isBossaImport, isXtbImport, preset]);

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
    if (isImportingRef.current) {
      return;
    }

    if (!parseResult || parseResult.operations.length === 0) {
      setError("Najpierw wybierz plik z operacjami.");
      return;
    }

    isImportingRef.current = true;
    setIsImporting(true);
    setQuoteProgress(null);
    setError(null);
    setSuccess(null);

    try {
      const result = await onImport(parseResult.operations, setQuoteProgress);
      const importedDividends = result.importedDividends ?? 0;
      const importedCashOperations = result.importedCashOperations ?? 0;
      const skippedDuplicates = result.skippedDuplicates ?? 0;
      const skippedInvalid = result.skippedInvalid ?? 0;
      const skippedPlanLimit = result.skippedPlanLimit ?? 0;
      const importedTotal =
        result.importedBuys +
        result.importedSells +
        importedDividends +
        importedCashOperations;
      const allRecordsAreDuplicates =
        parseResult.operations.length > 0 &&
        skippedDuplicates === parseResult.operations.length;

      const resultDetails = [
        `Pominiete sprzedaze bez pozycji: ${result.skippedSells}.`,
        `Nieprawidlowe rekordy: ${skippedInvalid}.`,
        `Duplikaty: ${skippedDuplicates}.`,
        skippedPlanLimit > 0 ? `Pozycje ponad limitem planu: ${skippedPlanLimit}.` : "",
        result.missingQuotes
          ? `Nie udalo sie pobrac kursu dla ${result.missingQuotes} ${result.missingQuotes === 1 ? "instrumentu" : "instrumentow"}.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

      setSuccess(
        importedTotal > 0
          ? `Zaimportowano ${importedTotal} operacji: ${result.importedBuys} kupna, ${result.importedSells} sprzedazy i ${importedDividends} dywidend. ${resultDetails}`
          : allRecordsAreDuplicates
            ? `Ten raport zostal juz zaimportowany do aktywnego portfela. ${resultDetails}`
            : `Nie dodano nowych operacji, bo wszystkie rekordy zostaly odrzucone. ${resultDetails}`
      );
      setParseResult(null);
      setFileName("");
      setParseStatus(null);
      setError(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Nie udalo sie zaimportowac operacji."
      );
    } finally {
      isImportingRef.current = false;
      setIsImporting(false);
      setQuoteProgress(null);
    }
  };

  const importButtonLabel =
    isImporting && quoteProgress && quoteProgress.total > 0
      ? `Pobieranie kursow ${quoteProgress.completed}/${quoteProgress.total}...`
      : isImporting
        ? "Importowanie..."
        : isParsing
          ? "Odczytuje..."
          : "Importuj";

  return (
    <section className="panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Import operacji</p>
          <h2 className="section-title">Wczytaj historie z platformy inwestycyjnej</h2>
        </div>

        <p className="section-copy">
          {importDescription}
        </p>
      </div>

      <div className="import-grid mt-6">
        <ImportPlatformPicker
          selectedPlatformId={selectedPlatformId}
          onSelect={handlePlatformSelect}
        />

        <label className="field">
          <span>{fileLabel}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptedFileTypes}
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
          {importButtonLabel}
        </button>
      </div>

      {fileName ? <p className="field-note mt-4">Wybrany plik: {fileName}</p> : null}
      {isParsing && parseStatus ? <p className="field-note mt-4">{parseStatus}</p> : null}
      {isImporting && quoteProgress && quoteProgress.total > 0 ? (
        <p className="field-note mt-4" aria-live="polite">
          Pobieranie kursow {quoteProgress.completed}/{quoteProgress.total}...
        </p>
      ) : null}
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
                  <td>{formatOperationType(operation)}</td>
                  <td>{operation.date}</td>
                  <td>{operation.symbol || "-"}</td>
                  <td>{operation.quantity || "-"}</td>
                  <td>{operation.price || "-"}</td>
                  <td>{operation.transactionValue ?? operation.amount ?? "-"}</td>
                  <td>{operation.accountCurrency ?? operation.currency}</td>
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
