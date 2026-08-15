import { existsSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

const workspaceEnv = path.resolve(import.meta.dirname, "../../.env");
if (existsSync(workspaceEnv)) process.loadEnvFile(workspaceEnv);

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
        ],
      },
    ];
  },
};

export default nextConfig;
