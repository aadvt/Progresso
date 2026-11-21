import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages export TypeScript source; Next compiles them.
  transpilePackages: ["@progresso/core"],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
