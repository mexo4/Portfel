import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(configDirectory, "..");
// Set only by the production workflow.  It makes an otherwise opaque Next.js
// deployment verifiable without exposing credentials or application data.
const releaseRevision = process.env.MEXO_BUILD_REVISION?.trim() || "local";

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  headers: async () => [
    {
      source: "/:path*",
      headers: [{ key: "X-Mexo-Revision", value: releaseRevision }],
    },
  ],
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
