"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BrokerImportPreset } from "@/lib/import-operations";

export type ImportPlatformStatus = "full" | "partial" | "planned";

export type ImportPlatformDefinition = {
  id: string;
  name: string;
  preset: BrokerImportPreset;
  formats: string[];
  status: ImportPlatformStatus;
  logoText: string;
  description: string;
  searchTerms: string[];
};

type ImportPlatformSection = {
  id: string;
  label: string;
  marker: string;
  platformIds: string[];
};

type ImportPlatformPickerProps = {
  selectedPlatformId: string;
  onSelect: (platform: ImportPlatformDefinition) => void;
};

const RECENT_IMPORT_PLATFORMS_STORAGE_KEY = "mexo.recentImportPlatforms";
const RECENT_IMPORT_PLATFORMS_LIMIT = 5;
export const DEFAULT_IMPORT_PLATFORM_ID = "xtb";

const platform = (
  definition: Omit<ImportPlatformDefinition, "searchTerms"> & {
    searchTerms?: string[];
  }
): ImportPlatformDefinition => ({
  ...definition,
  searchTerms: [
    definition.name,
    definition.logoText,
    definition.preset,
    definition.formats.join(" "),
    ...(definition.searchTerms ?? []),
  ].map((term) => term.toLowerCase()),
});

const IMPORT_PLATFORMS: ImportPlatformDefinition[] = [
  platform({
    id: "xtb",
    name: "XTB (XLSX)",
    preset: "xtb",
    formats: ["XLSX"],
    status: "full",
    logoText: "XTB",
    description: "Aktualny raport XTB w formacie XLSX.",
    searchTerms: ["xstation", "excel", "arkusz"],
  }),
  platform({
    id: "trading212",
    name: "Trading 212",
    preset: "trading212",
    formats: ["CSV"],
    status: "partial",
    logoText: "T212",
    description: "Import przez istniejacy mapper CSV.",
    searchTerms: ["trading212", "t212"],
  }),
  platform({
    id: "ibkr",
    name: "Interactive Brokers",
    preset: "ibkr",
    formats: ["CSV"],
    status: "partial",
    logoText: "IBKR",
    description: "Import przez istniejacy mapper CSV.",
    searchTerms: ["ibkr"],
  }),
  platform({
    id: "degiro",
    name: "DEGIRO",
    preset: "degiro",
    formats: ["CSV"],
    status: "partial",
    logoText: "DEG",
    description: "Import przez istniejacy mapper CSV.",
  }),
  platform({
    id: "mbank",
    name: "BM mBank",
    preset: "mbank",
    formats: ["CSV"],
    status: "partial",
    logoText: "mB",
    description: "Import przez istniejacy mapper CSV.",
    searchTerms: ["mbank", "m bank"],
  }),
  platform({
    id: "etoro",
    name: "eToro",
    preset: "etoro",
    formats: ["CSV"],
    status: "partial",
    logoText: "eT",
    description: "Import przez istniejacy mapper CSV.",
  }),
  platform({
    id: "binance",
    name: "Binance",
    preset: "generic",
    formats: ["CSV"],
    status: "partial",
    logoText: "BN",
    description: "Import przez uniwersalny mapper pliku.",
  }),
  platform({
    id: "revolut",
    name: "Revolut",
    preset: "generic",
    formats: ["CSV"],
    status: "partial",
    logoText: "RV",
    description: "Import przez uniwersalny mapper pliku.",
  }),
  platform({
    id: "trade-republic",
    name: "Trade Republic",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "TR",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "bm-bos",
    name: "BM BOS (Bossa)",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "BOS",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
    searchTerms: ["bos", "bossa"],
  }),
  platform({
    id: "bm-pko",
    name: "BM PKO BP",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "PKO",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "bm-pekao",
    name: "BM Pekao",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "PEO",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "bm-santander",
    name: "BM Santander",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "SAN",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "bm-ing",
    name: "BM ING",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "ING",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "bm-alior",
    name: "BM Alior",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "ALR",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "bm-bnp",
    name: "BM BNP Paribas",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "BNP",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "bm-millennium",
    name: "BM Millennium",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "MIL",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "noble-securities",
    name: "Noble Securities",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "NS",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "oanda-tms",
    name: "OANDA TMS Brokers",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "TMS",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
    searchTerms: ["tms"],
  }),
  platform({
    id: "finax",
    name: "Finax",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "FX",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "saxo",
    name: "Saxo Bank",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "SAX",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "freedom24",
    name: "Freedom24",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "F24",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "robinhood",
    name: "Robinhood",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "RH",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "charles-schwab",
    name: "Charles Schwab",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "CS",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "fidelity",
    name: "Fidelity",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "FID",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "vanguard",
    name: "Vanguard",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "VG",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "webull",
    name: "Webull",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "WB",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "moomoo",
    name: "Moomoo",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "MM",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "firstrade",
    name: "Firstrade",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "FT",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "lightyear",
    name: "Lightyear",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "LY",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "coinbase",
    name: "Coinbase",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "CB",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "kraken",
    name: "Kraken",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "KR",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "bybit",
    name: "Bybit",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "BB",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "okx",
    name: "OKX",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "OKX",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "bitget",
    name: "Bitget",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "BG",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "kucoin",
    name: "KuCoin",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "KC",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "crypto-com",
    name: "Crypto.com",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "CDC",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
    searchTerms: ["crypto com"],
  }),
  platform({
    id: "gemini",
    name: "Gemini",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "GM",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "bitstamp",
    name: "Bitstamp",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "BS",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "htx",
    name: "HTX",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "HTX",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "gate-io",
    name: "Gate.io",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "GIO",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
    searchTerms: ["gateio"],
  }),
  platform({
    id: "mexc",
    name: "MEXC",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "MX",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "oanda",
    name: "OANDA",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "OA",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "ic-markets",
    name: "IC Markets",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "IC",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "pepperstone",
    name: "Pepperstone",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "PP",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "eightcap",
    name: "Eightcap",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "E8",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "admirals",
    name: "Admirals",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "ADM",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "fxcm",
    name: "FXCM",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "FX",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "avatrade",
    name: "AvaTrade",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "AVA",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "cmc-markets",
    name: "CMC Markets",
    preset: "generic",
    formats: ["CSV"],
    status: "planned",
    logoText: "CMC",
    description: "Dedykowany mapper zostanie dopiety pozniej.",
  }),
  platform({
    id: "custom-csv",
    name: "Uniwersalny CSV",
    preset: "generic",
    formats: ["CSV"],
    status: "full",
    logoText: "CSV",
    description: "Uniwersalny import CSV dla innych brokerow.",
    searchTerms: ["plik csv", "wlasny plik"],
  }),
  ...["OFX", "QIF", "MT940", "XML", "JSON"].map((format) =>
    platform({
      id: `custom-${format.toLowerCase()}`,
      name: format,
      preset: "generic",
      formats: [format],
      status: "planned",
      logoText: format,
      description: "Format przygotowany w wyborze platformy.",
      searchTerms: ["wlasny plik", format.toLowerCase()],
    })
  ),
];

const IMPORT_PLATFORM_BY_ID = new Map(
  IMPORT_PLATFORMS.map((item) => [item.id, item] as const)
);

const IMPORT_PLATFORM_SECTIONS: ImportPlatformSection[] = [
  {
    id: "popular",
    label: "Popularne",
    marker: "*",
    platformIds: [
      "xtb",
      "trading212",
      "ibkr",
      "binance",
      "revolut",
      "trade-republic",
      "etoro",
      "degiro",
    ],
  },
  {
    id: "poland",
    label: "Polska",
    marker: "PL",
    platformIds: [
      "xtb",
      "bm-bos",
      "mbank",
      "bm-pko",
      "bm-pekao",
      "bm-santander",
      "bm-ing",
      "bm-alior",
      "bm-bnp",
      "bm-millennium",
      "noble-securities",
      "oanda-tms",
      "finax",
    ],
  },
  {
    id: "foreign",
    label: "Zagraniczne",
    marker: "GL",
    platformIds: [
      "ibkr",
      "trading212",
      "etoro",
      "degiro",
      "saxo",
      "freedom24",
      "trade-republic",
      "robinhood",
      "charles-schwab",
      "fidelity",
      "vanguard",
      "webull",
      "moomoo",
      "firstrade",
      "lightyear",
    ],
  },
  {
    id: "crypto",
    label: "Kryptowaluty",
    marker: "BTC",
    platformIds: [
      "binance",
      "coinbase",
      "kraken",
      "bybit",
      "okx",
      "bitget",
      "kucoin",
      "crypto-com",
      "gemini",
      "bitstamp",
      "htx",
      "gate-io",
      "mexc",
    ],
  },
  {
    id: "forex",
    label: "Forex / CFD",
    marker: "FX",
    platformIds: [
      "xtb",
      "oanda",
      "ic-markets",
      "pepperstone",
      "eightcap",
      "admirals",
      "fxcm",
      "avatrade",
      "cmc-markets",
    ],
  },
  {
    id: "custom",
    label: "Import wlasnego pliku",
    marker: "FILE",
    platformIds: [
      "custom-csv",
      "custom-ofx",
      "custom-qif",
      "custom-mt940",
      "custom-xml",
      "custom-json",
    ],
  },
];

const STATUS_LABELS: Record<ImportPlatformStatus, string> = {
  full: "Pelna obsluga",
  partial: "Czesciowa obsluga",
  planned: "W przygotowaniu",
};

const STATUS_MARKS: Record<ImportPlatformStatus, string> = {
  full: "OK",
  partial: "Beta",
  planned: "Soon",
};

const normalizeQuery = (value: string) => value.trim().toLowerCase();

export const getImportPlatformById = (platformId: string) =>
  IMPORT_PLATFORM_BY_ID.get(platformId) ??
  IMPORT_PLATFORM_BY_ID.get(DEFAULT_IMPORT_PLATFORM_ID)!;

const getPlatformsByIds = (platformIds: string[]) =>
  platformIds
    .map((platformId) => IMPORT_PLATFORM_BY_ID.get(platformId))
    .filter((item): item is ImportPlatformDefinition => Boolean(item));

const readRecentPlatformIds = () => {
  try {
    const storedValue = window.localStorage.getItem(RECENT_IMPORT_PLATFORMS_STORAGE_KEY);
    const parsedValue = storedValue ? JSON.parse(storedValue) : [];

    return Array.isArray(parsedValue)
      ? parsedValue.filter(
          (item): item is string =>
            typeof item === "string" && IMPORT_PLATFORM_BY_ID.has(item)
        )
      : [];
  } catch {
    return [];
  }
};

const writeRecentPlatformIds = (platformIds: string[]) => {
  try {
    window.localStorage.setItem(
      RECENT_IMPORT_PLATFORMS_STORAGE_KEY,
      JSON.stringify(platformIds)
    );
  } catch {
    // localStorage may be unavailable in private or restricted browser contexts.
  }
};

const matchesQuery = (item: ImportPlatformDefinition, normalizedQuery: string) => {
  if (!normalizedQuery) {
    return true;
  }

  return item.searchTerms.some((term) => term.includes(normalizedQuery));
};

function PlatformCard({
  platform,
  isSelected,
  onSelect,
}: {
  platform: ImportPlatformDefinition;
  isSelected: boolean;
  onSelect: (platform: ImportPlatformDefinition) => void;
}) {
  return (
    <button
      type="button"
      className={
        isSelected ? "import-platform-card is-selected" : "import-platform-card"
      }
      onClick={() => onSelect(platform)}
    >
      <span className="import-platform-logo" aria-hidden="true">
        {platform.logoText}
      </span>
      <span className="import-platform-card-body">
        <strong>{platform.name}</strong>
        <span>{platform.description}</span>
        <span className="import-format-list">
          {platform.formats.map((format) => (
            <span key={`${platform.id}-${format}`}>{format}</span>
          ))}
        </span>
      </span>
      <span className={`import-status-badge is-${platform.status}`}>
        <span aria-hidden="true">{STATUS_MARKS[platform.status]}</span>
        {STATUS_LABELS[platform.status]}
      </span>
    </button>
  );
}

export default function ImportPlatformPicker({
  selectedPlatformId,
  onSelect,
}: ImportPlatformPickerProps) {
  const selectedPlatform = getImportPlatformById(selectedPlatformId);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recentPlatformIds, setRecentPlatformIds] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedQuery = normalizeQuery(query);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const recentPlatforms = useMemo(
    () =>
      getPlatformsByIds(recentPlatformIds)
        .filter((item) => matchesQuery(item, normalizedQuery))
        .slice(0, RECENT_IMPORT_PLATFORMS_LIMIT),
    [normalizedQuery, recentPlatformIds]
  );

  const filteredSections = useMemo(
    () =>
      IMPORT_PLATFORM_SECTIONS.map((section) => ({
        ...section,
        platforms: getPlatformsByIds(section.platformIds).filter((item) =>
          matchesQuery(item, normalizedQuery)
        ),
      })).filter((section) => section.platforms.length > 0),
    [normalizedQuery]
  );

  const handleSelect = (platformDefinition: ImportPlatformDefinition) => {
    const nextRecentPlatformIds = [
      platformDefinition.id,
      ...recentPlatformIds.filter((platformId) => platformId !== platformDefinition.id),
    ].slice(0, RECENT_IMPORT_PLATFORMS_LIMIT);

    setRecentPlatformIds(nextRecentPlatformIds);
    writeRecentPlatformIds(nextRecentPlatformIds);
    onSelect(platformDefinition);
    setIsOpen(false);
    setQuery("");
  };

  const handleOpen = () => {
    setRecentPlatformIds(readRecentPlatformIds());
    setIsOpen(true);
  };

  return (
    <div className="import-platform-picker">
      <button
        type="button"
        className="import-platform-trigger"
        onClick={handleOpen}
      >
        <span className="import-platform-logo" aria-hidden="true">
          {selectedPlatform.logoText}
        </span>
        <span className="import-platform-trigger-copy">
          <span>Wczytaj historie z platformy inwestycyjnej</span>
          <strong>{selectedPlatform.name}</strong>
          <small>{selectedPlatform.formats.join(" / ")}</small>
        </span>
        <span className="import-platform-trigger-action">Zmien</span>
      </button>

      {isOpen ? (
        <div
          className="import-platform-modal-backdrop"
          role="presentation"
          onClick={() => setIsOpen(false)}
        >
          <section
            aria-label="Wybierz platforme importu"
            aria-modal="true"
            className="import-platform-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="import-platform-modal-head">
              <div>
                <p className="eyebrow">Import</p>
                <h3 className="section-title">Wybierz platforme</h3>
              </div>
              <button
                type="button"
                className="ghost-button import-platform-close"
                onClick={() => setIsOpen(false)}
              >
                Zamknij
              </button>
            </div>

            <label className="import-platform-search" htmlFor="import-platform-search">
              <span aria-hidden="true">SZ</span>
              <input
                id="import-platform-search"
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Wyszukaj platforme..."
              />
            </label>

            <div className="import-platform-sections">
              {recentPlatforms.length > 0 ? (
                <div className="import-platform-section">
                  <div className="import-platform-section-head">
                    <span>REC</span>
                    <strong>Ostatnio uzywane</strong>
                  </div>
                  <div className="import-platform-card-grid">
                    {recentPlatforms.map((item) => (
                      <PlatformCard
                        key={`recent-${item.id}`}
                        platform={item}
                        isSelected={item.id === selectedPlatform.id}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {filteredSections.map((section) => (
                <div key={section.id} className="import-platform-section">
                  <div className="import-platform-section-head">
                    <span>{section.marker}</span>
                    <strong>{section.label}</strong>
                  </div>
                  <div className="import-platform-card-grid">
                    {section.platforms.map((item) => (
                      <PlatformCard
                        key={`${section.id}-${item.id}`}
                        platform={item}
                        isSelected={item.id === selectedPlatform.id}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {filteredSections.length === 0 && recentPlatforms.length === 0 ? (
                <div className="line-chart-empty">
                  <p className="table-title">Brak platform</p>
                  <p className="table-note mt-2">
                    Sprobuj wpisac nazwe brokera, gieldy albo format pliku.
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
