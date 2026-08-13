import { defineChain } from "viem";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

export const galileo = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: {
    default: { name: "0G ChainScan", url: "https://chainscan-galileo.0g.ai" },
  },
  testnet: true,
});

export const zeroGMainnet = defineChain({
  id: 16661,
  name: "0G Mainnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc.0g.ai"] } },
  blockExplorers: { default: { name: "0G ChainScan", url: "https://chainscan.0g.ai" } },
});

export const wagmiConfig = createConfig({
  chains: [galileo, zeroGMainnet],
  connectors: [injected()],
  transports: {
    [galileo.id]: http(),
    [zeroGMainnet.id]: http(),
  },
  ssr: true,
});

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8787";
export const configuredMode = process.env.NEXT_PUBLIC_ACTIONPROOF_MODE ?? "sandbox";
