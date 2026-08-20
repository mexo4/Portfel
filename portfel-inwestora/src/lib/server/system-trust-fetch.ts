import { Agent, request as httpsRequest } from "node:https";
import * as tls from "node:tls";

type CertificateStore = "default" | "system";
type TlsCertificateReader = {
  getCACertificates?: (store?: CertificateStore) => string[];
};

const getTrustedCertificates = () => {
  const readCertificates = (tls as unknown as TlsCertificateReader).getCACertificates;
  if (!readCertificates) return undefined;

  try {
    return Array.from(
      new Set([...readCertificates("default"), ...readCertificates("system")])
    );
  } catch {
    return undefined;
  }
};

const officialSourceAgent = new Agent({
  keepAlive: true,
  maxSockets: 3,
  ca: getTrustedCertificates(),
});

const toNodeHeaders = (headers?: HeadersInit) => {
  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    result[name] = value;
  });
  return result;
};

/**
 * Strict-TLS transport for official public GPW/PAP pages. Some managed
 * Windows installations trust their issuer through the OS store while Node's
 * bundled store does not. Merging both stores fixes that mismatch without
 * disabling certificate verification or spoofing browser headers.
 */
export const fetchWithSystemTrust: typeof fetch = async (input, init) => {
  const target =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  if (init?.body !== undefined && init.body !== null && typeof init.body !== "string") {
    return fetch(input, init);
  }

  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      target,
      {
        method: init?.method ?? "GET",
        headers: toNodeHeaders(init?.headers),
        agent: officialSourceAgent,
        signal: init?.signal ?? undefined,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
        response.once("error", reject);
        response.once("end", () => {
          const headers = new Headers();
          Object.entries(response.headers).forEach(([name, value]) => {
            if (Array.isArray(value)) {
              value.forEach((item) => headers.append(name, item));
            } else if (value !== undefined) {
              headers.set(name, String(value));
            }
          });
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode ?? 502,
              headers,
            })
          );
        });
      }
    );

    request.once("error", reject);
    request.end(typeof init?.body === "string" ? init.body : undefined);
  });
};
