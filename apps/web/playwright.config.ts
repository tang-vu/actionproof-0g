import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3017",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "pnpm --filter @actionproof/api dev",
      url: "http://127.0.0.1:8797/healthz",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ACTIONPROOF_MODE: "sandbox",
        ACTIONPROOF_AGENT_ADDRESS: "0xA17e000000000000000000000000000000000001",
        NODE_ENV: "test",
        API_HOST: "127.0.0.1",
        API_PORT: "8797",
        API_CORS_ORIGINS: "http://127.0.0.1:3017",
      },
    },
    {
      command: "pnpm --filter @actionproof/web exec next dev --hostname 127.0.0.1 --port 3017",
      url: "http://127.0.0.1:3017",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_API_URL: "http://127.0.0.1:8797",
        NEXT_PUBLIC_ACTIONPROOF_MODE: "sandbox",
        NEXT_PUBLIC_ACTIONPROOF_AGENT_ADDRESS: "0xA17e000000000000000000000000000000000001",
        NEXT_PUBLIC_DEMO_COUNTER_ADDRESS: "0xc001000000000000000000000000000000000001",
        NEXT_PUBLIC_DEMO_TOKEN_ADDRESS: "0x700e000000000000000000000000000000000001",
      },
    },
  ],
});
