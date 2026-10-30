import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  outputFileTracingRoot: __dirname,
  // Per-request image uploads (Shortcut posts one JPEG at a time). Keep modest so a buggy
  // multi-image client cannot dump 100MB into memory; capture route also enforces MAX_CAPTURE_IMAGE_BYTES.
  experimental: {
    serverActions: { bodySizeLimit: "15mb" },
    // Next 15.5+ proxy/middleware body caps (defaults are far smaller and truncate uploads).
    // Typed loosely: these keys landed in 15.5 docs ahead of the published ExperimentalConfig typings.
    ...({
      middlewareClientMaxBodySize: "15mb",
      proxyClientMaxBodySize: "15mb",
    } as object),
  },
};

export default nextConfig;
