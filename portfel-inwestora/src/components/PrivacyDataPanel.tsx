"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { acquireBodyScrollLock } from "@/lib/client/body-scroll-lock";
import type { AuthenticatedUser } from "@/types/portfolio";
import styles from "./PrivacyDataPanel.module.css";

type Props = { account: AuthenticatedUser; positionsCount: number; assetsCount: number };

const parseError = async (response: Response) => {
  try {
    const payload = await response.json() as { error?: string };
    return payload.error ?? "Nie udało się wykonać żądania.";
  } catch {
    return "Nie udało się wykonać żądania.";
  }
};

export default function PrivacyDataPanel({ account, positionsCount, assetsCount }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [reauthenticated, setReauthenticated] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [deletionComplete, setDeletionComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const exportBusyRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const confirmationRef = useRef<HTMLInputElement | null>(null);
  const googleLinkRef = useRef<HTMLAnchorElement | null>(null);
  const completionLinkRef = useRef<HTMLAnchorElement | null>(null);

  const cancelDeletionFlow = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      // The challenge is HttpOnly and may outlive local React/URL state after a
      // refresh or OAuth error. Always ask the server to revoke it on cancel.
      await fetch("/api/account/deletion/cancel", { method: "POST", headers: { "Content-Type": "application/json" } });
    } catch {
      // The challenge is short-lived and one-time even if cancellation cannot reach the server.
    } finally {
      setDeleteOpen(false);
      setPassword("");
      setReauthenticated(false);
      setConfirmed(false);
      setError(null);
      setNotice(null);
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.delete("privacyDeletionStepUp");
      nextParams.delete("privacyDeletionError");
      router.replace(nextParams.size ? `${pathname}?${nextParams.toString()}` : pathname, { scroll: false });
      busyRef.current = false;
      setBusy(false);
    }
  }, [pathname, router, searchParams]);

  const deletionStepUpReady = reauthenticated || searchParams.get("privacyDeletionStepUp") === "ready";
  const deletionOAuthError = searchParams.has("privacyDeletionError");
  const deletionDialogOpen = deleteOpen || deletionStepUpReady || deletionOAuthError || deletionComplete;

  useEffect(() => {
    if (!deletionDialogOpen) return;
    if (!returnFocusRef.current) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : deleteTriggerRef.current;
    }
    const releaseBodyScrollLock = acquireBodyScrollLock(document);
    return () => {
      releaseBodyScrollLock();
      const returnTarget = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnTarget?.isConnected) window.requestAnimationFrame(() => returnTarget.focus());
    };
  }, [deletionDialogOpen]);

  useEffect(() => {
    if (!deletionDialogOpen) return;
    const focusTimeout = window.setTimeout(() => {
      const initial = deletionComplete ? completionLinkRef.current : deletionStepUpReady ? confirmationRef.current : account.hasPassword ? passwordRef.current : googleLinkRef.current;
      (initial ?? dialogRef.current)?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimeout);
  }, [account.hasPassword, deletionComplete, deletionDialogOpen, deletionStepUpReady]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (deletionComplete) { router.replace("/login"); router.refresh(); }
      else if (!busyRef.current) void cancelDeletionFlow();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  const downloadExport = async () => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExportBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/account/export", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(await parseError(response));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `mexo-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Eksport danych został przygotowany.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się przygotować eksportu.");
    } finally {
      exportBusyRef.current = false;
      setExportBusy(false);
    }
  };

  const verifyPassword = async () => {
    if (busyRef.current || !password) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account/deletion/reauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) throw new Error(await parseError(response));
      setReauthenticated(true);
      setPassword("");
      setNotice("Tożsamość została potwierdzona. Potwierdź teraz zamiar usunięcia konta.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się potwierdzić tożsamości.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    if (!deletionStepUpReady || !confirmed || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/account", { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) {
        const message = await parseError(response);
        if (response.status === 409 || (response.status === 403 && /potwierdzenie wygasło/i.test(message))) {
          setReauthenticated(false);
          setConfirmed(false);
          const nextParams = new URLSearchParams(searchParams.toString());
          nextParams.delete("privacyDeletionStepUp");
          nextParams.delete("privacyDeletionError");
          router.replace(nextParams.size ? `${pathname}?${nextParams.toString()}` : pathname, { scroll: false });
          setError(`${message} Rozpocznij ponowną weryfikację przed kolejną próbą.`);
          return;
        }
        throw new Error(message);
      }
      const result = await response.json() as { success?: boolean };
      if (result.success !== true) throw new Error("Nie otrzymano potwierdzenia usunięcia konta. Sprawdź stan konta przed ponowną próbą.");
      setPassword("");
      setConfirmed(false);
      setNotice(null);
      setDeletionComplete(true);
    } catch (caught) {
      setError(caught instanceof TypeError || caught instanceof SyntaxError
        ? "Nie udało się potwierdzić wyniku. Odśwież stronę i sprawdź możliwość zalogowania przed ponowną próbą."
        : caught instanceof Error ? caught.message : "Nie udało się potwierdzić wyniku usunięcia konta.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <section className={`panel ${styles.panel}`} aria-labelledby="privacy-data-title">
        <div className={styles.heading}>
          <div><p className="eyebrow">Ustawienia konta</p><h2 id="privacy-data-title" className="section-title">Prywatność i dane</h2></div>
          <span className={styles.status}>Konto aktywne</span>
        </div>
        <p className="section-copy">Pobierz kopię informacji zapisanych na koncie albo rozpocznij bezpieczne usuwanie. Zakres obejmuje wszystkie portfele, niezależnie od aktualnego filtra.</p>
        <p className={styles.categories}>Dane konta obejmują profil, portfele i operacje, obserwowane instrumenty oraz ustawienia widoków. Współdzielone dane rynkowe nie są przypisane do jednego konta.</p>
        <div className={styles.summary}>
          <span><strong>{account.email}</strong><small>konto Mexo · {account.role === "admin" ? "administrator" : account.testerAccess ? "Tester" : "użytkownik"}</small></span>
          <span><strong>{assetsCount}</strong><small>aktywa w bieżącym widoku · {positionsCount} pozycji</small></span>
          <span><strong>{new Date(account.createdAt).toLocaleDateString("pl-PL", { timeZone: "Europe/Warsaw" })}</strong><small>data utworzenia konta</small></span>
        </div>
        <div className={styles.actions}>
          <button className="primary-button" type="button" onClick={() => void downloadExport()} disabled={exportBusy} aria-busy={exportBusy}>{exportBusy ? "Przygotowuję eksport…" : "Pobierz moje dane"}</button>
          <button ref={deleteTriggerRef} className={styles.dangerButton} type="button" aria-haspopup="dialog" aria-expanded={deletionDialogOpen} onClick={() => { returnFocusRef.current = deleteTriggerRef.current; setDeleteOpen(true); setError(null); setNotice(null); }}>Usuń konto</button>
        </div>
        <p className={styles.links}>Dokumenty: <Link href="/privacy">polityka prywatności</Link> · <Link href="/terms">regulamin</Link></p>
        <p className={styles.note}>Żądania dotyczące danych: kontakt administratora <strong>DO UZUPEŁNIENIA</strong>. Retencja w kopiach zapasowych oraz ewentualne wyjątki prawne wymagają zatwierdzenia przez operatora; nie są tu deklarowane niepotwierdzone terminy.</p>
        {notice && !deletionDialogOpen ? <p role="status" className={styles.notice}>{notice}</p> : null}
        {error && !deletionDialogOpen ? <p role="alert" className={styles.error}>{error}</p> : null}
      </section>
      {deletionDialogOpen && typeof document !== "undefined" ? createPortal(
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletionComplete && !busyRef.current) void cancelDeletionFlow(); }}>
          <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="privacy-delete-title" aria-describedby="privacy-delete-description" aria-busy={busy} tabIndex={-1} onKeyDown={handleDialogKeyDown}>
            <header className={styles.dialogHeader}>
              <div><p className="eyebrow">{deletionComplete ? "Potwierdzenie" : "Nieodwracalna czynność"}</p><h2 id="privacy-delete-title">{deletionComplete ? "Konto zostało usunięte" : "Usunięcie konta Mexo"}</h2></div>
              {!deletionComplete ? <button type="button" className={styles.closeButton} onClick={() => void cancelDeletionFlow()} disabled={busy} aria-label="Zamknij okno usuwania konta">×</button> : null}
            </header>
            {deletionComplete ? <>
              <p id="privacy-delete-description" role="status">Konto i powiązane dane w aplikacji zostały usunięte, a sesje unieważnione. Kopie zapasowe mogą podlegać odrębnej polityce retencji.</p>
              <a ref={completionLinkRef} className="primary-button" href="/login">Przejdź do logowania</a>
            </> : !deletionStepUpReady ? <>
              <p id="privacy-delete-description">Przed potwierdzeniem ponownie zweryfikujemy, że to Ty. Konto i zapisane w nim dane zostaną usunięte po osobnym potwierdzeniu.</p>
              {account.hasPassword ? <form onSubmit={(event) => { event.preventDefault(); void verifyPassword(); }}>
                <label className="field"><span>Aktualne hasło</span><input ref={passwordRef} autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
                <div className={styles.actions}><button className="ghost-button" type="button" onClick={() => void cancelDeletionFlow()} disabled={busy}>Anuluj</button><button className="primary-button" type="submit" disabled={busy || !password}>{busy ? "Weryfikuję…" : "Potwierdź tożsamość"}</button></div>
              </form> : <div className={styles.actions}><button className="ghost-button" type="button" onClick={() => void cancelDeletionFlow()} disabled={busy}>Anuluj</button><a ref={googleLinkRef} className="primary-button" href="/api/account/deletion/google" aria-disabled={busy} onClick={(event) => { if (busy) event.preventDefault(); }}>Potwierdź ponownie przez Google</a></div>}
            </> : <>
              <p id="privacy-delete-description">Po potwierdzeniu usuniemy konto, profil, portfele, rachunki, instrumenty, operacje, watchlistę, preferencje, subskrypcje kalendarza i sesje.</p>
              <p>W kopiach zapasowych dane mogą podlegać odrębnej, jeszcze niezatwierdzonej polityce retencji. Okresy oraz ewentualne obowiązki prawne: <strong>DO UZUPEŁNIENIA</strong>.</p>
              <label className={styles.confirm}><input ref={confirmationRef} type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Rozumiem, że usunięcie konta i danych operacyjnych jest nieodwracalne.</span></label>
              <div className={styles.actions}><button className="ghost-button" type="button" onClick={() => void cancelDeletionFlow()} disabled={busy}>Anuluj</button><button className={styles.dangerButton} type="button" onClick={() => void deleteAccount()} disabled={busy || !confirmed}>{busy ? "Usuwam konto…" : "Usuń konto i wyloguj"}</button></div>
            </>}
            {!deletionComplete ? <>
              <button className={styles.modalExport} type="button" onClick={() => void downloadExport()} disabled={busy || exportBusy}>{exportBusy ? "Przygotowuję eksport…" : "Pobierz dane przed usunięciem"}</button>
              {notice ? <p role="status" className={styles.notice}>{notice}</p> : null}
              {deletionOAuthError ? <p role="alert" className={styles.error}>Nie udało się potwierdzić konta Google. Spróbuj ponownie.</p> : null}
              {error ? <p role="alert" className={styles.error}>{error}</p> : null}
            </> : null}
          </section>
        </div>, document.body
      ) : null}
    </>
  );
}
