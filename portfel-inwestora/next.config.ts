import type { NextConfig } from "next";
import path from "node:path";

const workspaceRoot = path.resolve(__dirname, "..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  experimental: {
    turbopackUseSystemTlsCerts: true,
  },
  turbopack: {
    root: workspaceRoot,
  },
};

export default nextConfig;
