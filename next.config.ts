import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  outputFileTracingRoot: __dirname,
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
};

export default nextConfig;
