/** Runs once when a Next.js server starts. */
export async function register() {
  // The condition stays around the imports: the build drops them from the edge runtime.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startEspiScheduler } = await import("@/lib/server/espi-scheduler");
    const { synchronizePapEspi } = await import("@/lib/server/espi");
    startEspiScheduler({ synchronize: () => synchronizePapEspi() });
  }
}
