import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@browserbasehq/stagehand"],
  turbopack: { root: process.cwd() },
};

export default nextConfig;
