import { existsSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

const workspaceEnv = path.resolve(import.meta.dirname, "../../.env");
if (existsSync(workspaceEnv)) process.loadEnvFile(workspaceEnv);

const scriptSources = [
  "'self'",
  "'unsafe-inline'",
  ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
  "https://static.cloudflareinsights.com",
].join(" ");
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787").origin;
const connectSources = [
  "'self'",
  apiOrigin,
  "https://cloudflareinsights.com",
  "https://evmrpc-testnet.0g.ai",
  "https://evmrpc.0g.ai",
].join(" ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ["viem", "wagmi"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; base-uri 'self'; connect-src ${connectSources}; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src ${scriptSources}; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests`,
          },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};

export default nextConfig;
