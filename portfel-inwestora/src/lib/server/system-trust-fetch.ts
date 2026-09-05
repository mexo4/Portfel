/**
 * Cloudflare Workers uses the platform's verified Web Fetch implementation.
 * Locally, the existing `--use-system-ca` dev command makes this use the
 * Windows trust store too. Keeping one standards-based transport lets the
 * same official GPW/PAP fetches work in both runtimes without relaxing TLS.
 */
export const fetchWithSystemTrust: typeof fetch = (input, init) => fetch(input, init);
