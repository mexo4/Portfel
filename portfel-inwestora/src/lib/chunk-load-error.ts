// Seen on production on 2026-11-25: about 1 in 60 requests that Cloudflare forwards to the
// server failed with 525 (the TLS handshake between Cloudflare and the origin), and when that
// request was a JavaScript chunk of the page, Next.js showed its English "This page couldn't
// load" screen. The same chunk loaded fine a moment later, so a chunk that failed to load is
// retried with one reload. The timestamp keeps a chunk that really is missing (for example a
// page left open across a deploy) from reloading in a loop.
export const CHUNK_RELOAD_KEY = "mexo.chunk-reload-at";
export const CHUNK_RELOAD_GUARD_MS = 30_000;

export const isChunkLoadError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return (
    name === "ChunkLoadError" ||
    (typeof message === "string" &&
      /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(message))
  );
};

type ReloadEnvironment = {
  storage: Pick<Storage, "getItem" | "setItem">;
  reload: () => void;
  now: () => number;
};

/** Reloads once for a chunk that failed to load; returns whether it did. */
export const reloadOnceForChunkError = (error: unknown, environment: ReloadEnvironment) => {
  if (!isChunkLoadError(error)) return false;

  try {
    const lastReloadAt = Number(environment.storage.getItem(CHUNK_RELOAD_KEY) ?? 0);
    if (environment.now() - lastReloadAt < CHUNK_RELOAD_GUARD_MS) return false;
    environment.storage.setItem(CHUNK_RELOAD_KEY, String(environment.now()));
  } catch {
    // Without storage there is no loop guard, so the page is not reloaded automatically.
    return false;
  }

  environment.reload();
  return true;
};

/**
 * Inline script for the document head. When the page's own `<script>` tag gets an error status
 * (the 525 above), Next.js throws nothing: the page stays visible but never hydrates, so buttons
 * and forms do nothing and the root error screen never shows. A capturing listener sees the
 * failed `/_next/static/` script or stylesheet and reloads once, under the same guard.
 */
export const CHUNK_RETRY_INLINE_SCRIPT = `(function(){var K=${JSON.stringify(CHUNK_RELOAD_KEY)},G=${CHUNK_RELOAD_GUARD_MS};function r(){try{var l=Number(window.sessionStorage.getItem(K)||0);if(Date.now()-l<G)return;window.sessionStorage.setItem(K,String(Date.now()))}catch(e){return}window.location.reload()}window.addEventListener("error",function(e){var t=e&&e.target;if(!t||t===window||!t.tagName)return;var s=t.tagName==="SCRIPT"?t.src:t.tagName==="LINK"?t.href:"";if(s&&s.indexOf("/_next/static/")!==-1)r()},true)})();`;
