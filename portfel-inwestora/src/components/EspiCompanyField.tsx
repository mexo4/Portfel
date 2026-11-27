"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { fetchEspiIssuers } from "@/lib/api";
import type { EspiIssuerSuggestion, EspiMarket } from "@/lib/espi";

/** The wait after the last keystroke before companies are asked for. */
const SEARCH_DELAY_MS = 200;
const MIN_LETTERS = 2;

/**
 * One field for a company: typing a name or a ticker offers matching companies. A chosen company is
 * searched by its ticker; text left as typed is searched as a part of the name or a whole ticker.
 */
export default function EspiCompanyField({ value, market, onType, onChoose }: {
  value: string;
  market: Exclude<EspiMarket, "UNKNOWN">;
  onType: (text: string) => void;
  onChoose: (issuer: EspiIssuerSuggestion) => void;
}) {
  const listId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [found, setFound] = useState<{ key: string; items: EspiIssuerSuggestion[] } | null>(null);
  const text = value.trim();
  const key = `${market}|${text}`;
  // An answer is shown only for the text it was asked for.
  const items = isOpen && found?.key === key ? found.items : [];
  const isListShown = items.length > 0;

  useEffect(() => {
    if (!isOpen || text.length < MIN_LETTERS) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchEspiIssuers(text, market, controller.signal)
        .then((result) => { setFound({ key, items: result }); setActive(-1); })
        // The field still works as plain text without suggestions.
        .catch(() => undefined);
    }, SEARCH_DELAY_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [isOpen, key, market, text]);

  const choose = (issuer: EspiIssuerSuggestion) => {
    setIsOpen(false);
    onChoose(issuer);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isListShown) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current < 0 && step < 0 ? items.length - 1 : (current + step + items.length) % items.length));
    } else if (event.key === "Enter" && items[active]) {
      event.preventDefault();
      choose(items[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div className="espi-company-field">
      <label>
        <span>Spółka</span>
        <input
          value={value}
          placeholder="np. Dino lub DNP"
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isListShown}
          aria-controls={listId}
          aria-activedescendant={isListShown && items[active] ? `${listId}-${active}` : undefined}
          onChange={(event) => { setIsOpen(true); onType(event.target.value); }}
          onKeyDown={handleKeyDown}
          onBlur={() => setIsOpen(false)}
        />
      </label>
      <ul id={listId} role="listbox" aria-label="Pasujące spółki" className="espi-company-options" hidden={!isListShown}>
        {items.map((issuer, index) => (
          <li
            key={issuer.ticker}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            // Keeps the focus in the field, so the list is still there when the click lands.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(issuer)}
          >
            <span>{issuer.name}</span>
            <strong>{issuer.ticker}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
