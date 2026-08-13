"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

function compact(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletControl() {
  const account = useAccount();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const connector = connect.connectors[0];

  if (account.isConnected && account.address) {
    return (
      <button
        className="wallet-button connected"
        type="button"
        onClick={() => disconnect.disconnect()}
      >
        <span className="status-dot" />
        {compact(account.address)}
      </button>
    );
  }

  return (
    <button
      className="wallet-button"
      type="button"
      disabled={!connector || connect.isPending}
      onClick={() => connector && connect.connect({ connector })}
    >
      {connect.isPending ? "Connecting…" : connector ? "Connect wallet" : "Wallet unavailable"}
    </button>
  );
}
