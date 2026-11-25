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
