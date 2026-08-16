const path = require("node:path");

const workspace = __dirname;
const cloudflared =
  process.env.CLOUDFLARED_BIN ?? "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";
const tunnelConfig =
  process.env.ACTIONPROOF_CLOUDFLARED_CONFIG ??
  path.join(workspace, ".actionproof", "cloudflare.yml");

module.exports = {
  apps: [
    {
      name: "actionproof-api",
      namespace: "actionproof",
      cwd: workspace,
      script: path.join(workspace, "apps", "api", "dist", "server.js"),
      interpreter: process.execPath,
      env_production: { NODE_ENV: "production" },
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 10_000,
    },
    {
      name: "actionproof-web",
      namespace: "actionproof",
      cwd: path.join(workspace, "apps", "web"),
      script: path.join(workspace, "apps", "web", "node_modules", "next", "dist", "bin", "next"),
      args: "start --hostname 127.0.0.1 --port 3020",
      interpreter: process.execPath,
      env_production: { NODE_ENV: "production", PORT: "3020" },
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 10_000,
    },
    {
      name: "actionproof-tunnel",
      namespace: "actionproof",
      cwd: workspace,
      script: cloudflared,
      args: `tunnel --no-autoupdate --config "${tunnelConfig}" run`,
      interpreter: "none",
      env_production: {},
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      kill_timeout: 10_000,
    },
  ],
};
