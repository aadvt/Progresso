import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages export TypeScript source; Next compiles them.
  transpilePackages: ["@progresso/core", "@progresso/db"],
  // Native module: load it from node_modules at runtime, never bundle it.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
