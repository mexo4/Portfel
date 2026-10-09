import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(configDirectory, "..");
// Set only by the production workflow.  It makes an otherwise opaque Next.js
// deployment verifiable without exposing credentials or application data.
const releaseRevision = process.env.MEXO_BUILD_REVISION?.trim() || "local";

const nextConfig: NextConfig = {
  // Production deploys build into a separate directory and atomically switch
  // the runtime .next symlink only after the staged build has passed checks.
  distDir: process.env.MEXO_BUILD_DIST_DIR?.trim() || ".next",
  // Revision is public release metadata, embedded at build time so the health
  // endpoint remains reliable even when systemd does not inherit build env.
  env: { MEXO_BUILD_REVISION: releaseRevision },
  outputFileTracingRoot: workspaceRoot,
  headers: async () => [
    {
      source: "/:path*",
      headers: [{ key: "X-Mexo-Revision", value: releaseRevision }],
    },
  ],
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
